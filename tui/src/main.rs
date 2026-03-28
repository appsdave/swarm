use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use crossterm::event::{self, Event as CEvent, KeyCode, KeyEventKind, KeyModifiers};
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
const MAX_MESSAGES: usize = 500;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ViewTab {
    Logs,
    Messages,
}

impl ViewTab {
    fn label(self) -> &'static str {
        match self {
            Self::Logs => "Logs",
            Self::Messages => "Messages",
        }
    }
}

#[derive(Debug, Clone)]
struct MessageEntry {
    timestamp: String,
    from: String,
    to: String,
    body: String,
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
    AgentMessage { from: String, to: String, body: String },
    NegotiationUpdate {
        agent_id: String,
        offers: Option<String>,
        needs: Option<String>,
    },
    RedisError(String),
    AgentSpawned { agent_id: String, pid: u32 },
    AgentExited { agent_id: String, code: Option<i32> },
    MessageSent { to: String, body: String },
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
    #[allow(dead_code)]
    junie_path: String,
    task_input: String,
    cursor_pos: usize,
    schema_state: HashMap<String, bool>,
    // Agent communication features
    active_tab: ViewTab,
    messages: Vec<MessageEntry>,
    composing: bool,
    compose_input: String,
    compose_cursor: usize,
    compose_target: AgentRole,
    agent_offers: HashMap<String, String>,
    agent_needs: HashMap<String, String>,
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
            task_input: task_prompt.clone().unwrap_or_default(),
            cursor_pos: task_prompt.as_deref().unwrap_or_default().len(),
            schema_state: HashMap::new(),
            active_tab: ViewTab::Logs,
            messages: Vec::new(),
            composing: false,
            compose_input: String::new(),
            compose_cursor: 0,
            compose_target: AgentRole::Frontend,
            agent_offers: HashMap::new(),
            agent_needs: HashMap::new(),
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
        self.task_input.clear();
        self.cursor_pos = 0;
        self.messages.clear();
        self.composing = false;
        self.compose_input.clear();
        self.compose_cursor = 0;
        self.agent_offers.clear();
        self.agent_needs.clear();

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
                    // Don't let Redis overwrite the status of an agent that already exited
                    if agent.exit_code.is_some() {
                        // still track raw_status for the all_agents_done_in_redis check
                        agent.raw_status = Some(status_raw.clone());
                    } else if agent.raw_status.as_deref() != Some(status_raw.as_str()) {
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
            AppEvent::AgentMessage { from, to, body } => {
                let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                self.messages.push(MessageEntry {
                    timestamp: timestamp.clone(),
                    from: from.clone(),
                    to: to.clone(),
                    body: body.clone(),
                });
                if self.messages.len() > MAX_MESSAGES {
                    let overflow = self.messages.len() - MAX_MESSAGES;
                    self.messages.drain(0..overflow);
                }
                let msg = format!("💬 [{from} → {to}] {body}");
                self.push_agent_log(&to, msg.clone());
                self.push_agent_log(&from, msg);
            }
            AppEvent::NegotiationUpdate { agent_id, offers, needs } => {
                if let Some(o) = offers {
                    let prev = self.agent_offers.insert(agent_id.clone(), o.clone());
                    if prev.as_deref() != Some(o.as_str()) {
                        self.push_agent_log(&agent_id, format!("[redis] offers -> {o}"));
                    }
                }
                if let Some(n) = needs {
                    let prev = self.agent_needs.insert(agent_id.clone(), n.clone());
                    if prev.as_deref() != Some(n.as_str()) {
                        self.push_agent_log(&agent_id, format!("[redis] needs -> {n}"));
                    }
                }
            }
            AppEvent::MessageSent { to, body } => {
                let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();
                self.messages.push(MessageEntry {
                    timestamp: timestamp.clone(),
                    from: "tui-operator".into(),
                    to: to.clone(),
                    body: body.clone(),
                });
                if self.messages.len() > MAX_MESSAGES {
                    let overflow = self.messages.len() - MAX_MESSAGES;
                    self.messages.drain(0..overflow);
                }
                let msg = format!("💬 [tui-operator → {to}] {body}");
                self.push_system_log(msg);
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

                    // Poll message queue for this agent (both id-based and role-based keys)
                    let msg_keys = vec![
                        format!("msg:{}", spec.id),
                        format!("msg:{}", spec.role.as_str()),
                    ];
                    for msg_key in msg_keys {
                        if let Ok(messages) = redis::cmd("LRANGE")
                            .arg(&msg_key)
                            .arg(0i64)
                            .arg(-1i64)
                            .query_async::<Vec<String>>(&mut con)
                            .await
                        {
                            if !messages.is_empty() {
                                let _ = redis::cmd("DEL")
                                    .arg(&msg_key)
                                    .query_async::<u64>(&mut con)
                                    .await;
                                for raw in messages {
                                    // Messages stored as "from_agent|body"
                                    let (from, body) = raw.split_once('|')
                                        .map(|(f, b)| (f.to_string(), b.to_string()))
                                        .unwrap_or_else(|| ("unknown".into(), raw.clone()));
                                    let _ = tx.send(AppEvent::AgentMessage {
                                        from,
                                        to: spec.id.clone(),
                                        body,
                                    });
                                }
                            }
                        }
                    }

                    // Poll negotiation keys (offers/needs)
                    let offers_key = format!("request:{}:offers", spec.id);
                    let needs_key = format!("request:{}:needs", spec.id);
                    let offers = redis::cmd("GET")
                        .arg(&offers_key)
                        .query_async::<Option<String>>(&mut con)
                        .await
                        .ok()
                        .flatten()
                        .map(|v| v.trim().to_string())
                        .filter(|v| !v.is_empty());
                    let needs = redis::cmd("GET")
                        .arg(&needs_key)
                        .query_async::<Option<String>>(&mut con)
                        .await
                        .ok()
                        .flatten()
                        .map(|v| v.trim().to_string())
                        .filter(|v| !v.is_empty());
                    if offers.is_some() || needs.is_some() {
                        let _ = tx.send(AppEvent::NegotiationUpdate {
                            agent_id: spec.id.clone(),
                            offers,
                            needs,
                        });
                    }
                }

                // Poll role-level message queues (msg:frontend, msg:backend)
                for role in [AgentRole::Frontend, AgentRole::Backend] {
                    let role_msg_key = format!("msg:{}", role.as_str());
                    if let Ok(messages) = redis::cmd("LRANGE")
                        .arg(&role_msg_key)
                        .arg(0i64)
                        .arg(-1i64)
                        .query_async::<Vec<String>>(&mut con)
                        .await
                    {
                        if !messages.is_empty() {
                            let _ = redis::cmd("DEL")
                                .arg(&role_msg_key)
                                .query_async::<u64>(&mut con)
                                .await;
                            for raw in messages {
                                let (from, body) = raw.split_once('|')
                                    .map(|(f, b)| (f.to_string(), b.to_string()))
                                    .unwrap_or_else(|| ("unknown".into(), raw.clone()));
                                let _ = tx.send(AppEvent::AgentMessage {
                                    from,
                                    to: role.as_str().to_string(),
                                    body,
                                });
                            }
                        }
                    }
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

            // Poll message queue via CLI (both id-based and role-based keys)
            let msg_keys = vec![
                format!("msg:{}", spec.id),
                format!("msg:{}", spec.role.as_str()),
            ];
            for msg_key in msg_keys {
                if let Ok(out) = Command::new("redis-cli")
                    .args(["-u", url, "--tls", "LRANGE", &msg_key, "0", "-1"])
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .output()
                    .await
                {
                    let raw_out = String::from_utf8_lossy(&out.stdout);
                    let messages: Vec<&str> = raw_out.lines()
                        .map(|l| l.trim())
                        .filter(|l| !l.is_empty() && *l != "(empty list or set)" && *l != "(nil)")
                        .filter(|l| !l.starts_with("(integer)"))
                        .collect();
                    if !messages.is_empty() {
                        let _ = Command::new("redis-cli")
                            .args(["-u", url, "--tls", "DEL", &msg_key])
                            .stdout(Stdio::null())
                            .stderr(Stdio::null())
                            .output()
                            .await;
                        for raw in messages {
                            let cleaned = raw.strip_prefix(|c: char| c.is_ascii_digit())
                                .and_then(|s| s.strip_prefix(") "))
                                .unwrap_or(raw)
                                .trim_matches('"');
                            let (from, body) = cleaned.split_once('|')
                                .map(|(f, b)| (f.to_string(), b.to_string()))
                                .unwrap_or_else(|| ("unknown".into(), cleaned.to_string()));
                            let _ = tx.send(AppEvent::AgentMessage {
                                from,
                                to: spec.id.clone(),
                                body,
                            });
                        }
                    }
                }
            }

            // Poll negotiation keys via CLI
            let offers_key = format!("request:{}:offers", spec.id);
            let needs_key = format!("request:{}:needs", spec.id);
            if let Ok(out) = Command::new("redis-cli")
                .args(["-u", url, "--tls", "MGET", &offers_key, &needs_key])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await
            {
                let values: Vec<String> = String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .map(|line| line.trim().to_string())
                    .collect();
                let decode_neg = |index: usize| {
                    values
                        .get(index)
                        .map(|v| v.trim_matches('"').trim().to_string())
                        .filter(|v| !v.is_empty() && v != "(nil)")
                };
                let offers = decode_neg(0);
                let needs = decode_neg(1);
                if offers.is_some() || needs.is_some() {
                    let _ = tx.send(AppEvent::NegotiationUpdate {
                        agent_id: spec.id.clone(),
                        offers,
                        needs,
                    });
                }
            }
        }

        // Poll role-level message queues via CLI (msg:frontend, msg:backend)
        for role in [AgentRole::Frontend, AgentRole::Backend] {
            let role_msg_key = format!("msg:{}", role.as_str());
            if let Ok(out) = Command::new("redis-cli")
                .args(["-u", url, "--tls", "LRANGE", &role_msg_key, "0", "-1"])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await
            {
                let raw_out = String::from_utf8_lossy(&out.stdout);
                let messages: Vec<&str> = raw_out.lines()
                    .map(|l| l.trim())
                    .filter(|l| !l.is_empty() && *l != "(empty list or set)" && *l != "(nil)")
                    .filter(|l| !l.starts_with("(integer)"))
                    .collect();
                if !messages.is_empty() {
                    let _ = Command::new("redis-cli")
                        .args(["-u", url, "--tls", "DEL", &role_msg_key])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .output()
                        .await;
                    for raw in messages {
                        let cleaned = raw.strip_prefix(|c: char| c.is_ascii_digit())
                            .and_then(|s| s.strip_prefix(") "))
                            .unwrap_or(raw)
                            .trim_matches('"');
                        let (from, body) = cleaned.split_once('|')
                            .map(|(f, b)| (f.to_string(), b.to_string()))
                            .unwrap_or_else(|| ("unknown".into(), cleaned.to_string()));
                        let _ = tx.send(AppEvent::AgentMessage {
                            from,
                            to: role.as_str().to_string(),
                            body,
                        });
                    }
                }
            }
        }

        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

async fn send_redis_message(redis_url: Option<&str>, to: &str, body: &str, tx: &mpsc::UnboundedSender<AppEvent>) {
    let Some(url) = redis_url else {
        let _ = tx.send(AppEvent::RedisError("Cannot send message: SWARM_REDIS_URL not set".into()));
        return;
    };

    let msg = format!("tui-operator|{body}");
    let msg_key = format!("msg:{to}");

    let result: Result<(), String> = if url.starts_with("rediss://") {
        Command::new("redis-cli")
            .args(["-u", url, "--tls", "LPUSH", &msg_key, &msg])
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
        match redis::Client::open(url) {
            Ok(client) => match client.get_multiplexed_async_connection().await {
                Ok(mut con) => redis::cmd("LPUSH")
                    .arg(&msg_key)
                    .arg(&msg)
                    .query_async::<u64>(&mut con)
                    .await
                    .map(|_| ())
                    .map_err(|e| e.to_string()),
                Err(e) => Err(e.to_string()),
            },
            Err(e) => Err(e.to_string()),
        }
    };

    match result {
        Ok(()) => {
            let _ = tx.send(AppEvent::MessageSent {
                to: to.to_string(),
                body: body.to_string(),
            });
        }
        Err(err) => {
            let _ = tx.send(AppEvent::RedisError(format!("Failed to send message: {err}")));
        }
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

    // Pull latest changes in the worktree before starting the agent
    {
        let branch = format!("agent/{}", spec.role.as_str());
        send_log(format!("🔄 Pulling latest changes for {}...", branch));
        match Command::new("git")
            .args(["pull", "--rebase", "origin", &branch])
            .current_dir(&spec.worktree)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
        {
            Ok(out) => {
                let msg = String::from_utf8_lossy(&out.stdout);
                let err = String::from_utf8_lossy(&out.stderr);
                if out.status.success() {
                    send_log(format!("✅ Pull done: {}", msg.trim()));
                } else {
                    send_log(format!("⚠️ Pull failed (non-fatal): {} {}", msg.trim(), err.trim()));
                }
            }
            Err(e) => send_log(format!("⚠️ git pull failed (non-fatal): {e}")),
        }
    }

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

    // --- Post-completion: auto commit, push, and create PR ---
    {
        let branch = format!("agent/{}", spec.role.as_str());
        let label = spec.role.as_str().to_string();
        let worktree = spec.worktree.clone();

        // Look for post-agent-commit.sh relative to the project root
        let project_root = worktree.parent().unwrap_or(&worktree);
        let script = project_root.join("scripts/post-agent-commit.sh");

        if script.exists() {
            send_log(format!("📦 Running post-completion commit/push/PR for {}...", label));
            match Command::new("bash")
                .args([
                    script.to_str().unwrap_or("scripts/post-agent-commit.sh"),
                    worktree.to_str().unwrap_or("."),
                    &branch,
                    &label,
                ])
                .current_dir(&worktree)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(mut post_child) => {
                    // Stream post-commit output to the TUI log pane
                    if let Some(stdout) = post_child.stdout.take() {
                        let tx3 = tx.clone();
                        let aid = spec.id.clone();
                        tokio::spawn(async move {
                            let mut reader = BufReader::new(stdout).lines();
                            while let Ok(Some(line)) = reader.next_line().await {
                                let _ = tx3.send(AppEvent::Log {
                                    agent_id: aid.clone(),
                                    line: sanitize_log_line(&line),
                                });
                            }
                        });
                    }
                    if let Some(stderr) = post_child.stderr.take() {
                        let tx3 = tx.clone();
                        let aid = spec.id.clone();
                        tokio::spawn(async move {
                            let mut reader = BufReader::new(stderr).lines();
                            while let Ok(Some(line)) = reader.next_line().await {
                                let _ = tx3.send(AppEvent::Log {
                                    agent_id: aid.clone(),
                                    line: format!("[post-commit] {}", sanitize_log_line(&line)),
                                });
                            }
                        });
                    }
                    match post_child.wait().await {
                        Ok(s) => send_log(format!("📦 Post-completion finished (exit {})", s.code().unwrap_or(-1))),
                        Err(e) => send_log(format!("⚠️ Post-completion error: {e}")),
                    }
                }
                Err(e) => {
                    send_log(format!("⚠️ Failed to run post-commit script: {e}"));
                }
            }
        } else {
            send_log(format!("⚠️ Post-commit script not found at {}", script.display()));
        }
    }

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
        "push:frontend".to_string(),
        "push:backend".to_string(),
        "msg:frontend".to_string(),
        "msg:backend".to_string(),
    ];
    for spec in specs {
        keys.push(spec.status_key.clone());
        keys.push(format!("agent:{}:task", spec.id));
        keys.push(format!("agent:{}:last_poll", spec.id));
        keys.push(format!("blocked:{}", spec.id));
        keys.push(format!("request:{}:offers", spec.id));
        keys.push(format!("request:{}:needs", spec.id));
        keys.push(format!("msg:{}", spec.id));
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
    let available_width = f.area().width.saturating_sub(2) as usize;
    let bottom_input_height = if app.composing {
        3u16
    } else if available_width == 0 {
        3
    } else {
        let display_text = if app.task_input.trim().is_empty() {
            "Type the next one-off swarm task here..."
        } else {
            app.task_input.as_str()
        };
        let text_lines = (display_text.len() + available_width - 1) / available_width;
        (text_lines as u16 + 2).clamp(3, 10)
    };

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(12),
            Constraint::Min(10),
            Constraint::Length(bottom_input_height),
            Constraint::Length(3),
        ])
        .split(f.area());

