#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# rotate-leaked-secrets-from-history.sh
#
# Remove the JWT_SECRET and Firebase private key that leaked through
# .env.example (rotated 2026-05-17) from this repository's full git history.
#
# ⚠️  DESTRUCTIVE — REWRITES HISTORY ⚠️
#  • Every commit SHA after the first leak point changes
#  • Forces `git push --force` on main + dev
#  • Collaborators must DELETE their local clone and re-clone
#  • Open PRs targeting old SHAs will need to be rebased
#
# Preflight (run BEFORE this script):
#  1. Confirm no production deploys are pinned to a SHA you can't move
#  2. Notify collaborators (Teamdev <teamdev@organicscosme.com>)
#  3. Ensure all in-flight work is pushed to the remote
#
# Usage:
#   cd /path/to/owner-hotel-services-api
#   bash scripts/rotate-leaked-secrets-from-history.sh
#
# Method:
#   • Prefers git-filter-repo (faster, safer). Install: brew install git-filter-repo
#   • Falls back to git filter-branch (built-in but ~10x slower)
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Sanity ──────────────────────────────────────────────────────────────────
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "❌ Not inside a git repository." >&2
  exit 1
fi
cd "$REPO_ROOT"

if [[ ! -f .gitleaks.toml ]]; then
  echo "❌ .gitleaks.toml not found. Are you in the right repo?" >&2
  exit 1
fi

# ── Confirm ────────────────────────────────────────────────────────────────
echo "┌──────────────────────────────────────────────────────────────────┐"
echo "│  About to REWRITE GIT HISTORY for $(basename "$REPO_ROOT")"
echo "│                                                                  │"
echo "│  • Removes the leaked JWT_SECRET (rotated 2026-05-17)           │"
echo "│  • Removes Firebase PEM key bodies from .env.example history    │"
echo "│  • Every commit after the first leak point gets a NEW SHA       │"
echo "│  • You will need to: git push --force origin main dev           │"
echo "│  • Collaborators must re-clone — old clones become incompatible │"
echo "└──────────────────────────────────────────────────────────────────┘"
echo ""
read -rp "Type the repo name to confirm ($(basename "$REPO_ROOT")): " CONFIRM
if [[ "$CONFIRM" != "$(basename "$REPO_ROOT")" ]]; then
  echo "Aborted." >&2
  exit 1
fi

# ── Backup ──────────────────────────────────────────────────────────────────
BACKUP_BUNDLE="../$(basename "$REPO_ROOT").pre-rotation-$(date +%Y%m%d-%H%M%S).bundle"
echo ""
echo "📦 Creating safety bundle: $BACKUP_BUNDLE"
git bundle create "$BACKUP_BUNDLE" --all
echo "   To restore: git clone $BACKUP_BUNDLE recovered-repo"

# ── Replacements file ──────────────────────────────────────────────────────
# Each line is OLD==>NEW. We replace the leaked secrets with sentinel strings
# so any future scan can find the rotation marker (instead of the secret).
REPLACEMENTS=$(mktemp)
cat > "$REPLACEMENTS" <<'EOF'
952b9e6b192d670b3ca46913f6bd825a614dcf5a5f1ccb1b40215359f726d250b2e92d5602086296b3e11d4d08274dcb12978379c9b3c7e8ecc196cf43f82448==>__ROTATED_2026_05_17_SEE_GO_LIVE_PLAN_W1__
regex:MII[A-Za-z0-9+/=\\n]{200,}==>__FIREBASE_PEM_REDACTED_ROTATED_2026_05_17__
EOF

# ── Choose method ──────────────────────────────────────────────────────────
if command -v git-filter-repo >/dev/null 2>&1; then
  echo ""
  echo "🚀 Using git-filter-repo (fast path)"

  # filter-repo refuses to operate on a non-fresh clone by default; --force
  # opts in. We already took a bundle backup above.
  git filter-repo --force --replace-text "$REPLACEMENTS"

  # filter-repo strips the remote by design. Re-add it.
  if ! git remote get-url origin >/dev/null 2>&1; then
    echo ""
    echo "🔗 filter-repo removed the remote (this is expected). Re-adding origin..."
    git remote add origin git@github.com:jackpopula2534/owner-hotel-services-api.git
  fi

else
  echo ""
  echo "⚠️  git-filter-repo not installed — falling back to git filter-branch (slow)."
  echo "   Recommend: brew install git-filter-repo  (then re-run)"
  read -rp "Continue with filter-branch? [y/N]: " GO
  [[ "$GO" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

  # filter-branch needs a different format — feed it a sed expression
  FILTER_CMD='
    sed -e "s|952b9e6b192d670b3ca46913f6bd825a614dcf5a5f1ccb1b40215359f726d250b2e92d5602086296b3e11d4d08274dcb12978379c9b3c7e8ecc196cf43f82448|__ROTATED_2026_05_17_SEE_GO_LIVE_PLAN_W1__|g"
  '

  FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force \
    --tree-filter "find . -type f \( -name '*.env*' -o -name '*.md' -o -name '*.yml' -o -name '*.yaml' -o -name '*.json' -o -name '*.ts' -o -name '*.js' \) -exec sh -c '$FILTER_CMD' {} \\; 2>/dev/null || true" \
    --tag-name-filter cat \
    -- --all

  # filter-branch leaves refs/original/* — clean them up
  git for-each-ref --format='delete %(refname)' refs/original | git update-ref --stdin
  git reflog expire --expire=now --all
  git gc --prune=now --aggressive
fi

# ── Verify ──────────────────────────────────────────────────────────────────
echo ""
echo "🔍 Verifying the leaked JWT no longer appears anywhere in history..."
if git log --all -p -S '952b9e6b192d670b3ca46913f6bd825a614dcf5a5f1ccb1b40215359f726d250b2e92d5602086296b3e11d4d08274dcb12978379c9b3c7e8ecc196cf43f82448' | grep -q '952b9e6b'; then
  echo "❌ The leaked JWT_SECRET is STILL in history. Investigate before pushing."
  exit 1
else
  echo "✅ Clean. Leaked JWT_SECRET is no longer in any commit."
fi

# ── Next steps ──────────────────────────────────────────────────────────────
cat <<'POST'

┌──────────────────────────────────────────────────────────────────────────┐
│  ✅ Local history rewrite complete.                                      │
│                                                                          │
│  Next — push the rewritten history (you have backup bundle if needed):  │
│                                                                          │
│    git push --force-with-lease origin main                              │
│    git push --force-with-lease origin dev                               │
│                                                                          │
│  Then tell collaborators (Teamdev) to re-clone:                          │
│                                                                          │
│    cd /path/to/old-clone                                                 │
│    cd .. && rm -rf old-clone                                             │
│    git clone git@github.com:jackpopula2534/owner-hotel-services-api.git │
│                                                                          │
│  Final hygiene: rotate any other secret that lived in the old history:  │
│    • Firebase service account → Firebase Console → Rotate key           │
│    • SMTP App Password (Gmail) → Google Account → App Passwords         │
│    • PromptPay ID → verify still the intended account                   │
└──────────────────────────────────────────────────────────────────────────┘
POST

rm -f "$REPLACEMENTS"
