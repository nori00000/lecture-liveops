# Contributing

Thank you for improving Lecture LiveOps.

## Development

```bash
npm ci
npm run dev
```

Use fixture mode and synthetic data for development. Do not add real organizations, participants, recordings, transcripts, contact details, credentials, or absolute local paths.

## Before submitting

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run qa
bash gates/verify_lecture_liveops.sh .
```

Follow Conventional Commits, keep functions and files focused, validate untrusted input, and add tests for behavior changes. UI contributions must not use colored vertical accent stripes.

Pull requests should explain the user problem, implementation, test evidence, privacy impact, and migration requirements.
