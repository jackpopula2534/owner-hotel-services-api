#!/usr/bin/env bash
#
# Supplier-portal magic-link smoke test.
#
# Walks the single-use token lifecycle end-to-end against a running dev instance:
#   1. GET  /supplier-portal/session?token=<TOKEN>        → 200 + session payload
#   2. POST /supplier-portal/submit                       → 200 + { quoteId }
#   3. GET  /supplier-portal/session?token=<TOKEN>        → 403 (token burned)
#   4. POST /supplier-portal/submit  (second time)        → 403 (token burned)
#
# Usage:
#   API_BASE=http://localhost:3000 TOKEN=<raw-token-from-email> \
#     scripts/supplier-portal-smoke.sh
#
# Optional:
#   ITEM_ID=<uuid-of-item-in-the-rfq>   (defaults to the first item returned in step 1)
#   QTY=10                              (defaults to 1)
#   UNIT_PRICE=100                      (defaults to 100)
#
# Exits 0 on full happy-path, non-zero if any assertion fails.

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
API_PREFIX="${API_PREFIX:-/api/v1}"

if [[ -z "${TOKEN:-}" ]]; then
  echo "❌ TOKEN env var is required (raw magic-link token)" >&2
  exit 2
fi

BASE_URL="${API_BASE}${API_PREFIX}/supplier-portal"

echo "▶ 1/4  GET session (fresh token)"
SESSION_RES=$(curl -sS -w "\n%{http_code}" "${BASE_URL}/session?token=${TOKEN}")
SESSION_BODY=$(echo "$SESSION_RES" | sed '$d')
SESSION_CODE=$(echo "$SESSION_RES" | tail -1)
if [[ "$SESSION_CODE" != "200" ]]; then
  echo "   ❌ expected 200, got $SESSION_CODE"
  echo "   body: $SESSION_BODY"
  exit 1
fi
echo "   ✅ 200 — session payload received"

# Pick first PR item if caller didn't set ITEM_ID.
if [[ -z "${ITEM_ID:-}" ]]; then
  ITEM_ID=$(echo "$SESSION_BODY" | python3 -c "
import sys, json
payload = json.load(sys.stdin)
items = payload['data']['purchaseRequisition']['items']
print(items[0]['itemId'])
")
  echo "   → auto-picked first item: $ITEM_ID"
fi
QTY="${QTY:-1}"
UNIT_PRICE="${UNIT_PRICE:-100}"

echo "▶ 2/4  POST submit (first time — should succeed)"
SUBMIT_PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
  'items': [{
    'itemId': sys.argv[1],
    'quantity': float(sys.argv[2]),
    'unitPrice': float(sys.argv[3]),
  }],
  'currency': 'THB',
}))
" "$ITEM_ID" "$QTY" "$UNIT_PRICE")

SUBMIT_RES=$(curl -sS -w "\n%{http_code}" \
  -X POST "${BASE_URL}/submit?token=${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$SUBMIT_PAYLOAD")
SUBMIT_CODE=$(echo "$SUBMIT_RES" | tail -1)
SUBMIT_BODY=$(echo "$SUBMIT_RES" | sed '$d')
if [[ "$SUBMIT_CODE" != "200" && "$SUBMIT_CODE" != "201" ]]; then
  echo "   ❌ expected 200/201, got $SUBMIT_CODE"
  echo "   body: $SUBMIT_BODY"
  exit 1
fi
echo "   ✅ $SUBMIT_CODE — quote submitted"

echo "▶ 3/4  GET session (should now be 403 — token burned)"
SESSION2_CODE=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE_URL}/session?token=${TOKEN}")
if [[ "$SESSION2_CODE" != "403" ]]; then
  echo "   ❌ expected 403, got $SESSION2_CODE — single-use violation!"
  exit 1
fi
echo "   ✅ 403 — token correctly rejected after use"

echo "▶ 4/4  POST submit (should also be 403)"
SUBMIT2_CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "${BASE_URL}/submit?token=${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "$SUBMIT_PAYLOAD")
if [[ "$SUBMIT2_CODE" != "403" ]]; then
  echo "   ❌ expected 403, got $SUBMIT2_CODE — replay protection broken!"
  exit 1
fi
echo "   ✅ 403 — replay blocked"

echo ""
echo "✅ Supplier-portal smoke test passed: generate → verify → submit → burn confirmed."
