#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# install-gitleaks-hook.sh
#
# Sets up a local pre-commit hook that runs gitleaks against staged changes
# BEFORE the commit is created. This is the last line of defense before
# secrets reach the remote — CI catches them too, but local feedback is
# instant and prevents the rewrite-history dance.
#
# Idempotent: re-running upgrades the hook without breaking existing setup.
#
# Usage:
#   bash scripts/install-gitleaks-hook.sh
#
# Prerequisites:
#   • macOS:  brew install gitleaks
#   • Linux:  https://github.com/gitleaks/gitleaks/releases
#   • Docker: docker pull zricethezav/gitleaks:latest  (auto-detected)
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "❌ Not inside a git repository." >&2
  exit 1
fi

HOOK_PATH="$REPO_ROOT/.git/hooks/pre-commit"
CONFIG_PATH="$REPO_ROOT/.gitleaks.toml"

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "❌ Expected $CONFIG_PATH to exist. Run from a checkout that contains it." >&2
  exit 1
fi

# ── Detect gitleaks binary or fall back to docker ────────────────────────────
if command -v gitleaks >/dev/null 2>&1; then
  GITLEAKS_INVOCATION='gitleaks protect --staged --no-banner --redact --config "$REPO_ROOT/.gitleaks.toml"'
  RUNNER_DESC="native (gitleaks binary)"
elif command -v docker >/dev/null 2>&1; then
  GITLEAKS_INVOCATION='docker run --rm -v "$REPO_ROOT":/repo zricethezav/gitleaks:latest protect --staged --no-banner --redact --source=/repo --config=/repo/.gitleaks.toml'
  RUNNER_DESC="docker (zricethezav/gitleaks)"
else
  echo "❌ Neither 'gitleaks' nor 'docker' is on PATH." >&2
  echo "   Install gitleaks: https://github.com/gitleaks/gitleaks#installing" >&2
  echo "   macOS shortcut:  brew install gitleaks" >&2
  exit 1
fi

# ── Write the hook ──────────────────────────────────────────────────────────
mkdir -p "$(dirname "$HOOK_PATH")"
cat > "$HOOK_PATH" <<HOOK
#!/usr/bin/env bash
# Installed by scripts/install-gitleaks-hook.sh — DO NOT EDIT BY HAND
# Re-run the installer if you need to upgrade.
set -euo pipefail

REPO_ROOT="\$(git rev-parse --show-toplevel)"

if ! $GITLEAKS_INVOCATION ; then
  echo ""
  echo "┌─────────────────────────────────────────────────────────────────┐"
  echo "│  ❌ gitleaks blocked this commit — a secret was detected.       │"
  echo "│                                                                 │"
  echo "│  Review the finding above, remove the secret, and try again.    │"
  echo "│  If this is a false positive, add an allowlist entry in         │"
  echo "│  .gitleaks.toml and commit that change separately.              │"
  echo "│                                                                 │"
  echo "│  Bypass (emergency only):  git commit --no-verify               │"
  echo "└─────────────────────────────────────────────────────────────────┘"
  exit 1
fi
HOOK

chmod +x "$HOOK_PATH"

echo "✅ Pre-commit hook installed: $HOOK_PATH"
echo "   Runner: $RUNNER_DESC"
echo ""
echo "Test it now:"
echo "  echo 'JWT_SECRET=952b9e6b192d670b3ca46913f6bd825a614dcf5a5f1ccb1b40215359f726d250b2e92d5602086296b3e11d4d08274dcb12978379c9b3c7e8ecc196cf43f82448' > /tmp/leak.txt"
echo "  git add /tmp/leak.txt  # won't add — outside repo. Try inside repo instead."
echo ""
echo "Full repo scan (catches anything already committed):"
echo "  gitleaks detect --no-banner --redact"