    draw_status(f, app, chunks[0]);
    match app.active_tab {
        ViewTab::Logs => draw_logs(f, app, chunks[1]),
        ViewTab::Messages => draw_messages(f, app, chunks[1]),
    }
    if app.composing {
        draw_compose_input(f, app, chunks[2]);
    } else {
        draw_task_input(f, app, chunks[2]);
    }
    draw_help(f, app, chunks[3]);
}

fn draw_status(f: &mut ratatui::Frame, app: &App, area: Rect) {
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(1)])
        .split(area);

    // Tab bar
    let tab_spans: Vec<Span> = vec![
        Span::styled(" ", Style::default()),
        Span::styled(
            format!(" {} ", ViewTab::Logs.label()),
            if app.active_tab == ViewTab::Logs {
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD | Modifier::UNDERLINED)
            } else {
                Style::default().fg(Color::DarkGray)
            },
        ),
        Span::styled("  │  ", Style::default().fg(Color::Rgb(60, 60, 60))),
        Span::styled(
            format!(" {} ({}) ", ViewTab::Messages.label(), app.messages.len()),
            if app.active_tab == ViewTab::Messages {
                Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD | Modifier::UNDERLINED)
            } else {
                Style::default().fg(Color::DarkGray)
            },
        ),
        Span::styled("    ", Style::default()),
        Span::styled("Tab", Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
        Span::styled(" switch view", Style::default().fg(Color::DarkGray)),
    ];
    f.render_widget(Paragraph::new(Line::from(tab_spans)), rows[0]);

    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(rows[1]);

    render_agent_column(
        f,
        " Frontend Agents ",
        &app.ordered_agents(&app.frontend_order),
        AgentRole::Frontend.color(),
        &app.agent_offers,
        &app.agent_needs,
        cols[0],
    );
    render_agent_column(
        f,
        " Backend Agents ",
        &app.ordered_agents(&app.backend_order),
        AgentRole::Backend.color(),
        &app.agent_offers,
        &app.agent_needs,
        cols[1],
    );
}

