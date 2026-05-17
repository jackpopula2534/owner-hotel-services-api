#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# regenerate-tenant-scoped-models.sh
#
# Re-derive src/common/tenant/tenant-scoped-models.ts from prisma/schema.prisma.
#
# Run this AFTER any schema change that adds, removes, or renames a model.
# CI also runs the script and fails if the generated file is out of sync.
#
# Usage:
#   bash scripts/regenerate-tenant-scoped-models.sh
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

OUTPUT="src/common/tenant/tenant-scoped-models.ts"
SCHEMA="prisma/schema.prisma"

if [[ ! -f "$SCHEMA" ]]; then
  echo "❌ $SCHEMA not found" >&2
  exit 1
fi

# ── Classify every model into one of three buckets ─────────────────────────
#   1. tenant-scoped (has `tenantId` or `tenant_id` field) → auto-inject target
#   2. platform-global (no tenant scoping, lives at the SaaS-owner level)
#   3. nested (no tenant scoping, but reached via a tenant-scoped parent FK)
#
# Buckets (2) and (3) both go into PLATFORM_AND_NESTED_MODELS — the extension
# treats them identically (skip auto-injection).
# ───────────────────────────────────────────────────────────────────────────

python3 - <<'PY'
import re

with open('prisma/schema.prisma') as f:
    content = f.read()

models = re.findall(r'^model\s+(\w+)\s*\{(.*?)^\}', content, re.MULTILINE | re.DOTALL)

scoped = {}
exempt = []

for name, body in models:
    if re.search(r'^\s*tenantId\s+\w', body, re.MULTILINE):
        scoped[name] = 'tenantId'
    elif re.search(r'^\s*tenant_id\s+\w', body, re.MULTILINE):
        scoped[name] = 'tenant_id'
    else:
        exempt.append(name)

lines = [
    "/**",
    " * AUTO-GENERATED — DO NOT EDIT BY HAND.",
    " *",
    " * Map: Prisma schema model name → name of the tenant scoping column.",
    " *",
    " * The keys here are the EXACT model names from prisma/schema.prisma",
    " * (PascalCase for new models, snake_case for legacy billing tables).",
    " * The Prisma extension callback receives this same form in its `model` arg.",
    " *",
    " * Two scoping column names exist in this schema:",
    " *   • `tenantId`  — camelCase (most newer models)",
    " *   • `tenant_id` — snake_case (legacy billing/subscription tables)",
    " *",
    " * To regenerate after schema changes:",
    " *   bash scripts/regenerate-tenant-scoped-models.sh",
    " */",
    "",
    "export type TenantScopeField = 'tenantId' | 'tenant_id';",
    "",
    "export const TENANT_SCOPED_MODELS: Readonly<Record<string, TenantScopeField>> = Object.freeze({",
]
for k, v in sorted(scoped.items()):
    lines.append(f"  {k}: '{v}',")
lines.append("});")
lines.append("")
lines.append("/**")
lines.append(" * Models intentionally exempt from auto-scoping:")
lines.append(" *   • Platform-admin tables (plans, features, tenants, etc.)")
lines.append(" *   • Nested rows that derive scope via parent FK")
lines.append(" * The extension simply skips any model not present in TENANT_SCOPED_MODELS.")
lines.append(" */")
lines.append("export const PLATFORM_AND_NESTED_MODELS: ReadonlySet<string> = new Set([")
for m in sorted(exempt):
    lines.append(f"  '{m}',")
lines.append("]);")
lines.append("")

with open('src/common/tenant/tenant-scoped-models.ts','w') as f:
    f.write('\n'.join(lines))

print(f"Wrote {len(scoped)} scoped + {len(exempt)} exempt = {len(scoped)+len(exempt)} total models")
PY

echo "✅ Regenerated $OUTPUT"
echo ""
echo "Verify with: git diff $OUTPUT"
