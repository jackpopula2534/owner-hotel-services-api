#!/bin/sh
# =============================================================================
# Production Docker entrypoint
#
# Runs TypeORM migrations against the compiled JS DataSource before starting
# the NestJS application.
#
# Why call the TypeORM binary directly instead of `npm run migration:run:prod`:
#   npm reads package.json on every invocation.  Even though we now chown /app
#   to the nestjs user, calling the binary directly is simpler, faster (skips
#   npm's startup overhead), and avoids any future permission edge-cases.
#
# Kubernetes notes:
#   For multi-replica deployments consider running migrations in a pre-deploy
#   Job or initContainer to prevent parallel migration races.
#   For single-replica (typical hotel SaaS), this entrypoint is safe.
# =============================================================================
set -e   # exit immediately on any error

echo "[entrypoint] Running Prisma migrations..."
npx prisma migrate deploy

echo "[entrypoint] Running TypeORM migrations..."
# Call the TypeORM CLI binary directly — no npm required
node ./node_modules/.bin/typeorm migration:run -d dist/config/data-source.js

echo "[entrypoint] Migrations complete. Starting application..."

exec node dist/main.js
