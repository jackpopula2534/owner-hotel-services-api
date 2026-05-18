# Incident — JWT_SECRET Leaked Through `.env.example`

**Date discovered:** 2026-05-17
**Severity:** Critical (pre-launch)
**Status:** ✅ Rotated locally, history rewrite + force-push pending operator action
**Reporter:** Production readiness audit
**Owner:** IT @ organicscosme.com

---

## What happened

The `JWT_SECRET` committed to `owner-hotel-services-api/.env.example` was a real
128-hex-char value (`952b9e6b…`) — not a placeholder. The same value also lived
in the local `.env`, meaning anyone who had read access to the repository could
forge JWTs valid against any environment that booted with that secret.

The Firebase service-account `PRIVATE_KEY` in the same file was also a full
PEM-formatted block (~1,714 chars). It may or may not be the real production
key — must be rotated regardless.

## Discovery method

`grep "^JWT_SECRET=" .env .env.example` showed identical 128-char values across
both files. `.env.example` is tracked in git (`git ls-files | grep env`), so
the value is in every clone of the repo.

## Impact assessment

| Asset | Exposure |
|-------|----------|
| Beta tenant JWTs (none yet) | N/A — no production traffic at time of discovery |
| Local dev JWTs | Invalidated by rotation; force re-login next dev boot |
| Firebase service account | Treat as compromised — rotate immediately |
| Encryption-at-rest of PDPA fields | Unaffected — `ENCRYPTION_KEY` was never set in `.env` |

No production deploy was using the leaked secret at the time of discovery
(confirmed by operator), so customer-data impact is **none**.

## Timeline (UTC+7)

| Time | Action |
|------|--------|
| 2026-05-17 13:30 | Audit identified `JWT_SECRET` match between `.env` and `.env.example` |
| 2026-05-17 14:18 | New `JWT_SECRET` + `ENCRYPTION_KEY` generated with `openssl rand` |
| 2026-05-17 14:22 | `.env.example` replaced with explicit placeholders |
| 2026-05-17 14:24 | `env.validation.ts` updated to reject the leaked value at boot |
| 2026-05-17 14:27 | Local `.env` rotated to new JWT_SECRET (`ec9545…`) |
| 2026-05-17 14:31 | gitleaks added to CI (blocking) + local hook installer + `.gitleaks.toml` |
| 2026-05-17 14:35 | Rewrite script written + validated on a sandbox clone |
| 2026-05-17 _PENDING_ | Operator runs `scripts/rotate-leaked-secrets-from-history.sh` on their workstation |
| 2026-05-17 _PENDING_ | Force-push `main` + `dev` to `origin` |
| 2026-05-17 _PENDING_ | Firebase service-account key rotated via Firebase Console |
| 2026-05-17 _PENDING_ | Teamdev notified to re-clone |

## What we changed in this incident

| Change | Location |
|--------|----------|
| Rotated `JWT_SECRET` to a fresh 128-hex value | `.env` (local) |
| Generated `ENCRYPTION_KEY` (was missing in dev) | `outputs/_secrets/new-secrets.env` (session-only — copy before session ends) |
| Replaced all secrets in `.env.example` with explicit placeholders | `.env.example` |
| Added boot-time rejection of the leaked JWT + placeholder strings | `src/config/env.validation.ts` |
| Enforced `ENCRYPTION_KEY` required in production | `src/config/env.validation.ts` |
| Added 11 unit tests for the new validation logic | `src/config/env.validation.spec.ts` |
| Added blocking `gitleaks` job to CI | `.github/workflows/ci.yml` |
| Added project-specific secret rules | `.gitleaks.toml` |
| Added local pre-commit hook installer | `scripts/install-gitleaks-hook.sh` |
| Added history-rewrite script (operator-run) | `scripts/rotate-leaked-secrets-from-history.sh` |

## How to finish this incident

The remaining steps require operator credentials (SSH key, Firebase Console
access) and are not safe to run from automation. Order matters:

### 1. Rewrite git history locally

