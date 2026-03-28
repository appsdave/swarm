use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use crossterm::event::{self, Event as CEvent, KeyCode, KeyEventKind};
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use crossterm::ExecutableCommand;
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap};
use ratatui::Terminal;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

const MAX_LOGS_PER_AGENT: usize = 1000;
const MAX_GROUP_LOGS: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum AgentRole {
    Frontend,
    Backend,
}

impl AgentRole {
    fn as_str(self) -> &'static str {
        match self {
            Self::Frontend => "frontend",
            Self::Backend => "backend",
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::Frontend => "Frontend",
            Self::Backend => "Backend",
        }
    }

    fn title_prefix(self) -> &'static str {
        match self {
            Self::Frontend => "Agent A",
            Self::Backend => "Agent B",
        }
    }

    fn color(self) -> Color {
        match self {
            Self::Frontend => Color::Cyan,
            Self::Backend => Color::Magenta,
        }
    }

    fn schema_key(self) -> &'static str {
        match self {
            Self::Frontend => "schema:frontend",
            Self::Backend => "schema:backend",
        }
    }

    fn depends_on_schema(self) -> &'static str {
        match self {
            Self::Frontend => "schema:backend",
            Self::Backend => "schema:frontend",
        }
    }

    fn task_summary(self) -> &'static str {
        match self {
            Self::Frontend => "Build the frontend application (UI components, pages, routing, API integration)",
            Self::Backend => "Build the backend application (API endpoints, database schema, business logic, data models)",
        }
    }

    fn completion_task(self) -> &'static str {
        match self {
            Self::Frontend => "Frontend complete",
            Self::Backend => "Backend complete",
        }
    }

    fn startup_task(self) -> &'static str {
        match self {
            Self::Frontend => "Building frontend application",
            Self::Backend => "Building backend application",
        }
    }
}

#[derive(Debug, Clone)]
struct AgentSpec {
    id: String,
    label: String,
    role: AgentRole,
    worktree: PathBuf,
    prompt_path: PathBuf,
    status_key: String,
}

#[derive(Debug, Clone)]
struct AgentState {
    spec: AgentSpec,
    status: String,
    raw_status: Option<String>,
    task: Option<String>,
    blocked_on: Option<String>,
    pid: Option<u32>,
    exit_code: Option<i32>,
    logs: Vec<String>,
}

#[derive(Debug, Clone)]
enum AppEvent {
    Log { agent_id: String, line: String },
    Status { agent_id: String, status: String },
    RedisSnapshot {
        agent_id: String,
        status_raw: String,
        task: Option<String>,
        blocked: Option<String>,
    },
    SchemaPublished { key: String, present: bool },
    RedisError(String),
    AgentSpawned { agent_id: String, pid: u32 },
    AgentExited { agent_id: String, code: Option<i32> },
}

#[derive(Debug)]
enum AgentCommand {
    Stop,
}

struct App {
    agents: HashMap<String, AgentState>,
    frontend_order: Vec<String>,
    backend_order: Vec<String>,
    frontend_logs: Vec<String>,
    backend_logs: Vec<String>,
    redis_error: Option<String>,
    launched: bool,
    quit: bool,
    shutdown_requested: bool,
    completion_logged: bool,
    junie_path: String,
    task_input: String,
    schema_state: HashMap<String, bool>,
}

impl App {
    fn new(specs: &[AgentSpec], junie_path: String, task_prompt: Option<String>) -> Self {
        let mut agents = HashMap::new();
        let mut frontend_order = Vec::new();
        let mut backend_order = Vec::new();

        for spec in specs {
            let state = AgentState {
                spec: spec.clone(),
                status: "⏳ idle".into(),
                raw_status: None,
                task: None,
                blocked_on: None,
                pid: None,
                exit_code: None,
                logs: Vec::new(),
            };

            match spec.role {
                AgentRole::Frontend => frontend_order.push(spec.id.clone()),
                AgentRole::Backend => backend_order.push(spec.id.clone()),
            }

            agents.insert(spec.id.clone(), state);
        }

        Self {
            agents,
            frontend_order,
            backend_order,
            frontend_logs: Vec::new(),
            backend_logs: Vec::new(),
            redis_error: None,
            launched: false,
            quit: false,
            shutdown_requested: false,
            completion_logged: false,
            junie_path,
            task_input: task_prompt.unwrap_or_default(),
            schema_state: HashMap::new(),
        }
    }

