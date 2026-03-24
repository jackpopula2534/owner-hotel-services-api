# =============================================================================
# Stage 1: Builder
# Installs ALL dependencies (dev + prod), compiles TypeScript, generates Prisma
# =============================================================================
FROM node:20-slim AS builder
WORKDIR /app

# Copy manifests first — Docker cache busts here only when deps change
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npx prisma generate
RUN npm run build

# Hard fail if compiled entry point is missing — catch tsconfig bugs at build time
RUN test -f dist/main.js || \
    (echo "ERROR: dist/main.js not found. Check tsconfig.build.json rootDir and outDir." && \
     echo "Actual dist contents:" && ls -la dist/ && exit 1)

# Verify migration DataSource compiles correctly
RUN test -f dist/config/data-source.js || \
    (echo "ERROR: dist/config/data-source.js not found. Migration scripts will fail." && exit 1)


# =============================================================================
# Stage 2: Runner (production)
# Fresh production-only install — nothing from the builder's node_modules
# node:20-slim uses glibc (Debian): bcrypt downloads prebuilt binary, no build tools needed
# =============================================================================
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=9011

# Non-root user for security
RUN groupadd --system --gid 1001 nestjs && \
    useradd  --system --uid 1001 --gid nestjs nestjs

# Fresh production install — bcrypt's node-pre-gyp pulls a prebuilt .node binary
# for linux-x64-glibc automatically. No python/make/g++ required.
USER root
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Prisma: overwrite the generated client with the one built in the builder stage.
# Both stages are identical node:20-slim (Debian amd64), so the query engine binary
# is binary-compatible — no regeneration needed.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy Prisma schema (needed by @prisma/client at runtime for query engine lookup)
COPY --from=builder /app/prisma ./prisma

# Copy compiled application — dist/main.js is guaranteed to exist by the builder check
COPY --from=builder /app/dist ./dist

# Copy entrypoint script and make it executable before switching to non-root user
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Transfer ownership of the entire /app tree to the nestjs user.
# Everything above (npm ci, COPY dist, COPY .prisma) runs as root, so all
# files are root-owned by default.  Without this chown the nestjs user cannot
# read package.json, node_modules, or dist — causing EACCES at runtime.
RUN chown -R nestjs:nestjs /app

USER nestjs

EXPOSE 9011

# Docker HEALTHCHECK — uses the liveness endpoint (always fast, no DB call).
# Readiness is polled separately by the orchestrator (K8s readinessProbe).
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9011/api/v1/health || exit 1

# entrypoint.sh: runs `npm run migration:run:prod` then `exec node dist/main.js`
CMD ["./entrypoint.sh"]
