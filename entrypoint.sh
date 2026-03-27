#!/bin/sh
# =============================================================================
# Production Docker entrypoint
#
# Applies pending Prisma migrations then starts the NestJS application.
#
# Strategy:
#   1. Try `prisma migrate deploy` (production-safe, runs only pending SQL files)
#   2. If migrate deploy fails (e.g. no _prisma_migrations table yet),
#      fall back to `prisma db push` which diffs schema vs DB directly
#   3. If both fail, start the app anyway — schema might already be in sync
#
# Kubernetes notes:
#   For multi-replica deployments consider running migrations in a pre-deploy
#   Job or initContainer to prevent parallel migration races.
#   For single-replica (typical hotel SaaS), this entrypoint is safe.
# =============================================================================

echo "[entrypoint] Generating Prisma client..."
npx prisma generate 2>/dev/null || true

echo "[entrypoint] Applying database migrations..."
if npx prisma migrate deploy 2>&1; then
  echo "[entrypoint] Migrations applied successfully."
else
  echo "[entrypoint] migrate deploy failed — trying db push as fallback..."
  if npx prisma db push --accept-data-loss 2>&1; then
    echo "[entrypoint] db push completed successfully."
  else
    echo "[entrypoint] WARNING: Schema sync failed. Starting app anyway..."
    echo "[entrypoint] The database schema may already be up to date."
  fi
fi

echo "[entrypoint] Starting application..."
exec node dist/main.js
