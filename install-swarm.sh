#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
SWARM_HOME="${SWARM_HOME:-${HOME}/.swarm}"
BIN_DIR="${SWARM_HOME}/bin"
INSTALL_DIR="${SWARM_HOME}/share"

ensure_path_entry() {
  local profile_file="$1"
  local export_line='export PATH="$HOME/.swarm/bin:$PATH"'

  if [ ! -f "$profile_file" ]; then
    printf '%s\n' "$export_line" >"$profile_file"
    return
  fi

  if ! grep -Fqx "$export_line" "$profile_file"; then
    printf '\n%s\n' "$export_line" >>"$profile_file"
  fi
}

mkdir -p "$BIN_DIR"
mkdir -p "$INSTALL_DIR"

echo "🔨 Building swarm-tui..."
cd "$REPO_ROOT/tui"
cargo build --release

install -m 0755 "$REPO_ROOT/tui/target/release/swarm-tui" "$BIN_DIR/swarm-tui"
install -m 0755 "$REPO_ROOT/setup-worktrees.sh" "$INSTALL_DIR/setup-worktrees.sh"
install -m 0755 "$REPO_ROOT/launch-swarm.sh" "$INSTALL_DIR/launch-swarm.sh"
rm -rf "$INSTALL_DIR/prompts"
cp -R "$REPO_ROOT/prompts" "$INSTALL_DIR/prompts"

cat >"$BIN_DIR/swarm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

SWARM_HOME="${SWARM_HOME:-$HOME/.swarm}"
BIN_DIR="$SWARM_HOME/bin"
INSTALL_DIR="$SWARM_HOME/share"
PROJECT_ROOT="${SWARM_PROJECT_ROOT:-$PWD}"

command_name="${1:-tui}"
case "$command_name" in
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
echo ""
echo "Added ~/.swarm/bin to ~/.bashrc and ~/.zshrc if needed."
echo "Open a new shell, or run:"
echo 'export PATH="$HOME/.swarm/bin:$PATH"'
echo ""
echo "Examples:"
echo '  cd /path/to/any/git/project && swarm setup'
echo '  cd /path/to/any/git/project && swarm'
echo '  cd /path/to/any/git/project && swarm run "Update the docs and setup scripts"'
echo '  cd /path/to/any/git/project && swarm shell'