# Lecture LiveOps

Lecture LiveOps is an operator console for live lectures and deliberative workshops.

The current product focus is the deliberation workflow: participants enter by access key, submit statements, vote agree/disagree/pass, and facilitators publish traceable reports with consensus, divisive points, minority views, moderation logs, evidence-type distribution, and quality-gate metrics.

## Current Status

- Deliberation MVP stages 0-4 are implemented.
- Post-MVP opinion landscape statistics are implemented behind statistical gates.
- Transcript consent and schema groundwork are implemented; transcript ingest is intentionally not implemented yet.
- Deliberation quality support Q1-Q4 is implemented.
- Q5 common-ground natural-language summaries are gated until pilot measurements show the prerequisite quality thresholds.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

The default development path works in fixture mode without a database.

Production mode is fail-closed: `DATABASE_URL` must point to Neon/Postgres, and `AUTH_SECRET` must be set. A production build can be checked locally with environment variables present:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/liveops AUTH_SECRET=local-build-secret npm run build
```

## Scripts

```bash
npm run dev           # Next.js dev server on port 3010
npm run lint          # ESLint
npm run typecheck     # TypeScript
npm test              # Vitest
npm run build         # Production build, requires production env vars
npm run seed:demo     # Deterministic deliberation demo seed
```

## Key Docs

- `docs/PRODUCT-PLAN-v2.md` — product plan and current roadmap
- `docs/DELIBERATION-QUALITY-PLAN.md` — Q1-Q6 deliberation quality plan
- `docs/facilitator-runbook.md` — field runbook
- `docs/privacy-template.md` — privacy notice template
- `docs/transcript-architecture.md` — transcript consent and future ingest architecture

## Verification Snapshot

Latest local verification:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `DATABASE_URL=postgres://user:pass@localhost:5432/liveops AUTH_SECRET=build-secret-for-local-check npm run build`

## License

MIT