    fn reset_for_next_run(&mut self) {
        self.frontend_logs.clear();
        self.backend_logs.clear();
        self.schema_state.clear();
        self.redis_error = None;
        self.launched = false;
        self.shutdown_requested = false;
        self.completion_logged = false;

        for agent in self.agents.values_mut() {
            agent.status = "⏳ idle".into();
            agent.raw_status = None;
            agent.task = None;
            agent.blocked_on = None;
            agent.pid = None;
            agent.exit_code = None;
            agent.logs.clear();
        }
    }

    fn finalize_completed_run(&mut self) {
        if self.completion_logged {
            return;
        }

        self.completion_logged = true;
        self.launched = false;
        self.shutdown_requested = false;

        let finished = self
            .agents
            .values()
            .map(|agent| {
                format!(
                    "{} pid={} exit={}",
                    agent.spec.label,
                    agent
                        .pid
                        .map(|pid| pid.to_string())
                        .unwrap_or_else(|| "n/a".into()),
                    agent
                        .exit_code
                        .map(|code| code.to_string())
                        .unwrap_or_else(|| "signal".into())
                )
            })
            .collect::<Vec<_>>()
            .join(" | ");

        self.push_system_log(format!(
            "All agent processes have exited. One-off swarm task finished: {finished}. Edit the task and press [Enter] to start a fresh run."
        ));
    }

    fn push_limited(logs: &mut Vec<String>, line: String, max: usize) {
        logs.push(line);
        if logs.len() > max {
            let overflow = logs.len().saturating_sub(max);
            logs.drain(0..overflow);
        }
    }

    fn handle_event(&mut self, ev: AppEvent) {
        match ev {
            AppEvent::Log { agent_id, line } => self.push_agent_log(&agent_id, line),
            AppEvent::Status { agent_id, status } => {
                if let Some(agent) = self.agents.get_mut(&agent_id) {
                    agent.status = status;
                }
            }
            AppEvent::RedisSnapshot {
                agent_id,
                status_raw,
                task,
                blocked,
            } => {
                let mut updates = Vec::new();
                if let Some(agent) = self.agents.get_mut(&agent_id) {
                    if agent.raw_status.as_deref() != Some(status_raw.as_str()) {
                        agent.raw_status = Some(status_raw.clone());
                        agent.status = status_icon(&status_raw);
                        updates.push(format!("redis status -> {}", agent.status));
                    }

                    if agent.task != task {
                        agent.task = task.clone();
                        if let Some(task_value) = &agent.task {
                            updates.push(format!("task -> {task_value}"));
                        }
                    }

                    if agent.blocked_on != blocked {
                        match blocked.as_deref() {
                            Some(waiting_on) => updates.push(format!("waiting on {waiting_on}")),
                            None if agent.blocked_on.is_some() => {
                                updates.push("unblocked in Redis".into())
                            }
                            None => {}
                        }
                        agent.blocked_on = blocked;
                    }
                }

                for update in updates {
                    self.push_agent_log(&agent_id, format!("[redis] {update}"));
                }
            }
            AppEvent::SchemaPublished { key, present } => {
                let previous = self.schema_state.insert(key.clone(), present).unwrap_or(false);
                if present && !previous {
                    self.push_system_log(format!("Redis key `{key}` was published"));
                }
            }
            AppEvent::RedisError(e) => self.redis_error = Some(e),
            AppEvent::AgentSpawned { agent_id, pid } => {
                if let Some(agent) = self.agents.get_mut(&agent_id) {
                    agent.pid = Some(pid);
                }
                self.push_agent_log(&agent_id, format!(">>> PID {pid}"));
            }
            AppEvent::AgentExited { agent_id, code } => {
                let mut grouped_log: Option<(AgentRole, String)> = None;
                if let Some(agent) = self.agents.get_mut(&agent_id) {
                    agent.exit_code = code;
                    agent.status = match code {
                        Some(0) => "✅ DONE".into(),
                        Some(other) => format!("❌ EXIT {other}"),
                        None => "🏁 EXITED".into(),
                    };
                    let msg = format!("🏁 {} exited (code {:?})", agent.spec.label, code);
                    Self::push_limited(&mut agent.logs, msg.clone(), MAX_LOGS_PER_AGENT);
                    grouped_log = Some((agent.spec.role, format!("[{}] {}", agent.spec.label, msg)));
                }
                if let Some((role, prefixed)) = grouped_log {
                    self.push_group_log(role, prefixed);
                }
            }
        }

        if self.launched && !self.shutdown_requested && self.all_agents_done_in_redis() {
            self.shutdown_requested = true;
            self.push_system_log("Redis confirms all agents are done; stopping Junie processes...");
        }

        if self.launched && self.all_agents_exited() {
            self.finalize_completed_run();
        }
    }

