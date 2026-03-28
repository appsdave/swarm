[2026-03-28 16:24] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "missing dependency",
    "EXPECTATION": "User expected the TUI to successfully spawn junie processes without 'No such file or directory' errors.",
    "NEW INSTRUCTION": "WHEN TUI shows 'Failed to spawn junie' os error 2 THEN provide exact steps to install junie and add it to PATH"
}

[2026-03-28 16:29] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "missing config",
    "EXPECTATION": "User wants clear, step-by-step instructions to set and verify SWARM_REDIS_URL when the TUI reports it is not set.",
    "NEW INSTRUCTION": "WHEN TUI footer shows 'SWARM_REDIS_URL not set' OR user asks to setup Redis THEN give exact steps to get Render External URL, export SWARM_REDIS_URL, persist to shell profile, and verify with redis-cli"
}

[2026-03-28 16:43] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "missing binary",
    "EXPECTATION": "User expected the TUI binary at ./tui/target/release/tui to exist and run.",
    "NEW INSTRUCTION": "WHEN user gets 'No such file or directory' for TUI binary THEN show cargo build steps and correct path or use cargo run"
}

[2026-03-28 16:49] - Updated by Junie
{
    "TYPE": "preference",
    "CATEGORY": "auto shutdown",
    "EXPECTATION": "User wants the swarm to automatically terminate agent processes once both agents finish to avoid wasting RAM.",
    "NEW INSTRUCTION": "WHEN both agents report status 'done' or exit successfully THEN kill their PIDs and print completion summary"
}

[2026-03-28 16:57] - Updated by Junie
{
    "TYPE": "preference",
    "CATEGORY": "interactive re-prompt",
    "EXPECTATION": "User wants to enter a new prompt inside the TUI without quitting, have logs cleared, agents killed, and a fresh run started for one-time tasks.",
    "NEW INSTRUCTION": "WHEN user selects 'new task' inside TUI THEN prompt for task, clear logs, kill agent PIDs, and relaunch agents with new task"
}

[2026-03-28 17:31] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "bad repo URL",
    "EXPECTATION": "User expects the one-liner bootstrap command to work with the correct GitHub .git URL.",
    "NEW INSTRUCTION": "WHEN bootstrap git clone returns 'Repository not found' THEN provide the correct .git URL and a fixed one-liner"
}

[2026-03-28 17:34] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "worktree setup error",
    "EXPECTATION": "User expected 'swarm setup' to create agent branches and worktrees without Git errors.",
    "NEW INSTRUCTION": "WHEN 'fatal: invalid reference: agent/<role>' appears during swarm setup THEN show steps to init Git, ensure a main branch with at least one commit, and re-run setup"
}

[2026-03-28 17:35] - Updated by Junie
{
    "TYPE": "preference",
    "CATEGORY": "auto env export",
    "EXPECTATION": "User wants the setup/installer to automatically run and persist required export commands instead of asking them to copy-paste.",
    "NEW INSTRUCTION": "WHEN user runs bootstrap, install, or `swarm setup` THEN prompt for Redis URL, export it now, and persist PATH and SWARM_REDIS_URL to shell profiles"
}

[2026-03-28 18:17] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "stale status indicator",
    "EXPECTATION": "User expects the TUI status to switch from RUNNING to DONE/FAILED immediately when an agent process exits.",
    "NEW INSTRUCTION": "WHEN an agent child process exits (any code) THEN update Redis status and TUI badge to DONE on 0 or FAILED on non-zero, stop tailing its logs, and record an end timestamp"
}

[2026-03-28 18:26] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "misunderstood intent",
    "EXPECTATION": "User wanted concrete steps to add Option 1 (Redis request/needs/offers) communication into their existing swarm, not example project prompts.",
    "NEW INSTRUCTION": "WHEN user asks to add Option 1 communication THEN show exact Redis keys and prompt file edits for both agents without proposing sample projects"
}

[2026-03-28 18:27] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "misunderstood intent",
    "EXPECTATION": "User wants concrete steps to integrate Option 1 (needs/offers via Redis) into the existing swarm, including exact keys and prompt file edits, not sample project prompts.",
    "NEW INSTRUCTION": "WHEN user asks to add Option 1 communication THEN show Redis keys and edit steps for both prompts; no sample projects"
}

[2026-03-28 18:54] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "misunderstood intent",
    "EXPECTATION": "User wants the assistant to inspect local worktrees for uncommitted and unpushed changes since agents didn’t commit, push, or open PRs.",
    "NEW INSTRUCTION": "WHEN user asks to check local worktrees for changes THEN provide exact git commands to list untracked, staged, and unpushed changes per worktree"
}

[2026-03-28 19:01] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "unresolved PR conflicts",
    "EXPECTATION": "User expected PR #2 to be conflict-free or to receive concrete steps to resolve the merge conflicts.",
    "NEW INSTRUCTION": "WHEN user reports PR has merge conflicts THEN provide exact git commands to resolve, merge main, push updates, and update PR"
}

[2026-03-28 19:09] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "missing PR automation",
    "EXPECTATION": "User expected agents to automatically commit, push, and open PRs on their branches before exiting when they report done.",
    "NEW INSTRUCTION": "WHEN agents exit done and no PRs appear THEN show per-worktree git and gh commands to commit, push, and create PRs, and how to verify"
}

