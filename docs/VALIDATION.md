# Validation record

Validated locally on 2026-10-06 using Node v24.19.0, after installing the final lockfile. Nothing was published or deployed.

| Check                              | Exact result                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lockfile installation              | `npm ci --ignore-scripts --no-audit --no-fund`: PASS; 432 packages installed                                                                              |
| Formatting                         | `npm run format:check`: PASS                                                                                                                              |
| Lint                               | `npm run lint`: PASS; **0 errors, 0 warnings**; warnings fail CI                                                                                          |
| TypeScript                         | `npm run typecheck`: PASS, including scripts/test configuration                                                                                           |
| Automated tests                    | `npm test`: **349 passed, 0 failed, 0 skipped; 16/16 suites passed**                                                                                      |
| Original deterministic tests       | Original **104/104**, 12 suites, retained and passing                                                                                                     |
| Added authorization/security tests | **245/245**: 237 executable PostgreSQL policy/migration/provisioning checks and 8 server-scope/credential/entry-point tests                               |
| Migration replay                   | `npm run validate:migrations`: **28 migrations, 64 public tables, 0 unsafe catch-all policies, 0 unprotected tables: PASS**                               |
| Production build                   | `SUPABASE_SERVICE_ROLE_KEY=sb_secret_synthetic_build_canary npm run build`: PASS; browser and Nitro server outputs                                        |
| Credential/database/UUID scan      | No embedded credential, production backend identifier or non-synthetic UUID candidates found                                                              |
| Platform-reference scan            | No removed platform identifiers found                                                                                                                     |
| Employer/customer/brand-data scan  | No confidential employer/customer brand candidates found; public-company examples retained                                                                |
| Browser-output scan                | 101 public text assets checked; no server-secret canary, service-key environment variable or privileged async-hooks module leaked                         |
| GitHub Actions workflow            | Lockfile install, formatting, lint, migrations, all tests, source scan, TypeScript, canary production build and browser-output scan configured on Node 24 |
| Hosted Actions run                 | **Not run**; no repository was published. Its configured commands passed locally                                                                          |

## Database evidence

The final schema has 64 public application tables: 37 user-owned, 2 shared reference, 16 system/service-only and 9 audit/log. All have enabled/forced RLS. The separate private installation-owner registry is database-operator-only.

All migrations execute unmodified in a local PostgreSQL runtime through PGlite, with a minimal Auth table/role and JWT-subject contract. Tests use actual SQL SELECT/INSERT/UPDATE/DELETE under anonymous, authenticated and service roles. Tests cover all table boundaries, owner-positive business CRUD, second-account denial, a rollback-only foreign-owner injection, ownership/attribution forgery, protected writes, one-time provisioning, startup denial and repeatable synthetic seeding. They are not regex substitutes for RLS execution.

Before explicit provisioning, the migration seeds are inaccessible and service writes to private data are rejected. After provisioning, all 62 private `user_id` columns are NOT NULL, constrained to the sole owner and immutable. Owner verification is also required before any privileged server function/adapter work. Workspace membership/editor/viewer cases are not claimed because collaboration is not implemented; this uses the explicitly permitted secure single-user alternative.

See the [complete matrix and provisioning instructions](DATABASE_AUTHORIZATION.md), [architecture](ARCHITECTURE.md) and [security](../SECURITY.md).

## Scan interpretation

The source scan reviews 304 source/config/documentation files, including the environment template, database config/migrations/seeds, auth/service clients, provider adapters and CLI harnesses. It excludes dependencies, Git history and generated build output; the latter receives an additional browser asset check. The ZIP is separately inspected to exclude private environment files, dependencies, build output and Git history.

The only source UUID literals are existing synthetic all-zero/sentinel IDs. Migration filename UUID suffixes identify migration files, not users or projects. Tests generate synthetic user IDs at runtime and use example.invalid addresses. The environment template/backend configuration use placeholders. Public provider API URLs, public-company universe examples and synthetic numerical fixtures remain intentional. No production export, customer records or private pricing grids were included in the reviewed source.

The scanner's credential token boundaries were corrected after reviewing false positives from dependency CSS `mask-*` names in browser output; no file exclusion or broad secret allowlist was added. Only exact, named synthetic key fixtures are permitted. Scans are heuristic candidate detection and source review, not proof against every form of secret or confidential data.

## Remaining limitations

- Single-owner installation only; no collaboration, workspace roles or multi-tenant SaaS. Use separate installations/databases for separate owners.
- Fresh migration deployment is required. Existing shared databases are deliberately rejected; an ownership-preserving export/import requires separate operator review.
- Service credentials and database operators remain trusted and privileged. Audit data is protected from direct browser writes, not an append-only/tamper-proof compliance archive; trusted maintenance and relational cascades remain possible.
- Hosted Supabase Auth/PostgREST, browser end-to-end workflows, live migration deployment, provider integrations, paid acceptance scripts, penetration testing and deployment hardening were not run. Session revocation/expiry and rate limits need hosting validation.
- Hosted GitHub Actions has not run. Local equivalent commands passed; this is not a claim of a green hosted run.
- Build warnings remain for deprecated `inputValidator` and dependency module directives. Install reports unmaintained tsconfck, inactive Recharts 2.x and an unsupported resolved ESLint version. Those support-status warnings deserve dependency modernization review; the production audit now reports zero known advisories, with individual support warnings documented in [release review](RELEASE_REVIEW.md). No development-dependency security clearance is claimed.
- No overall production readiness, Python application, financial performance, production usage, scale or business-impact claims are made.