    fn ordered_agents<'a>(&'a self, ids: &'a [String]) -> Vec<&'a AgentState> {
        ids.iter().filter_map(|id| self.agents.get(id)).collect()
    }

    fn push_group_log(&mut self, role: AgentRole, line: String) {
        match role {
            AgentRole::Frontend => Self::push_limited(&mut self.frontend_logs, line, MAX_GROUP_LOGS),
            AgentRole::Backend => Self::push_limited(&mut self.backend_logs, line, MAX_GROUP_LOGS),
        }
    }

    fn push_system_log(&mut self, line: impl Into<String>) {
        let line = format!("[Swarm] {}", line.into());
        Self::push_limited(&mut self.frontend_logs, line.clone(), MAX_GROUP_LOGS);
        Self::push_limited(&mut self.backend_logs, line, MAX_GROUP_LOGS);
    }

    fn push_agent_log(&mut self, agent_id: &str, line: String) {
        let Some(agent) = self.agents.get_mut(agent_id) else {
            return;
        };

        let role = agent.spec.role;
        let prefixed = format!("[{}] {}", agent.spec.label, line);
        Self::push_limited(&mut agent.logs, line, MAX_LOGS_PER_AGENT);
        self.push_group_log(role, prefixed);
    }

    fn current_task_prompt(&self) -> Option<String> {
        let trimmed = self.task_input.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    }

    fn all_agents_done_in_redis(&self) -> bool {
        !self.agents.is_empty()
            && self
                .agents
                .values()
                .all(|agent| agent.raw_status.as_deref() == Some("done"))
    }

    fn all_agents_exited(&self) -> bool {
        !self.agents.is_empty() && self.agents.values().all(|agent| agent.exit_code.is_some())
    }
}

async fn redis_poller(url: Option<String>, specs: Vec<AgentSpec>, tx: mpsc::UnboundedSender<AppEvent>) {
    let Some(url) = url else {
        let _ = tx.send(AppEvent::RedisError("SWARM_REDIS_URL not set".into()));
        return;
    };

    if url.starts_with("rediss://") {
        redis_poll_via_cli(&url, &specs, tx).await;
    } else {
        redis_poll_native(&url, &specs, tx).await;
    }
}

