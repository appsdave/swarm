#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
SWARM_HOME="${SWARM_HOME:-${HOME}/.swarm}"
BIN_DIR="${SWARM_HOME}/bin"
INSTALL_DIR="${SWARM_HOME}/share"
ENV_FILE="${SWARM_HOME}/env"

ensure_path_entry() {
  local profile_file="$1"
  local export_line='export PATH="$HOME/.swarm/bin:$PATH"'
  local env_line='[ -f "$HOME/.swarm/env" ] && . "$HOME/.swarm/env"'

  if [ ! -f "$profile_file" ]; then
    printf '%s\n%s\n' "$export_line" "$env_line" >"$profile_file"
    return
  fi

  if ! grep -Fqx "$export_line" "$profile_file"; then
    printf '\n%s\n' "$export_line" >>"$profile_file"
  fi

  if ! grep -Fqx "$env_line" "$profile_file"; then
    printf '%s\n' "$env_line" >>"$profile_file"
  fi
}

ensure_env_file() {
  mkdir -p "$SWARM_HOME"
  if [ ! -f "$ENV_FILE" ]; then
    cat >"$ENV_FILE" <<'EOF'
# swarm environment
# Uncomment and set this if you want swarm commands to auto-load Redis config.
# export SWARM_REDIS_URL="rediss://..."
EOF
  fi
}

mkdir -p "$BIN_DIR"
mkdir -p "$INSTALL_DIR"
ensure_env_file

echo "🔨 Building swarm-tui..."
cd "$REPO_ROOT/tui"
cargo build --release

install -m 0755 "$REPO_ROOT/tui/target/release/swarm-tui" "$BIN_DIR/swarm-tui"
install -m 0755 "$REPO_ROOT/setup-worktrees.sh" "$INSTALL_DIR/setup-worktrees.sh"
install -m 0755 "$REPO_ROOT/launch-swarm.sh" "$INSTALL_DIR/launch-swarm.sh"
rm -rf "$INSTALL_DIR/prompts"
cp -R "$REPO_ROOT/prompts" "$INSTALL_DIR/prompts"

# Remember source repo location for `swarm update`
echo "$REPO_ROOT" >"$SWARM_HOME/src_root"

cat >"$BIN_DIR/swarm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

SWARM_HOME="${SWARM_HOME:-$HOME/.swarm}"
BIN_DIR="$SWARM_HOME/bin"
INSTALL_DIR="$SWARM_HOME/share"
ENV_FILE="$SWARM_HOME/env"
PROJECT_ROOT="${SWARM_PROJECT_ROOT:-$PWD}"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

command_name="${1:-tui}"
case "$command_name" in
  help|--help|-h)
    echo "Usage: swarm [command] [options]"
    echo ""
    echo "Commands:"
    echo "  tui            Launch the interactive TUI (default)"
    echo "  run <task>     Launch the TUI with a task prompt"
    echo "  shell          Launch the shell-based swarm runner"
    echo "  setup          Set up Git worktrees for the current project"
    echo "  update, -u     Pull latest source and re-install"
    echo "  help, --help   Show this help message"
    echo ""
    echo "Examples:"
    echo "  swarm                              # start the TUI"
    echo "  swarm run \"Build a todo app\"       # start with a task"
    echo "  swarm setup                        # create worktrees"
    echo "  swarm setup --redis-url \"rediss://...\"  # setup with Redis URL"
    echo "  swarm update                       # self-update"
    exit 0
    ;;
  update|-u)
    shift || true
    SRC_ROOT_FILE="$SWARM_HOME/src_root"
    if [ -f "$SRC_ROOT_FILE" ]; then
      SRC_ROOT="$(cat "$SRC_ROOT_FILE")"
    else
      SRC_ROOT=""
    fi
    if [ -z "$SRC_ROOT" ] || [ ! -d "$SRC_ROOT/.git" ]; then
      echo "❌ Cannot find swarm source repo." >&2
      echo "   Re-run install-swarm.sh from the source checkout first." >&2
      exit 1
    fi
    echo "📥 Pulling latest changes in $SRC_ROOT..."
    git -C "$SRC_ROOT" pull --ff-only
    echo "⚙️  Re-installing swarm..."
    exec bash "$SRC_ROOT/install-swarm.sh"
    ;;
  tui)
    shift || true
    export SWARM_PROJECT_ROOT="$PROJECT_ROOT"
    export SWARM_INSTALL_HOME="$INSTALL_DIR"
    exec "$BIN_DIR/swarm-tui" "$@"
    ;;
  run)
    shift || true
    export SWARM_PROJECT_ROOT="$PROJECT_ROOT"
    export SWARM_INSTALL_HOME="$INSTALL_DIR"
    exec "$BIN_DIR/swarm-tui" "$@"
    ;;
  shell)
    shift || true
    export SWARM_PROJECT_ROOT="$PROJECT_ROOT"
    export SWARM_INSTALL_HOME="$INSTALL_DIR"
    exec "$INSTALL_DIR/launch-swarm.sh" "$@"
    ;;
  setup)
    shift || true
    export SWARM_PROJECT_ROOT="$PROJECT_ROOT"
    exec "$INSTALL_DIR/setup-worktrees.sh" "$@"
    ;;
  *)
    export SWARM_PROJECT_ROOT="$PROJECT_ROOT"
    export SWARM_INSTALL_HOME="$INSTALL_DIR"
    exec "$BIN_DIR/swarm-tui" "$command_name" "$@"
    ;;
esac
EOF

cp "$BIN_DIR/swarm" "$BIN_DIR/swarm-task"
chmod +x "$BIN_DIR/swarm" "$BIN_DIR/swarm-task"

ensure_path_entry "$HOME/.bashrc"
ensure_path_entry "$HOME/.zshrc"

echo "✅ Installed:"
echo "   $BIN_DIR/swarm"
echo "   $BIN_DIR/swarm-tui"
echo "   $BIN_DIR/swarm-task"
echo "   $INSTALL_DIR"
echo "   $ENV_FILE"
echo ""
echo "Added ~/.swarm/bin and ~/.swarm/env loading to ~/.bashrc and ~/.zshrc if needed."
echo "This installer cannot change your current parent shell automatically."
echo "Open a new shell, or run one of:"
echo 'export PATH="$HOME/.swarm/bin:$PATH"'
echo 'source ~/.bashrc'
echo ""
echo "Examples:"
echo '  cd /path/to/any/git/project && swarm setup'
echo '  cd /path/to/any/git/project && swarm setup --redis-url "rediss://..."'
echo '  cd /path/to/any/git/project && swarm'
echo '  cd /path/to/any/git/project && swarm run "Update the docs and setup scripts"'
echo '  cd /path/to/any/git/project && swarm shell'
echo '  swarm update          # or: swarm -u'