# Git Workflow — Owner Hotel Services API

## Commit Message Format

```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

## Examples

```
feat: add guest check-in notification endpoint
fix: resolve booking overlap validation in service
refactor: extract payment processing to separate service
test: add unit tests for subscription service
chore: update Prisma schema and run migration
```

## Pull Request Workflow

1. Analyze full commit history
2. Draft comprehensive PR summary
3. Include test plan
4. Run `npm run prisma:migrate` if schema changed
5. Ensure 80%+ test coverage before merge
