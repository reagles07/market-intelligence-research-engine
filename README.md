# Market Intelligence Research Engine

A sanitized full-stack portfolio/reference financial intelligence workspace for US and Indian equities that turns market data and source filings into evidence-linked research packets, deterministic quality checks, and human-reviewed AI-assisted content.

## Engineering highlights

- SEC EDGAR submissions and XBRL normalization, including fiscal-period and comparative-window handling.
- Indian equity market-data adapters with server-side credentials.
- Discovery scoring and candidate clustering, separate from investment recommendations.
- Source, claim, financial metric, and research-packet lineage.
- Database-bounded AI context and structured Responses API output schemas.
- Deterministic numeric, temporal, evidence, and long-form readiness checks.
- Multi-company content composition with company-specific evidence boundaries.
- Repair workflows, human review, scheduling, and provider-usage tracking.

The model is not the source of truth. Evidence status, numerical binding, and readiness rules constrain the context supplied to generation and the checks applied to its output.

## Stack

TypeScript, React 19, TanStack Start/Router/Query, Vite, Nitro, Tailwind CSS, PostgreSQL, Supabase authentication/data access, Zod, OpenAI Responses API, and Vitest. No Python implementation is claimed.

## Run locally

Use Node.js 24. Copy `.env.example` to `.env` and replace its placeholders with development credentials. Follow [fresh database and owner provisioning](docs/DATABASE_AUTHORIZATION.md#migration-and-safe-provisioning) before signing in. Apply all 28 migrations before creating the owner Auth account; the migration refuses an existing shared deployment. Never use production credentials for portfolio testing.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
npm run validate:migrations
npm test
npm run typecheck
npm run build
npm run lint
npm run format:check
npm run scan:publication
```

The test suite includes the original deterministic research tests plus executable PostgreSQL migration/RLS and server authorization tests. Live acceptance scripts require configured development services and a verified owner token, may write records and incur provider charges, and are excluded from CI. See [validation](docs/VALIDATION.md) for exact results.

## Security and scope

**This is a sanitized portfolio/reference application with enforced single-user ownership.** Each installation has one explicitly provisioned owner. Other authenticated accounts cannot read or mutate application records or invoke privileged jobs. Business rows require `user_id = auth.uid()` plus the installation-owner check; system/audit/reference records are read-only from the browser. Signup cannot confer ownership. The service client is confined to verified owner requests in trusted server code.

This supports a personal research installation, not collaborative workspaces or multi-tenant SaaS. Provisioning is fail-closed; a fresh database is required, and the old shared authorization model is not retained. See the [64-table authorization matrix and provisioning steps](docs/DATABASE_AUTHORIZATION.md).

The package demonstrates implemented research/AI components: provider adapters, authenticated functions, evidence lineage, schema-backed queries, deterministic quality gates, and unit-tested research rules. It does not establish end-to-end production readiness. See [database authorization](docs/DATABASE_AUTHORIZATION.md) and [security](SECURITY.md).

No live backend, deployment, provider integration success, financial performance, production usage, or business impact is asserted. Public-company universe seeds and company-name fixtures are illustrative reference/test data, not customer records or a production export. Runtime market data is fetched separately. Provider access may require separate licensing.

## Code guide

See [architecture and implementation map](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md), and [validation](docs/VALIDATION.md).

## Rights

All Rights Reserved. See `NOTICE`. Third-party dependencies retain their own licenses.