async fn redis_poll_native(url: &str, specs: &[AgentSpec], tx: mpsc::UnboundedSender<AppEvent>) {
    let client = match redis::Client::open(url) {
        Ok(c) => c,
        Err(e) => {
            let _ = tx.send(AppEvent::RedisError(format!("Redis connect: {e}")));
            return;
        }
    };

    loop {
        match client.get_multiplexed_async_connection().await {
            Ok(mut con) => loop {
                for schema_key in ["schema:frontend", "schema:backend"] {
                    let present = redis::cmd("EXISTS")
                        .arg(schema_key)
                        .query_async::<u64>(&mut con)
                        .await
                        .map(|count| count > 0)
                        .unwrap_or(false);
                    let _ = tx.send(AppEvent::SchemaPublished {
                        key: schema_key.to_string(),
                        present,
                    });
                }

                for spec in specs {
                    let status_key = spec.status_key.clone();
                    let task_key = format!("agent:{}:task", spec.id);
                    let blocked_key = format!("blocked:{}", spec.id);
                    let status_raw = redis::cmd("GET")
                        .arg(&status_key)
                        .query_async::<Option<String>>(&mut con)
                        .await
                        .ok()
                        .flatten()
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or_else(|| "unknown".into());
                    let task = redis::cmd("GET")
                        .arg(&task_key)
                        .query_async::<Option<String>>(&mut con)
                        .await
                        .ok()
                        .flatten()
                        .map(|value| value.trim().to_string())
                        .filter(|value| !value.is_empty());
                    let blocked = redis::cmd("GET")
                        .arg(&blocked_key)
                        .query_async::<Option<String>>(&mut con)
                        .await
                        .ok()
                        .flatten()
                        .map(|value| value.trim().to_string())
                        .filter(|value| !value.is_empty());
                    let _ = tx.send(AppEvent::RedisSnapshot {
                        agent_id: spec.id.clone(),
                        status_raw,
                        task,
                        blocked,
                    });
                }

                tokio::time::sleep(Duration::from_secs(1)).await;
            },
            Err(e) => {
                let _ = tx.send(AppEvent::RedisError(format!("Redis: {e}")));
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }

}

async fn redis_poll_via_cli(url: &str, specs: &[AgentSpec], tx: mpsc::UnboundedSender<AppEvent>) {
    loop {
        for schema_key in ["schema:frontend", "schema:backend"] {
            let result = Command::new("redis-cli")
                .args(["-u", url, "--tls", "EXISTS", schema_key])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await;

            if let Ok(out) = result {
                let present = String::from_utf8_lossy(&out.stdout).trim() == "1";
                let _ = tx.send(AppEvent::SchemaPublished {
                    key: schema_key.to_string(),
                    present,
                });
            }
        }

        for spec in specs {
            let task_key = format!("agent:{}:task", spec.id);
            let blocked_key = format!("blocked:{}", spec.id);
            let result = Command::new("redis-cli")
                .args([
                    "-u",
                    url,
                    "--tls",
                    "MGET",
                    &spec.status_key,
                    &task_key,
                    &blocked_key,
                ])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await;

            match result {
                Ok(out) => {
                    let values = String::from_utf8_lossy(&out.stdout)
                        .lines()
                        .map(|line| line.trim().to_string())
                        .collect::<Vec<_>>();
                    let decode = |index: usize| {
                        values
                            .get(index)
                            .map(|value| value.trim_matches('"').trim().to_string())
                            .filter(|value| !value.is_empty() && value != "(nil)")
                    };
                    let status_raw = decode(0).unwrap_or_else(|| "unknown".into());
                    let _ = tx.send(AppEvent::RedisSnapshot {
                        agent_id: spec.id.clone(),
                        status_raw: status_raw.clone(),
                        task: decode(1),
                        blocked: decode(2),
                    });
                    let normalized = if status_raw == "unknown" {
                        status_icon("unknown")
                    } else {
                        status_icon(&status_raw)
                    };
                    let _ = tx.send(AppEvent::Status {
                        agent_id: spec.id.clone(),
                        status: normalized,
                    });
                }
                Err(e) => {
                    let _ = tx.send(AppEvent::RedisError(format!("redis-cli: {e}")));
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

fn status_icon(raw: &str) -> String {
    match raw.to_lowercase().as_str() {
        "running" => "🟢 RUNNING".into(),
        "blocked" => "🔴 BLOCKED".into(),
        s if s.starts_with("blocked") => format!("🔴 {}", s.to_uppercase()),
        "done" => "✅ DONE".into(),
        "error" => "❌ ERROR".into(),
        "idle" | "unknown" => "⏳ idle".into(),
        other => other.to_uppercase(),
    }
}

fn sanitize_log_line(line: &str) -> String {
    let mut sanitized = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if matches!(chars.peek(), Some('[')) {
                chars.next();
                while let Some(next) = chars.next() {
                    if ('@'..='~').contains(&next) {
                        break;
                    }
                }
            }
            continue;
        }

        if ch == '\n' || ch == '\t' || (!ch.is_control() && !ch.is_ascii_control()) {
            sanitized.push(ch);
        }
    }

    sanitized.trim().to_string()
}

async fn spawn_agent(
    spec: AgentSpec,
    junie_path: PathBuf,
    tx: mpsc::UnboundedSender<AppEvent>,
    mut cmd_rx: mpsc::UnboundedReceiver<AgentCommand>,
) {
    let send_log = |line: String| {
        let _ = tx.send(AppEvent::Log {
            agent_id: spec.id.clone(),
            line,
        });
    };

    send_log(format!(">>> Launching {} in {} ...", junie_path.display(), spec.worktree.display()));
    send_log(format!(">>> Prompt file: {}", spec.prompt_path.display()));

    let prompt = match fs::read_to_string(&spec.prompt_path) {
        Ok(prompt) => prompt,
        Err(e) => {
            send_log(format!("❌ Failed to read prompt {}: {e}", spec.prompt_path.display()));
            return;
        }
    };

    let child = Command::new(&junie_path)
        .args(["--task", &prompt, "--project", "."])
        .current_dir(&spec.worktree)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            send_log(format!("❌ Failed to spawn {}: {e}", junie_path.display()));
            return;
        }
    };

    if let Some(pid) = child.id() {
        let _ = tx.send(AppEvent::AgentSpawned {
            agent_id: spec.id.clone(),
            pid,
        });
    }

    if let Some(stdout) = child.stdout.take() {
        let tx2 = tx.clone();
        let agent_id = spec.id.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = tx2.send(AppEvent::Log {
                    agent_id: agent_id.clone(),
                    line: sanitize_log_line(&line),
                });
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let tx2 = tx.clone();
        let agent_id = spec.id.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = tx2.send(AppEvent::Log {
                    agent_id: agent_id.clone(),
                    line: format!("[stderr] {}", sanitize_log_line(&line)),
                });
            }
        });
    }

    let code = loop {
        tokio::select! {
            status = child.wait() => {
                break status.ok().and_then(|s| s.code());
            }
            command = cmd_rx.recv() => {
                if matches!(command, Some(AgentCommand::Stop)) {
                    send_log(">>> Swarm completion confirmed; stopping agent process...".into());
                    let _ = child.start_kill();
                }
            }
        }
    };

    let _ = tx.send(AppEvent::AgentExited {
        agent_id: spec.id,
        code,
    });
}