```bash
cd ~/Documents/GitHub/owner-hotel-services-api

# Make sure your working tree is clean — uncommitted work will be lost
git status

# Pull anything new from remote so collaborators' work isn't dropped
git pull origin main
git pull origin dev

# Run the rewrite (asks for confirmation, creates a backup bundle)
bash scripts/rotate-leaked-secrets-from-history.sh

# OPTIONAL but recommended — install git-filter-repo first for fast/safe path
# brew install git-filter-repo
```

### 2. Force-push the rewritten branches

```bash
# --force-with-lease is safer than --force: it refuses to overwrite
# unexpected remote changes (e.g. someone pushed while you were working)
git push --force-with-lease origin main
git push --force-with-lease origin dev
```

### 3. Rotate Firebase service-account key

1. Open https://console.firebase.google.com/
2. Navigate to **Project Settings → Service accounts**
3. Locate the key whose `client_email` matches `FIREBASE_CLIENT_EMAIL` in your
   current `.env`
4. Click **Revoke** (or "delete service account key")
5. Generate a new private key → download the JSON
6. Update your local `.env`:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY` (escape newlines: `\n`)
7. Restart the API and verify push notifications still work end-to-end

### 4. Notify the other contributor

Send to `teamdev@organicscosme.com`:

> Hi Teamdev,
>
> Our `JWT_SECRET` was found committed to `.env.example`. I rewrote the git
> history on `main` and `dev` to remove it, and force-pushed both branches.
>
> Your existing clone is now incompatible with the remote. Please:
>
> 1. Push any in-flight work you have on a feature branch
> 2. Delete your local clone: `rm -rf owner-hotel-services-api`
> 3. Re-clone fresh: `git clone git@github.com:jackpopula2534/owner-hotel-services-api.git`
> 4. Re-create any feature branches you had
> 5. Update your local `.env` — your old JWTs no longer work
>
> If you have open PRs, please rebase them onto the new `main`/`dev` tips.

### 5. Update production environment (when prod exists)

There is no production deploy as of 2026-05-17, so this is a placeholder for
future launches. When prod comes up:

```bash
# On the production host
docker compose down api
# Update prod .env with the new JWT_SECRET and ENCRYPTION_KEY
docker compose up -d api
# Existing user JWTs are invalidated — frontend should redirect to /login
```

### 6. Install the local pre-commit hook (optional but recommended)

```bash
bash scripts/install-gitleaks-hook.sh
```

This prevents the same class of leak from happening again — the hook scans
staged changes and rejects commits that match the rules in `.gitleaks.toml`.

## Verification — confirm the leak is gone

After the force-push:

```bash
# 1. Fresh clone — proves the leak isn't in the public-facing repo
cd /tmp
git clone git@github.com:jackpopula2534/owner-hotel-services-api.git verify-clean
cd verify-clean

# 2. Search every commit on every branch
git log --all -p -S '952b9e6b192d670b3ca46913f6bd825a614dcf5a5f1ccb1b40215359f726d250b2e92d5602086296b3e11d4d08274dcb12978379c9b3c7e8ecc196cf43f82448' --oneline
# Expected output: (empty)

# 3. CI gitleaks job should also pass — check the next PR or push
```

## Lessons learned

1. **`.env.example` is shipped in the repo — treat it like source code.** Any
   value placed there is permanently public from the first commit onward.

2. **Real secrets and example secrets look identical.** Make placeholders
   *visibly* placeholder: `__GENERATE_WITH__openssl_rand_hex_64__`, not a
   plausible-looking hex string.

3. **`git rm`-ing a committed secret does not remove it.** History keeps the
   old blob. Rotation + history rewrite + force-push is the only fix.

4. **Defense in depth matters.** Even after this incident, the new env
   validator (boot-time sentinel check) + gitleaks (commit-time scan) + CI
   gitleaks (PR-time scan) are three independent guards.

5. **Add a runbook before you need it.** This document is the runbook for the
   next time something like this happens — keep it updated.

## Related

- `GO_LIVE_PLAN.md` Week 1 — security blocker work
- `INCIDENT_RESPONSE.md` — generic PDPA-breach response template
- `.gitleaks.toml` — the rules that would have caught this commit