fn render_agent_column(
    f: &mut ratatui::Frame,
    title: &str,
    agents: &[&AgentState],
    color: Color,
    offers: &HashMap<String, String>,
    needs: &HashMap<String, String>,
    area: Rect,
) {
    let mut items: Vec<ListItem> = Vec::new();
    for agent in agents {
        let mut spans = vec![
            Span::styled(
                format!("{} ", agent.spec.label),
                Style::default().fg(color).add_modifier(Modifier::BOLD),
            ),
            Span::raw(agent.status.as_str()),
        ];
        if let Some(task) = &agent.task {
            spans.push(Span::styled(
                format!("  📋 {}", truncate_str(task, 40)),
                Style::default().fg(Color::DarkGray),
            ));
        }
        items.push(ListItem::new(Line::from(spans)));

        // Show offers/needs on a sub-line if available
        let id = &agent.spec.id;
        let has_offers = offers.get(id);
        let has_needs = needs.get(id);
        if has_offers.is_some() || has_needs.is_some() {
            let mut sub_spans: Vec<Span> = vec![Span::raw("   ")];
            if let Some(o) = has_offers {
                sub_spans.push(Span::styled(
                    format!("📤 {}", truncate_str(o, 35)),
                    Style::default().fg(Color::Green),
                ));
            }
            if let Some(n) = has_needs {
                if has_offers.is_some() {
                    sub_spans.push(Span::raw("  "));
                }
                sub_spans.push(Span::styled(
                    format!("📥 {}", truncate_str(n, 35)),
                    Style::default().fg(Color::Red),
                ));
            }
            items.push(ListItem::new(Line::from(sub_spans)));
        }
    }

    let list = List::new(items).block(
        Block::default()
            .title(title)
            .borders(Borders::ALL)
            .border_style(Style::default().fg(color)),
    );
    f.render_widget(list, area);
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{truncated}…")
    }
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