async fn clear_swarm_redis_state(
    redis_url: Option<&str>,
    specs: &[AgentSpec],
    tx: &mpsc::UnboundedSender<AppEvent>,
) {
    let Some(redis_url) = redis_url else {
        let _ = tx.send(AppEvent::RedisError("SWARM_REDIS_URL not set".into()));
        return;
    };

    let mut keys = vec![
        "schema:frontend".to_string(),
        "schema:backend".to_string(),
        "project:status".to_string(),
    ];
    for spec in specs {
        keys.push(spec.status_key.clone());
        keys.push(format!("agent:{}:task", spec.id));
        keys.push(format!("agent:{}:last_poll", spec.id));
        keys.push(format!("blocked:{}", spec.id));
    }

    let result: Result<(), String> = if redis_url.starts_with("rediss://") {
        Command::new("redis-cli")
            .args(["-u", redis_url, "--tls", "DEL"])
            .args(keys.iter().map(|key| key.as_str()))
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| e.to_string())
            .and_then(|out| {
                if out.status.success() {
                    Ok(())
                } else {
                    Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
                }
            })
    } else {
        match redis::Client::open(redis_url) {
            Ok(client) => match client.get_multiplexed_async_connection().await {
                Ok(mut con) => redis::cmd("DEL")
                    .arg(&keys)
                    .query_async::<u64>(&mut con)
                    .await
                    .map(|_| ())
                    .map_err(|e| e.to_string()),
                Err(e) => Err(e.to_string()),
            },
            Err(e) => Err(e.to_string()),
        }
    };

    if let Err(err) = result {
        let _ = tx.send(AppEvent::RedisError(format!("Failed to reset swarm Redis state: {err}")));
    } else {
        let _ = tx.send(AppEvent::SchemaPublished {
            key: "schema:frontend".into(),
            present: false,
        });
        let _ = tx.send(AppEvent::SchemaPublished {
            key: "schema:backend".into(),
            present: false,
        });
    }
}

fn draw(f: &mut ratatui::Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(10),
            Constraint::Min(10),
            Constraint::Length(3),
            Constraint::Length(3),
        ])
        .split(f.area());

    draw_status(f, app, chunks[0]);
    draw_logs(f, app, chunks[1]);
    draw_task_input(f, app, chunks[2]);
    draw_help(f, app, chunks[3]);
}

fn draw_status(f: &mut ratatui::Frame, app: &App, area: Rect) {
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(area);

    render_agent_column(
        f,
        " Frontend Agents ",
        &app.ordered_agents(&app.frontend_order),
        AgentRole::Frontend.color(),
        cols[0],
    );
    render_agent_column(
        f,
        " Backend Agents ",
        &app.ordered_agents(&app.backend_order),
        AgentRole::Backend.color(),
        cols[1],
    );
}

fn render_agent_column(
    f: &mut ratatui::Frame,
    title: &str,
    agents: &[&AgentState],
    color: Color,
    area: Rect,
) {
    let items: Vec<ListItem> = agents
        .iter()
        .map(|agent| {
            let line = Line::from(vec![
                Span::styled(
                    format!("{} ", agent.spec.label),
                    Style::default().fg(color).add_modifier(Modifier::BOLD),
                ),
                Span::raw(agent.status.as_str()),
            ]);
            ListItem::new(line)
        })
        .collect();

    let list = List::new(items).block(
        Block::default()
            .title(title)
            .borders(Borders::ALL)
            .border_style(Style::default().fg(color)),
    );
    f.render_widget(list, area);
}

fn draw_logs(f: &mut ratatui::Frame, app: &App, area: Rect) {
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(area);

    render_log_pane(f, &app.frontend_logs, " Frontend Logs ", AgentRole::Frontend.color(), cols[0]);
    render_log_pane(f, &app.backend_logs, " Backend Logs ", AgentRole::Backend.color(), cols[1]);
}

