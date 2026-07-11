# Lecture LiveOps

Privacy-first live operations workspace for lectures, workshops, and training sessions.

Lecture LiveOps helps facilitators capture questions, practice blockers, room signals, observations, materials, and follow-up actions while a session is running. It ships with synthetic fixture data, so the complete interface can be evaluated without connecting a production database or importing real participant information.

## What it includes

- Session dashboard with live situation summaries
- Q&A intake, prioritization, answers, and visibility controls
- Practice support tickets and facilitator signals
- Seat and team status board
- Structured observations and chronological timelines
- Material version tracking
- HTML, Markdown, PDF, and spreadsheet export flows
- Optional OpenAI-compatible assistant integration
- Optional Neon PostgreSQL persistence and NextAuth authentication
- Optional email and SMS notification adapters
- MCP server for tool-based automation
- Fixture-first local mode for evaluation and development

## Privacy model

This public repository contains only source code and synthetic sample data.

It intentionally excludes:

- Real participant rosters or contact details
- Archived production sessions
- Recordings and transcripts
- Runtime logs and local state
- Deployment credentials and database URLs
- Personal note-vault paths
- Vendor account configuration
- Historical commits from the original private operations instance

Do not commit production exports, recordings, transcripts, rosters, `.env` files, or `_workspace` data. Repository gates fail closed when common private-data patterns are detected.

## Quick start

### Requirements

- Node.js 20 or later
- npm 10 or later

```bash
git clone https://github.com/VoidLight00/lecture-liveops.git
cd lecture-liveops
npm ci
npm run dev
```

Open <http://localhost:3010>. Without a database URL, the application runs in fixture mode with synthetic organizations, courses, sessions, questions, and observations.

## Configuration

Copy the environment template when enabling optional integrations:

```bash
cp .env.example .env.local
```

Core variables:

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | No | Enables Neon/PostgreSQL persistence instead of fixture mode |
| `AUTH_SECRET` | For auth | Session signing secret |
| `AUTH_TRUST_HOST` | No | Trust reverse-proxy host headers when deploying |
| `LIVEOPS_LLM_BASE_URL` | No | OpenAI-compatible chat-completions endpoint |
| `LIVEOPS_LLM_MODEL` | No | Model identifier exposed by that endpoint |
| `LIVEOPS_LLM_API_KEY` | No | API key for the assistant endpoint |
| `RESEND_API_KEY` | No | Enables email notifications |
| `TWILIO_ACCOUNT_SID` | No | Enables SMS notifications with the remaining Twilio variables |
| `SENTRY_DSN` | No | Enables error monitoring |

All external services are optional. Fixture mode and the core test suite do not make network calls.

## Database and authentication

SQL migrations live in [`db/migrations`](db/migrations). Apply them to an isolated database before setting `DATABASE_URL` in a deployed environment.

Authentication uses NextAuth. Configure `AUTH_SECRET` and the desired provider or adapter settings for your deployment. The fixture experience remains available without production authentication configuration.

## Assistant integration

The assistant client uses an OpenAI-compatible `/chat/completions` API. Configure the endpoint and model through `LIVEOPS_LLM_*` variables. No provider-specific proxy or model is required.

If the variables are absent, assistant-dependent features return a controlled unavailable state rather than sending data externally.

## Notifications

Email and SMS adapters are optional and environment-driven. In local fixture mode, missing credentials produce development-safe fallback results. Review recipient selection, consent, retention, and regional messaging regulations before enabling notifications.

## MCP server

Start the MCP server with:

```bash
npm run mcp
```

A client configuration can invoke the repository-relative server entry point:

```json
{
  "mcpServers": {
    "lecture-liveops": {
      "command": "node",
      "args": ["/absolute/path/to/lecture-liveops/mcp/server.mjs"]
    }
  }
}
```

Run the MCP smoke test with `npm run mcp:smoke`.

## Architecture

```text
Next.js app and API routes
        │
        ├── LiveOps domain services
        ├── fixture repository ── synthetic local data
        ├── Neon repository ───── optional PostgreSQL persistence
        ├── assistant adapter ─── optional OpenAI-compatible endpoint
        ├── notification adapters ─ optional email/SMS
        └── export and MCP interfaces
```

The repository layer supports fixture and Neon modes. Domain actions enforce role permissions, input validation, CSRF protection, rate limits, and visibility rules before data reaches storage or external adapters.

## Quality gates

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run qa
bash gates/verify_lecture_liveops.sh .
```

The master gate discovers all `gates/*_gate.sh` checks and fails if any sub-gate fails. Public-release checks cover secrets, personal identifiers, absolute paths, runtime data, generic fixtures, tracked-file policy, and the prohibited vertical accent-stripe pattern.

## Deployment

The application can run on any Node-compatible platform. For Vercel:

1. Import the repository.
2. Add only the optional environment variables you need.
3. Apply database migrations before enabling `DATABASE_URL`.
4. Verify authentication origins and notification recipients.
5. Run the full gate suite before production promotion.

No production deployment is included in this repository.

## Limitations

- Real-time synchronization depends on the chosen database and deployment topology.
- External Neon integration tests require an isolated test database.
- Email, SMS, assistant, and monitoring integrations require separate vendor accounts.
- Recording and transcript ingestion are deliberately not bundled with the public core.
- Operators remain responsible for consent, retention, access-control, and deletion policies.

## Contributing and security

- [Contributing guide](CONTRIBUTING.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE) © Lecture LiveOps contributors.
