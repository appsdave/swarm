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
    "EXPECTATION": "User wants the assistant to inspect local worktrees for uncommitted and unpushed changes since agents didn't commit, push, or open PRs.",
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