fn render_log_pane(f: &mut ratatui::Frame, logs: &[String], title: &str, color: Color, area: Rect) {
    let inner_height = area.height.saturating_sub(2) as usize;
    let start = logs.len().saturating_sub(inner_height);

    let items: Vec<ListItem> = logs[start..]
        .iter()
        .map(|line| {
            let style = if line.contains("❌") || line.contains("[stderr]") {
                Style::default().fg(Color::Red)
            } else if line.contains(">>>") || line.contains("🏁") {
                Style::default().fg(Color::Yellow)
            } else {
                Style::default().fg(Color::White)
            };
            ListItem::new(Line::from(Span::styled(line.as_str(), style)))
        })
        .collect();

    let list = List::new(items).block(
        Block::default()
            .title(title)
            .borders(Borders::ALL)
            .border_style(Style::default().fg(color)),
    );
    f.render_widget(list, area);
}

fn draw_task_input(f: &mut ratatui::Frame, app: &App, area: Rect) {
    let border_color = if app.launched { Color::DarkGray } else { Color::Green };
    let title = if app.launched {
        " Swarm Task (locked while running) "
    } else {
        " Swarm Task Input "
    };
    let prompt = if app.task_input.trim().is_empty() {
        "Type the next one-off swarm task here..."
    } else {
        app.task_input.as_str()
    };
    let style = if app.task_input.trim().is_empty() {
        Style::default().fg(Color::DarkGray)
    } else {
        Style::default().fg(Color::White)
    };

    let paragraph = Paragraph::new(prompt)
        .style(style)
        .block(
            Block::default()
                .title(title)
                .borders(Borders::ALL)
                .border_style(Style::default().fg(border_color)),
        )
        .wrap(Wrap { trim: true });

    f.render_widget(Clear, area);
    f.render_widget(paragraph, area);
}

fn draw_help(f: &mut ratatui::Frame, app: &App, area: Rect) {
    let launch_msg = if !app.launched {
        "Type a one-off swarm task in the input box, then press [Enter] to launch or relaunch"
    } else {
        "Swarm running; after exit, edit the task box and press [Enter] for the next swarm"
    };

    let redis = app
        .redis_error
        .as_deref()
        .map(|e| format!(" | redis: {e}"))
        .unwrap_or_default();
    let text = format!(
        " {launch_msg} | [q] Quit | [Backspace] edit | logs reset + Redis state cleared on each new run | junie: {}{}",
        app.junie_path,
        redis
    );

    let paragraph = Paragraph::new(text)
        .style(Style::default().fg(Color::DarkGray))
        .wrap(Wrap { trim: true });
    f.render_widget(paragraph, area);
}

fn project_root() -> Result<PathBuf> {
    if let Ok(path) = std::env::var("SWARM_PROJECT_ROOT") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let cwd = std::env::current_dir()?;
    cwd
        .ancestors()
        .find(|p| p.join(".git").exists())
        .map(Path::to_path_buf)
        .or(Some(cwd))
        .context("Could not locate project root")
}

fn resolve_junie() -> Result<PathBuf> {
    if let Ok(path) = std::env::var("JUNIE_BIN") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let common_paths = [
        PathBuf::from("/usr/local/bin/junie"),
        PathBuf::from("/usr/bin/junie"),
        dirs_home().join(".local/bin/junie"),
        dirs_home().join(".cargo/bin/junie"),
    ];

    for candidate in common_paths {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join("junie");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    anyhow::bail!("Could not find `junie`. Add it to PATH or set JUNIE_BIN=/full/path/to/junie")
}

fn dirs_home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn task_prompt_from_args() -> Option<String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let cli_prompt = if args.first().map(|value| value.as_str()) == Some("run") {
        args.into_iter().skip(1).collect::<Vec<_>>().join(" ")
    } else {
        args.join(" ")
    };
    if !cli_prompt.trim().is_empty() {
        return Some(cli_prompt);
    }

    std::env::var("SWARM_TASK_PROMPT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn discover_worktrees(repo_root: &Path, role: AgentRole) -> Result<Vec<PathBuf>> {
    let mut discovered = Vec::new();
    let prefix = format!("worktree-{}", role.as_str());

    for entry in fs::read_dir(repo_root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };

        if name == prefix || name.starts_with(&format!("{prefix}-")) {
            discovered.push(path);
        }
    }

    discovered.sort();
    Ok(discovered)
}

fn parse_frontend_share() -> f64 {
    std::env::var("SWARM_FRONTEND_SHARE")
        .ok()
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| (0.0..=1.0).contains(value))
        .unwrap_or(0.8)
}

