# AGENTS.md

## Project Context

Lecture LiveOps is a Next.js operator console for live lectures and deliberative workshops. The current product focus is the deliberation workflow: participant access keys, statement submission, agree/disagree/pass voting, facilitator moderation, and traceable report publishing.

Work from `/Users/leesangmin/projects/lecture-liveops` on branch `delib-mvp` unless the user explicitly moves the task elsewhere.

## Coding Rules

- Keep changes aligned with the existing App Router, TypeScript, Vitest, and fixture-mode patterns.
- Preserve production fail-closed behavior: production build paths require `DATABASE_URL` and `AUTH_SECRET`.
- Prefer small, testable changes around the requested operator workflow. Do not expand transcript ingest or Q5 summary behavior unless the task explicitly asks for it.
- Keep deliberation reports traceable: consensus, divisive points, minority views, moderation logs, evidence distribution, and quality-gate metrics must remain auditable.
- Do not commit generated build artifacts, local databases, logs, or dependency directories.

## Verification

Fast gate:

```bash
npm run lint && npm run typecheck && npm test
```

Production build gate:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/liveops AUTH_SECRET=build-secret-for-local-check npm run build
```

For UI changes, also run the smallest relevant browser or smoke check from the repo scripts and record what was exercised.
