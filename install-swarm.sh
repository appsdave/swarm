#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${HOME}/.local/bin"

mkdir -p "$BIN_DIR"

echo "🔨 Building swarm-tui..."
cd "$REPO_ROOT/tui"
cargo build --release

install -m 0755 "$REPO_ROOT/tui/target/release/swarm-tui" "$BIN_DIR/swarm-tui"

cat >"$BIN_DIR/swarm-task" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

BIN_DIR="$HOME/.local/bin"
REPO_ROOT="__REPO_ROOT__"

command_name="${1:-run}"
case "$command_name" in
  run)
    shift || true
    exec "$BIN_DIR/swarm-tui" "$@"
    ;;
  shell)
    shift || true
    cd "$REPO_ROOT"
    exec ./launch-swarm.sh "$@"
    ;;
  *)
    exec "$BIN_DIR/swarm-tui" "$command_name" "$@"
    ;;
esac
EOF

python3 - "$BIN_DIR/swarm-task" "$REPO_ROOT" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
repo_root = sys.argv[2]
path.write_text(path.read_text().replace("__REPO_ROOT__", repo_root))
PY

chmod +x "$BIN_DIR/swarm-task"

echo "✅ Installed:"
echo "   $BIN_DIR/swarm-tui"
echo "   $BIN_DIR/swarm-task"
echo ""
echo "If ~/.local/bin is not on PATH, add this to your shell profile:"
echo 'export PATH="$HOME/.local/bin:$PATH"'
echo ""
echo "Examples:"
echo '  swarm-task run "Update the docs and setup scripts"'
echo '  swarm-task shell'