fn desired_agent_split(frontend_available: usize, backend_available: usize) -> (usize, usize) {
    let total_requested = std::env::var("SWARM_TOTAL_AGENTS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(frontend_available + backend_available);

    let max_total = total_requested.min(frontend_available + backend_available);
    if max_total == 0 {
        return (0, 0);
    }

    let frontend_target = ((max_total as f64) * parse_frontend_share()).round() as usize;
    let mut frontend = frontend_target.min(frontend_available);
    let mut backend = max_total.saturating_sub(frontend).min(backend_available);

    let assigned = frontend + backend;
    if assigned < max_total {
        let remaining = max_total - assigned;
        let extra_frontend = remaining.min(frontend_available.saturating_sub(frontend));
        frontend += extra_frontend;
        backend += (max_total - frontend - backend).min(backend_available.saturating_sub(backend));
    }

    if frontend == 0 && frontend_available > 0 && max_total > 0 {
        frontend = 1;
        if frontend + backend > max_total {
            backend = backend.saturating_sub(1);
        }
    }

    if backend == 0 && backend_available > 0 && max_total > 1 {
        backend = 1;
        if frontend + backend > max_total {
            frontend = frontend.saturating_sub(1);
        }
    }

    (frontend, backend)
}

fn build_agent_specs(project_root: &Path, task_prompt: Option<&str>) -> Result<Vec<AgentSpec>> {
    let frontend_worktrees = discover_worktrees(project_root, AgentRole::Frontend)?;
    let backend_worktrees = discover_worktrees(project_root, AgentRole::Backend)?;
    let (frontend_count, backend_count) =
        desired_agent_split(frontend_worktrees.len(), backend_worktrees.len());

    let prompt_dir = project_root.join(".swarm/runtime-prompts");
    fs::create_dir_all(&prompt_dir)?;

    let mut specs = Vec::new();
    specs.extend(make_specs(
        AgentRole::Frontend,
        frontend_worktrees.into_iter().take(frontend_count).collect(),
        &prompt_dir,
        task_prompt,
    )?);
    specs.extend(make_specs(
        AgentRole::Backend,
        backend_worktrees.into_iter().take(backend_count).collect(),
        &prompt_dir,
        task_prompt,
    )?);

    if specs.is_empty() {
        anyhow::bail!("No matching worktrees found. Expected directories like worktree-frontend, worktree-frontend-2, worktree-backend, worktree-backend-2")
    }

    Ok(specs)
}

fn make_specs(
    role: AgentRole,
    worktrees: Vec<PathBuf>,
    prompt_dir: &Path,
    task_prompt: Option<&str>,
) -> Result<Vec<AgentSpec>> {
    worktrees
        .into_iter()
        .enumerate()
        .map(|(index, worktree)| {
            let suffix = index + 1;
            let id = format!("{}-{}", role.as_str(), suffix);
            let label = format!("{}{}", role.title_prefix(), suffix);
            let prompt_path = prompt_dir.join(format!("{id}.md"));
            fs::write(
                &prompt_path,
                render_prompt(role, &id, &label, &worktree, task_prompt),
            )?;

            Ok(AgentSpec {
                id: id.clone(),
                label,
                role,
                worktree,
                prompt_path,
                status_key: format!("agent:{id}:status"),
            })
        })
        .collect()
}

fn render_prompt(
    role: AgentRole,
    agent_id: &str,
    label: &str,
    worktree: &Path,
    task_prompt: Option<&str>,
) -> String {
    let startup_task = role.startup_task();
    let completion_task = role.completion_task();
    let publish_note = match role {
        AgentRole::Frontend => format!(
            "When you complete a component or schema that others might need, publish it with:\n```\nSET {} \"<your JSON data>\"\n```",
            role.schema_key()
        ),
        AgentRole::Backend => format!(
            "Publish your database schema as early as possible with:\n```\nSET {} '{{\"tables\":{{ ... your full JSON schema ... }}}}'\nSET agent:{}:task \"Schema published, continuing backend logic\"\n```",
            role.schema_key(),
            agent_id
        ),
    };

    let task_section = task_prompt
        .map(|task| format!("## Mission\n- Primary task: {task}\n- Coordinate through Redis if you need another agent to unblock you.\n\n"))
        .unwrap_or_default();

    format!(
        "# {label} — {role_name}\n\nYou are **{label}**, a {role_name} developer in an autonomous swarm. You work inside `{worktree}`.\n\n## Your Identity\n- **Agent ID**: `{agent_id}`\n- **Role**: {role_summary}\n\n{task_section}## Redis Blackboard Protocol\n\nYou communicate through the shared Render Redis blackboard. Use the Render MCP tools or `redis-cli` to interact with it.\n\n### On Startup\n```\nSET agent:{agent_id}:status running\nSET agent:{agent_id}:task \"{startup_task}\"\n```\n\n### When You Need Data From Another Agent\n1. Set your status to blocked:\n```\nSET agent:{agent_id}:status blocked\nSET blocked:{agent_id} \"{depends_on}\"\nSET agent:{agent_id}:last_poll <current ISO-8601 timestamp>\n```\n2. Enter the polling loop:\n- Run `sleep 60`\n- After waking, query Redis: `GET {depends_on}`\n- If the key exists and has data, break out of the loop\n- If empty/nil, update `agent:{agent_id}:last_poll` and sleep again\n- Do **not** exit; keep your context alive\n3. On receiving the data:\n```\nSET agent:{agent_id}:status running\nDEL blocked:{agent_id}\n```\n\n### Publishing Your Work\n{publish_note}\n\n### On Completion\n```\nSET agent:{agent_id}:status done\nSET agent:{agent_id}:task \"{completion_task}\"\n```\n\n## Work Rules\n- Stay inside `{worktree}`\n- Never modify files outside your worktree\n- Commit frequently on your own branch/worktree\n- Poll every 60 seconds when blocked; do not poll faster\n- Keep the session alive until your task is finished\n- Improve the project's file structure when it helps: keep related code grouped by feature, avoid cluttering top-level folders, and place new files where another developer would expect to find them\n- Write clean, production-quality code\n",
        role_name = role.display_name(),
        worktree = worktree.display(),
        role_summary = role.task_summary(),
        depends_on = role.depends_on_schema(),
    )
}

#[tokio::main]
async fn main() -> Result<()> {
    let project_root = project_root()?;
    let task_prompt = task_prompt_from_args();
    let specs = build_agent_specs(&project_root, None)?;
    let junie_path = resolve_junie()?;
    let redis_url = std::env::var("SWARM_REDIS_URL").ok();

    enable_raw_mode()?;
    io::stdout().execute(EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(io::stdout());
    let mut terminal = Terminal::new(backend)?;

    let (tx, mut rx) = mpsc::unbounded_channel::<AppEvent>();
    let mut app = App::new(
        &specs,
        junie_path.display().to_string(),
        task_prompt.clone(),
    );

    let tx_redis = tx.clone();
    let redis_specs = specs.clone();
    let redis_url_for_poller = redis_url.clone();
    tokio::spawn(async move { redis_poller(redis_url_for_poller, redis_specs, tx_redis).await });

    let tick_rate = Duration::from_millis(16);
    let mut last_tick = Instant::now();
    let mut agent_controls: HashMap<String, mpsc::UnboundedSender<AgentCommand>> = HashMap::new();

    loop {
        terminal.draw(|f| draw(f, &app))?;

        while let Ok(ev) = rx.try_recv() {
            app.handle_event(ev);
        }

        if app.shutdown_requested {
            for tx_agent in agent_controls.values() {
                let _ = tx_agent.send(AgentCommand::Stop);
            }
        }

        let timeout = tick_rate.saturating_sub(last_tick.elapsed());
        if event::poll(timeout)? {
            if let CEvent::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Press {
                    match key.code {
                        KeyCode::Char('q') | KeyCode::Esc => app.quit = true,
                        KeyCode::Char(ch) if !app.launched => app.task_input.push(ch),
                        KeyCode::Backspace if !app.launched => {
                            app.task_input.pop();
                        }
                        KeyCode::Enter if !app.launched => {
                            let launch_task = app.current_task_prompt();
                            let launch_specs = build_agent_specs(&project_root, launch_task.as_deref())?;
                            app.reset_for_next_run();
                            clear_swarm_redis_state(redis_url.as_deref(), &launch_specs, &tx).await;
                            while let Ok(ev) = rx.try_recv() {
                                app.handle_event(ev);
                            }
                            app.launched = true;
                            for spec in launch_specs {
                                let tx_agent = tx.clone();
                                let path = junie_path.clone();
                                let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
                                agent_controls.insert(spec.id.clone(), cmd_tx);
                                tokio::spawn(async move { spawn_agent(spec, path, tx_agent, cmd_rx).await });
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        if !app.launched && app.completion_logged && !agent_controls.is_empty() {
            agent_controls.clear();
        }

        if last_tick.elapsed() >= tick_rate {
            last_tick = Instant::now();
        }

        if app.quit {
            break;
        }
    }

    disable_raw_mode()?;
    io::stdout().execute(LeaveAlternateScreen)?;
    Ok(())
}
