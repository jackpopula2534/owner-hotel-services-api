#!/bin/bash
# One-off: reset test user passwords to `password123`.
# Safe to delete after running.
cd "$(dirname "$0")"
echo "🔑 Resetting test user passwords..."
node reset-test-password.js
EXIT=$?
echo ""
if [ $EXIT -eq 0 ]; then
  echo "✅ Done. You can close this window."
else
  echo "❌ Script failed (exit $EXIT). Check error above."
fi
echo "Press Return to close..."
read