[2026-03-28 19:14] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "incomplete update rebuild",
    "EXPECTATION": "User expects `swarm update` to rebuild the TUI and reinstall binaries so recent UI changes take effect.",
    "NEW INSTRUCTION": "WHEN user runs swarm update or -u THEN rebuild TUI with cargo release and reinstall binaries to PATH, then show version verification steps"
}

[2026-03-28 19:14] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "unseen PR changes",
    "EXPECTATION": "User expected the UI changes from PRs #2 and #4 to be visible after updating.",
    "NEW INSTRUCTION": "WHEN user says UI changes from PRs are not visible THEN verify PRs merged, pull latest, rebuild TUI release, reinstall, and show version check"
}

[2026-03-28 19:23] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "missing update on VPS",
    "EXPECTATION": "User expected the latest changes to be present on their VPS and accessible via Tailscale.",
    "NEW INSTRUCTION": "WHEN user says updates not on VPS THEN provide git pull and swarm -u steps on VPS and verify versions"
}

[2026-03-28 19:26] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "prompt submit 404",
    "EXPECTATION": "User expected the TUI to successfully send prompts without a 404 error.",
    "NEW INSTRUCTION": "WHEN TUI shows 'Request failed: 404' on prompt send THEN show steps to verify API endpoint, fix URL in config, ensure server running, and retest with curl"
}

[2026-03-28 19:39] - Updated by Junie
{
    "TYPE": "preference",
    "CATEGORY": "auto worktree creation",
    "EXPECTATION": "User expects the swarm to create required agent worktrees automatically when they are missing.",
    "NEW INSTRUCTION": "WHEN swarm shows 'No matching worktrees found' THEN run 'swarm setup' to create agent branches and worktrees and verify"
}

[2026-03-28 19:41] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "worktree already registered",
    "EXPECTATION": "User expected swarm to recover from 'missing but already registered worktree' and continue launching.",
    "NEW INSTRUCTION": "WHEN git says 'missing but already registered worktree' THEN run 'git worktree prune' then 'git worktree add -f <path> <branch>' and retry"
}

[2026-03-28 19:46] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "push rejected + auto pull",
    "EXPECTATION": "User wants backend push failures due to non-fast-forward resolved and merge conflicts fixed, and for the swarm to auto-pull updates at launch of each new task.",
    "NEW INSTRUCTION": "WHEN launching new task OR push rejected non-fast-forward THEN run git pull --rebase in all worktrees and retry push or force-with-lease"
}

[2026-03-28 19:52] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "wrong project context",
    "EXPECTATION": "User wants agents to know this is a Rust TUI (not a web app), delete and reinitialize worktrees, and analyze the project before making edits.",
    "NEW INSTRUCTION": "WHEN agent suggests web app changes or files THEN set prompts to 'Rust TUI', recreate worktrees, analyze before edits"
}

[2026-03-28 19:53] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "over-specific prompts",
    "EXPECTATION": "User wants backend agents to re-analyze the current repository on start and not assume this specific TUI project.",
    "NEW INSTRUCTION": "WHEN backend agent starts in any repository THEN run fresh codebase analysis and set project context dynamically"
}

[2026-03-28 19:54] - Updated by Junie
{
    "TYPE": "preference",
    "CATEGORY": "project understanding",
    "EXPECTATION": "User wants agents to analyze the current project and context first so they don’t produce irrelevant or random changes.",
    "NEW INSTRUCTION": "WHEN any agent starts on a repository THEN analyze repo and summarize plan before edits"
}

[2026-03-28 20:35] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "gitignore not applied",
    "EXPECTATION": "User expects Rust build artifacts (target/.fingerprint) to be ignored and not appear in PRs.",
    "NEW INSTRUCTION": "WHEN PR shows target/.fingerprint files THEN add target/ to .gitignore, purge cached files, and push"
}

[2026-03-28 22:02] - Updated by Junie
{
    "TYPE": "preference",
    "CATEGORY": "use paid resources",
    "EXPECTATION": "User wants solutions that leverage already-paid Render resources instead of removing or downgrading them.",
    "NEW INSTRUCTION": "WHEN user says they already paid for Render resources THEN propose ways to utilize and optimize them rather than suggest removal"
}

[2026-03-28 22:29] - Updated by Junie
{
    "TYPE": "preference",
    "CATEGORY": "prefer TUI",
    "EXPECTATION": "User wants solutions that avoid browser/web dashboards and keep functionality inside the TUI.",
    "NEW INSTRUCTION": "WHEN suggesting dashboards or control planes THEN propose in-TUI features and avoid web UI"
}

[2026-03-28 23:15] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "overcomplicated merge",
    "EXPECTATION": "User wants the tabs/messages merged simply without adding new complex structures or background tasks, and to restore the previous commands/keybinds.",
    "NEW INSTRUCTION": "WHEN asked to 'just merge tabs/messages' THEN minimally merge labels; keep Tab/'v' and CLI -h -v -u"
}

[2026-03-28 23:44] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "update behavior path",
    "EXPECTATION": "User expects the update to run a git pull in their working repo (/home/balls/ambition), not only in ~/.swarm/repo.",
    "NEW INSTRUCTION": "WHEN user runs swarm -u THEN run git pull --rebase in CWD and in ~/.swarm/repo"
}