fn draw_messages(f: &mut ratatui::Frame, app: &App, area: Rect) {
    let inner_height = area.height.saturating_sub(2) as usize;
    let start = app.messages.len().saturating_sub(inner_height);

    let items: Vec<ListItem> = app.messages[start..]
        .iter()
        .map(|msg| {
            let direction_color = if msg.from == "tui-operator" {
                Color::Green
            } else {
                Color::Cyan
            };
            let line = Line::from(vec![
                Span::styled(
                    format!("[{}] ", msg.timestamp),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::styled(
                    format!("{} → {} ", msg.from, msg.to),
                    Style::default().fg(direction_color).add_modifier(Modifier::BOLD),
                ),
                Span::styled(&msg.body, Style::default().fg(Color::White)),
            ]);
            ListItem::new(line)
        })
        .collect();

    let title = format!(" Messages ({}) ", app.messages.len());
    let list = List::new(items).block(
        Block::default()
            .title(title.as_str())
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Yellow)),
    );
    f.render_widget(list, area);
}

fn draw_compose_input(f: &mut ratatui::Frame, app: &App, area: Rect) {
    let target_label = app.compose_target.display_name();
    let title = format!(" Send to {} (Ctrl+T switch target, Enter send, Esc cancel) ", target_label);
    let display_text = if app.compose_input.is_empty() {
        "Type your message..."
    } else {
        app.compose_input.as_str()
    };
    let is_placeholder = app.compose_input.is_empty();
    let style = if is_placeholder {
        Style::default().fg(Color::DarkGray)
    } else {
        Style::default().fg(Color::White)
    };

    let paragraph = Paragraph::new(display_text)
        .style(style)
        .block(
            Block::default()
                .title(title.as_str())
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Green)),
        )
        .wrap(Wrap { trim: true });

    f.render_widget(Clear, area);
    f.render_widget(paragraph, area);

    if !is_placeholder {
        let inner_width = area.width.saturating_sub(2) as usize;
        let cursor_x = if inner_width > 0 {
            (app.compose_cursor % inner_width) as u16
        } else {
            0
        };
        let cursor_y = if inner_width > 0 {
            (app.compose_cursor / inner_width) as u16
        } else {
            0
        };
        f.set_cursor_position((area.x + 1 + cursor_x, area.y + 1 + cursor_y));
    }
}

fn draw_task_input(f: &mut ratatui::Frame, app: &App, area: Rect) {
    let border_color = if app.launched { Color::DarkGray } else { Color::Green };
    let title = if app.launched {
        " Swarm Task (locked while running) "
    } else {
        " Swarm Task Input "
    };
    let is_placeholder = app.task_input.trim().is_empty();
    let display_text = if is_placeholder {
        "Type the next one-off swarm task here..."
    } else {
        app.task_input.as_str()
    };
    let style = if is_placeholder {
        Style::default().fg(Color::DarkGray)
    } else {
        Style::default().fg(Color::White)
    };

    let inner_width = area.width.saturating_sub(2) as usize;
    let inner_height = area.height.saturating_sub(2) as u16;

    // For the cursor: figure out which wrapped line the cursor sits on
    let cursor_byte_pos = if is_placeholder { 0 } else { app.cursor_pos };
    let text_up_to_cursor = &display_text[..cursor_byte_pos.min(display_text.len())];

    // Count wrapped lines up to the cursor position
    let cursor_wrapped_line = if inner_width > 0 {
        let mut line_count: u16 = 0;
        for logical_line in text_up_to_cursor.split('\n') {
            let char_len = logical_line.chars().count();
            if char_len == 0 {
                line_count += 1;
            } else {
                line_count += ((char_len as f64) / (inner_width as f64)).ceil() as u16;
            }
        }
        // line_count is 1-based total lines; convert to 0-based line index
        line_count.saturating_sub(1)
    } else {
        0
    };

    // Count total wrapped lines for the full text
    let total_wrapped_lines = if inner_width > 0 {
        display_text
            .split('\n')
            .map(|line| {
                let len = line.chars().count();
                if len == 0 {
                    1
                } else {
                    ((len as f64) / (inner_width as f64)).ceil() as u16
                }
            })
            .sum::<u16>()
            .max(1)
    } else {
        1
    };

    // Scroll so the cursor line is always visible
    let scroll_offset = if cursor_wrapped_line >= inner_height {
        cursor_wrapped_line - inner_height + 1
    } else if total_wrapped_lines > inner_height {
        // If cursor is in view from top, keep it there; otherwise scroll to end
        0
    } else {
        0
    };

    let paragraph = Paragraph::new(display_text)
        .style(style)
        .block(
            Block::default()
                .title(title)
                .borders(Borders::ALL)
                .border_style(Style::default().fg(border_color)),
        )
        .wrap(Wrap { trim: true })
        .scroll((scroll_offset, 0));

    f.render_widget(Clear, area);
    f.render_widget(paragraph, area);

    // Place the terminal cursor at the editing position when not launched
    if !app.launched && !is_placeholder {
        // Calculate cursor x,y within the inner area
        let chars_on_last_logical_line = text_up_to_cursor
            .rsplit('\n')
            .next()
            .unwrap_or(text_up_to_cursor)
            .chars()
            .count();
        let cursor_x = if inner_width > 0 {
            (chars_on_last_logical_line % inner_width) as u16
        } else {
            0
        };
        let cursor_y = cursor_wrapped_line.saturating_sub(scroll_offset);

        // +1 for the border on each side
        f.set_cursor_position((
            area.x + 1 + cursor_x,
            area.y + 1 + cursor_y,
        ));
    }
}

fn draw_help(f: &mut ratatui::Frame, app: &App, area: Rect) {
    let key_style = Style::default()
        .fg(Color::Yellow)
        .add_modifier(Modifier::BOLD);
    let desc_style = Style::default().fg(Color::DarkGray);
    let sep_style = Style::default().fg(Color::Rgb(60, 60, 60));
    let sep = Span::styled("  │  ", sep_style);

    let mut spans: Vec<Span> = Vec::new();
    spans.push(Span::raw(" "));

    if app.composing {
        spans.push(Span::styled("Enter", key_style));
        spans.push(Span::styled(" Send", desc_style));
        spans.push(sep.clone());
        spans.push(Span::styled("Esc", key_style));
        spans.push(Span::styled(" Cancel", desc_style));
        spans.push(sep.clone());
        spans.push(Span::styled("Ctrl+T", key_style));
        spans.push(Span::styled(" Switch target", desc_style));
    } else if !app.launched {
        spans.push(Span::styled("Enter", key_style));
        spans.push(Span::styled(" Launch swarm", desc_style));
        spans.push(sep.clone());
        spans.push(Span::styled("q", key_style));
        spans.push(Span::styled("/", desc_style));
        spans.push(Span::styled("Esc", key_style));
        spans.push(Span::styled(" Quit", desc_style));
        spans.push(sep.clone());
        spans.push(Span::styled("Tab", key_style));
        spans.push(Span::styled(" Switch view", desc_style));
        spans.push(sep.clone());
        spans.push(Span::styled("Ctrl+M", key_style));
        spans.push(Span::styled(" Send message", desc_style));
    } else {
        spans.push(Span::styled("q", key_style));
        spans.push(Span::styled("/", desc_style));
        spans.push(Span::styled("Esc", key_style));
        spans.push(Span::styled(" Quit", desc_style));
        spans.push(sep.clone());
        spans.push(Span::styled("Tab", key_style));
        spans.push(Span::styled(" Switch view", desc_style));
        spans.push(sep.clone());
        spans.push(Span::styled("Ctrl+M", key_style));
        spans.push(Span::styled(" Send message", desc_style));
    }

    if let Some(err) = &app.redis_error {
        spans.push(sep.clone());
        spans.push(Span::styled(
            format!("⚠ Redis: {err}"),
            Style::default().fg(Color::Red),
        ));
    }

    let line = Line::from(spans);
    let paragraph = Paragraph::new(line).wrap(Wrap { trim: true });
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

fn ensure_worktrees_exist(project_root: &Path) -> Result<()> {
    let frontend = discover_worktrees(project_root, AgentRole::Frontend)?;
    let backend = discover_worktrees(project_root, AgentRole::Backend)?;
    if !frontend.is_empty() && !backend.is_empty() {
        return Ok(());
    }

    eprintln!("⚙️  No worktrees found — creating them automatically...");

    // Prune stale worktree registrations (handles "missing but already registered" errors)
    let _ = std::process::Command::new("git")
        .args(["worktree", "prune"])
        .current_dir(project_root)
        .status();

    // Try setup-worktrees.sh from several locations
    let candidates = [
        project_root.join("setup-worktrees.sh"),
        PathBuf::from(std::env::var("SWARM_HOME").unwrap_or_else(|_| {
            format!("{}/.swarm", std::env::var("HOME").unwrap_or_default())
        }))
        .join("share/setup-worktrees.sh"),
    ];

    if let Some(script) = candidates.iter().find(|p| p.is_file()) {
        let status = std::process::Command::new("bash")
            .arg(script)
            .current_dir(project_root)
            .env("SWARM_PROJECT_ROOT", project_root)
            .status()?;
        if !status.success() {
            anyhow::bail!("setup-worktrees.sh failed (exit {})", status.code().unwrap_or(-1));
        }
        return Ok(());
    }

    // Fallback: create worktrees inline if script not found
    let head = String::from_utf8(
        std::process::Command::new("git")
            .args(["rev-parse", "--verify", "HEAD"])
            .current_dir(project_root)
            .output()?
            .stdout,
    )?;
    let head = head.trim();

    for role in &["frontend", "backend"] {
        let wt_dir = project_root.join(format!("worktree-{role}"));
        if wt_dir.is_dir() {
            continue;
        }
        let branch = format!("agent/{role}");
        // Create branch if it doesn't exist
        let _ = std::process::Command::new("git")
            .args(["branch", &branch, head])
            .current_dir(project_root)
            .status();
        let status = std::process::Command::new("git")
            .args(["worktree", "add", "-f", wt_dir.to_str().unwrap_or("."), &branch])
            .current_dir(project_root)
            .status()?;
        if !status.success() {
            anyhow::bail!("Failed to create worktree for {role}");
        }
        eprintln!("   ✅ Created worktree-{role} (branch: {branch})");
    }

    Ok(())
}

fn build_agent_specs(project_root: &Path, task_prompt: Option<&str>) -> Result<Vec<AgentSpec>> {
    ensure_worktrees_exist(project_root)?;

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
    let other_agent = match role {
        AgentRole::Frontend => "backend",
        AgentRole::Backend => "frontend",
    };

    let publish_note = match role {
        AgentRole::Frontend => format!(
            "When you complete a component or schema that others might need, publish it with:\n\
             ```\n\
             SET {} \"<your JSON data>\"\n\
             ```\n\n\
             Publish **incrementally** — don't wait until everything is done. Each publish should be a valid, usable snapshot.",
            role.schema_key()
        ),
        AgentRole::Backend => format!(
            "**This is your highest-priority deliverable** — the frontend agent depends on it.\n\n\
             Publish your database schema as early as possible:\n\
             ```\n\
             SET {} '{{\"tables\":{{ ... your full JSON schema ... }}}}'\n\
             SET agent:{}:task \"Schema published, continuing backend logic\"\n\
             ```\n\n\
             Guidelines:\n\
             - Publish a **draft schema** as soon as you have a reasonable first pass — don't wait until it's perfect.\n\
             - If you update the schema later, re-publish and notify the frontend:\n\
               ```\n\
               LPUSH msg:{other} \"{id}|[INFO] Schema updated — added new table/fields\"\n\
               ```\n\
             - Include all table names, column names, types, and relationships.\n\
             - Include API endpoint contracts if available: method, path, request/response shapes.",
            role.schema_key(),
            agent_id,
            other = other_agent,
            id = agent_id
        ),
    };

    let role_specific_note = match role {
        AgentRole::Frontend => String::new(),
        AgentRole::Backend => format!(
            "\n**Critical responsibility:** You own the data schema. \
             The frontend agent is almost always blocked on `{}`. \
             Publishing it early is your single most important coordination duty.\n",
            role.schema_key()
        ),
    };

    let task_section = task_prompt
        .map(|task| format!(
            "## Mission\n\
             - Primary task: {task}\n\
             - Coordinate through Redis if you need another agent to unblock you.\n\n"
        ))
        .unwrap_or_default();

    format!(
        "# {label} — {role_name}\n\n\
         You are **{label}**, a {role_name} developer in an autonomous swarm. You work inside `{worktree}`.\n\n\
         ---\n\n\
         ## 1 · Project Understanding (MANDATORY — DO THIS FIRST)\n\n\
         **Before writing ANY code, you MUST build a complete mental model of the project.**\n\
         Skipping or rushing this step is the #1 cause of broken contributions.\n\n\
         ### Phase 1: Discover the Project\n\
         1. `ls` the project root — note every file and directory.\n\
         2. Read `README.md` (if it exists) to understand the project's purpose and goals.\n\
         3. Identify the tech stack by reading config files (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Makefile`, `docker-compose.yml`, etc.).\n\
         4. Determine the **runtime**: Is this a CLI app? A TUI? A web server? A library? A mobile app? Note it explicitly.\n\n\
         ### Phase 2: Understand the Architecture\n\
         5. Read the main entry point(s) (`main.rs`, `index.ts`, `app.py`, `main.go`, etc.) end-to-end.\n\
         6. Map out the directory structure — understand what each top-level folder contains.\n\
         7. Read at least 2–3 existing source files to understand coding patterns, naming conventions, and style.\n\
         8. Identify existing tests and how they are run.\n\n\
         ### Phase 3: Understand the Swarm Context\n\
         9. Read all files in `prompts/` to understand your role and the other agent's role.\n\
         10. Read all files in `scripts/` to understand the automation workflow.\n\
         11. Check Redis for any existing state from the other agent.\n\n\
         ### Phase 4: Plan Before Coding\n\
         12. Write a brief plan of what you will build and which existing files you will modify.\n\
         13. Verify your plan only touches files consistent with the project's actual tech stack.\n\
         14. Identify **dependencies on the other agent** — if you need data, publish your needs key immediately.\n\
         15. **Only then** start implementing.\n\n\
         ### Hard Rules\n\
         - **Do NOT assume** the project structure, language, or framework — inspect it first.\n\
         - **Do NOT create files** that don't match the project's actual tech stack.\n\
         - **Do NOT introduce new frameworks** or languages the project doesn't already use.\n\
         - **Do NOT create a web app** if the project is a CLI/TUI, or vice versa.\n\
         - If you are unsure what the project is, read more files before writing any code.\n\n\
         ---\n\n\
         ## 2 · Your Identity\n\n\
         | Field | Value |\n\
         |---|---|\n\
         | **Agent ID** | `{agent_id}` |\n\
         | **Role** | {role_summary} |\n\
         {role_specific_note}\n\
         {task_section}\
         ---\n\n\
         ## 3 · Structured Reasoning Protocol\n\n\
         For every non-trivial decision, use this thinking framework:\n\n\
         ```\n\
         SITUATION  → What is the current state? What do I know?\n\
         GOAL       → What specific outcome am I trying to achieve?\n\
         OPTIONS    → What are 2-3 possible approaches?\n\
         TRADE-OFFS → What are the pros/cons of each?\n\
         DECISION   → Which option do I choose and why?\n\
         VALIDATION → How will I verify this was the right choice?\n\
         ```\n\n\
         ---\n\n\
         ## 4 · Redis Blackboard Protocol\n\n\
         You communicate through the shared Render Redis blackboard. Use the Render MCP tools or `redis-cli` to interact with it.\n\n\
         ### 4.1 On Startup\n\
         ```\n\
         SET agent:{agent_id}:status running\n\
         SET agent:{agent_id}:task \"{startup_task}\"\n\
         ```\n\n\
         Also check what the other agent has already published:\n\
         ```\n\
         GET schema:{other_agent}\n\
         LRANGE msg:{agent_id} 0 -1\n\
         ```\n\
         - If `schema:{other_agent}` already exists, skip blocking and use it.\n\
         - If there are messages in your inbox, read and respond before starting work.\n\n\
         ### 4.2 Direct Messaging\n\n\
         **To send a message to `{other_agent}`:**\n\
         ```\n\
         LPUSH msg:{other_agent} \"{agent_id}|<your message text>\"\n\
         ```\n\n\
         **To read messages sent to you:**\n\
         ```\n\
         LRANGE msg:{agent_id} 0 -1\n\
         ```\n\
         After reading, clear your inbox:\n\
         ```\n\
         DEL msg:{agent_id}\n\
         ```\n\n\
         **Message conventions:**\n\
         - Prefix with intent: `[Q]` question, `[INFO]` update, `[REQ]` request, `[ACK]` acknowledgement\n\
         - Be specific and actionable — include concrete details (paths, field names, data shapes)\n\
         - Examples:\n\
           - `LPUSH msg:{other_agent} \"{agent_id}|[Q] What format do you need for the API response?\"`\n\
           - `LPUSH msg:{other_agent} \"{agent_id}|[INFO] I changed the auth endpoint to /api/v2/auth\"`\n\
           - `LPUSH msg:{other_agent} \"{agent_id}|[REQ] Please publish schema:{other_agent} — I am blocked on it\"`\n\
           - `LPUSH msg:{other_agent} \"{agent_id}|[ACK] Received your schema, integrating now\"`\n\n\
         **Every poll cycle**, check your message inbox (`LRANGE msg:{agent_id} 0 -1`) and respond to any pending messages before continuing your work.\n\n\
         ### 4.3 When You Need Data From Another Agent\n\
         1. Set your status to blocked:\n\
         ```\n\
         SET agent:{agent_id}:status blocked\n\
         SET blocked:{agent_id} \"{depends_on}\"\n\
         SET agent:{agent_id}:last_poll <current ISO-8601 timestamp>\n\
         ```\n\
         2. Enter the polling loop:\n\
         - Run `sleep 60`\n\
         - After waking, query Redis: `GET {depends_on}`\n\
         - Also check your message inbox: `LRANGE msg:{agent_id} 0 -1`\n\
         - If the key exists and has data, break out of the loop\n\
         - If empty/nil, update `agent:{agent_id}:last_poll` and sleep again\n\
         - Do **not** exit; keep your context alive\n\
         3. On receiving the data:\n\
         ```\n\
         SET agent:{agent_id}:status running\n\
         DEL blocked:{agent_id}\n\
         ```\n\n\
         ### 4.4 Publishing Your Work\n\
         {publish_note}\n\n\
         ### 4.5 Progress Reporting\n\n\
         Update your task description as you progress:\n\
         ```\n\
         SET agent:{agent_id}:task \"Phase N: <description>\"\n\
         ```\n\
         This helps the other agent and the TUI dashboard understand where you are.\n\n\
         ### 4.6 On Completion\n\
         ```\n\
         SET agent:{agent_id}:status done\n\
         SET agent:{agent_id}:task \"{completion_task}\"\n\
         ```\n\n\
         ---\n\n\
         ## 5 · Error Recovery & Self-Healing\n\n\
         ### If Something Breaks\n\
         1. **Do not panic.** Read the error message carefully.\n\
         2. **Check recent changes** — was it something you just modified?\n\
         3. **Search the codebase** for similar patterns that work.\n\
         4. **Consult the other agent** if the error involves a shared interface:\n\
            `LPUSH msg:{other_agent} \"{agent_id}|[Q] I'm hitting an error related to <describe issue>\"`\n\
         5. **Roll back** if your fix makes things worse — prefer a working state over a broken feature.\n\n\
         ### If Blocked for Too Long (> 5 minutes)\n\
         1. Check if the other agent is in `error` or `done` state: `GET agent:{other_agent}:status`\n\
         2. If `error`, send a diagnostic message and proceed with reasonable defaults.\n\
         3. If `done` but missing data, send a follow-up request.\n\n\
         ---\n\n\
         ## 6 · Quality Gates\n\n\
         Before marking yourself as `done`, verify:\n\
         - [ ] **Build passes** — the project compiles/builds without errors.\n\
         - [ ] **No regressions** — existing tests still pass.\n\
         - [ ] **New code is tested** — add tests for significant new functionality.\n\
         - [ ] **Code style matches** — follow existing conventions.\n\
         - [ ] **No dead code** — remove unused imports, stubs, commented-out code.\n\
         - [ ] **Schema published** — if the other agent needs your data, publish it.\n\
         - [ ] **Progress reported** — `agent:{agent_id}:task` reflects the final state.\n\n\
         ---\n\n\
         ## 7 · Work Rules\n\n\
         - Stay inside `{worktree}` — never modify files outside your worktree\n\
         - Never modify files outside your worktree\n\
         - Commit frequently on your own branch/worktree\n\
         - Poll every 60 seconds when blocked; do not poll faster\n\
         - Check your message inbox every poll cycle\n\
         - Keep the session alive until your task is finished\n\
         - Improve the project's file structure when it helps: keep related code grouped by feature, avoid cluttering top-level folders, and place new files where another developer would expect to find them\n\
         - Write clean, production-quality code\n\
         - Prefer small, focused changes over large rewrites\n\
         - When in doubt, read the existing code more carefully before writing new code\n",
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
                    if app.composing {
                        // Compose mode key handling
                        match key.code {
                            KeyCode::Esc => {
                                app.composing = false;
                                app.compose_input.clear();
                                app.compose_cursor = 0;
                            }
                            KeyCode::Enter => {
                                let body = app.compose_input.trim().to_string();
                                if !body.is_empty() {
                                    // Determine target agent IDs for the selected role
                                    let target_ids: Vec<String> = match app.compose_target {
                                        AgentRole::Frontend => app.frontend_order.clone(),
                                        AgentRole::Backend => app.backend_order.clone(),
                                    };
                                    let tx_send = tx.clone();
                                    let redis_url_send = redis_url.clone();
                                    let body_send = body.clone();
                                    tokio::spawn(async move {
                                        for target_id in &target_ids {
                                            send_redis_message(
                                                redis_url_send.as_deref(),
                                                target_id,
                                                &body_send,
                                                &tx_send,
                                            ).await;
                                        }
                                    });
                                }
                                app.composing = false;
                                app.compose_input.clear();
                                app.compose_cursor = 0;
                            }
                            KeyCode::Char('t') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                                app.compose_target = match app.compose_target {
                                    AgentRole::Frontend => AgentRole::Backend,
                                    AgentRole::Backend => AgentRole::Frontend,
                                };
                            }
                            KeyCode::Char(ch) => {
                                app.compose_input.insert(app.compose_cursor, ch);
                                app.compose_cursor += ch.len_utf8();
                            }
                            KeyCode::Backspace if app.compose_cursor > 0 => {
                                let prev = app.compose_input[..app.compose_cursor]
                                    .char_indices()
                                    .next_back()
                                    .map(|(i, _)| i)
                                    .unwrap_or(0);
                                app.compose_input.remove(prev);
                                app.compose_cursor = prev;
                            }
                            KeyCode::Left if app.compose_cursor > 0 => {
                                app.compose_cursor = app.compose_input[..app.compose_cursor]
                                    .char_indices()
                                    .next_back()
                                    .map(|(i, _)| i)
                                    .unwrap_or(0);
                            }
                            KeyCode::Right if app.compose_cursor < app.compose_input.len() => {
                                let next = app.compose_input[app.compose_cursor..]
                                    .char_indices()
                                    .nth(1)
                                    .map(|(i, _)| app.compose_cursor + i)
                                    .unwrap_or(app.compose_input.len());
                                app.compose_cursor = next;
                            }
                            _ => {}
                        }
                    } else {
                        // Normal mode key handling
                        match key.code {
                            KeyCode::Char('q') | KeyCode::Esc => app.quit = true,
                            KeyCode::Tab => {
                                app.active_tab = match app.active_tab {
                                    ViewTab::Logs => ViewTab::Messages,
                                    ViewTab::Messages => ViewTab::Logs,
                                };
                            }
                            KeyCode::Char('m') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                                app.composing = true;
                                app.compose_input.clear();
                                app.compose_cursor = 0;
                                app.active_tab = ViewTab::Messages;
                            }
                            KeyCode::Char(ch) if !app.launched => {
                                app.task_input.insert(app.cursor_pos, ch);
                                app.cursor_pos += ch.len_utf8();
                            }
                            KeyCode::Backspace if !app.launched && app.cursor_pos > 0 => {
                                let prev = app.task_input[..app.cursor_pos]
                                    .char_indices()
                                    .next_back()
                                    .map(|(i, _)| i)
                                    .unwrap_or(0);
                                app.task_input.remove(prev);
                                app.cursor_pos = prev;
                            }
                            KeyCode::Delete if !app.launched && app.cursor_pos < app.task_input.len() => {
                                app.task_input.remove(app.cursor_pos);
                            }
                            KeyCode::Left if !app.launched && app.cursor_pos > 0 => {
                                app.cursor_pos = app.task_input[..app.cursor_pos]
                                    .char_indices()
                                    .next_back()
                                    .map(|(i, _)| i)
                                    .unwrap_or(0);
                            }
                            KeyCode::Right if !app.launched && app.cursor_pos < app.task_input.len() => {
                                let next = app.task_input[app.cursor_pos..]
                                    .char_indices()
                                    .nth(1)
                                    .map(|(i, _)| app.cursor_pos + i)
                                    .unwrap_or(app.task_input.len());
                                app.cursor_pos = next;
                            }
                            KeyCode::Home if !app.launched => {
                                app.cursor_pos = 0;
                            }
                            KeyCode::End if !app.launched => {
                                app.cursor_pos = app.task_input.len();
                            }
                            KeyCode::Enter if !app.launched => {
                                let launch_task = app.current_task_prompt();
                                let launch_specs = build_agent_specs(&project_root, launch_task.as_deref())?;
                                app.task_input.clear();
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
