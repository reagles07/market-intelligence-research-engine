# Database authorization

## Implemented model: one owner per installation

This application now uses a **secure single-user ownership model**, the alternative permitted for this repository. It does not implement collaborative workspaces or multi-tenant SaaS. Global company uniqueness, singleton discovery/automation settings, market execution keys, provider budgets and orchestration assume one personal research installation. Adding workspace columns without partitioning these constraints and every privileged/background path would misrepresent the application's design.

Each installation has exactly one owner, explicitly provisioned by a database operator. A newly registered or authenticated account is not an application member. It cannot read or mutate another account's research, trigger privileged provider jobs, or acquire owner status. Separate users require separate application/database installations. There are no editor/viewer/member roles or workspace-sharing routes; tests for those unsupported features are not claimed.

The prior statement “Database access supports a shared trusted workspace” has been withdrawn. Unrestricted authenticated CRUD is no longer part of this package.

## Enforcement

- All 64 public application tables have RLS enabled and forced. All previous policies are replaced; historical business migrations also deny access until the final policies exist.
- 62 private business/system/audit tables carry `user_id`. SELECT requires `user_id = auth.uid()` **and** `is_installation_owner()`. User-owned INSERT/UPDATE/DELETE use the same ownership condition, including UPDATE WITH CHECK.
- A foreign key binds every private row to the singleton `private.installation_owner`. A trigger prevents missing/foreign ownership, ownership changes and forged `created_by` attribution, including service-role writes. A profile's primary key must equal its owner ID. After provisioning, all 62 ownership columns are NOT NULL.
- System and audit tables have no authenticated INSERT/UPDATE/DELETE grants or write policies. Reference tables are read-only to the approved authenticated owner; their maintenance uses trusted server code.
- Server middleware validates the bearer token with Auth, then invokes the owner-check RPC using that user's public-key client. Only an affirmative result opens an AsyncLocalStorage request scope. Every server-function factory uses this middleware. The service client refuses access outside that scope.
- Server operations use the service client within the verified owner scope because they maintain protected system/audit records. This is safe for this single-owner installation, not a reusable tenant-scoping strategy. The service role bypasses RLS; its confidentiality and trusted server code remain essential. The database ownership FK/trigger still prevents it from creating a second owner's business rows.
- The service client and owner-scope modules use the framework's server-only boundary. Public-client credentials are checked at runtime; Vite rejects secret/service-role public configuration before bundling. CI builds with a synthetic server secret and scans browser output for leakage.
- The browser has no signup UI. Local Supabase signup is disabled. Even if hosted Auth signup is accidentally enabled, registration never grants application access.

## Table-by-table operation matrix

“Owner” means the authenticated, explicitly provisioned installation owner, with matching row `user_id` for private data. “Service” means trusted server/CLI code, never a browser credential. All anonymous operations are denied; all other authenticated accounts are denied. The service role has trusted maintenance CRUD on user-owned data too. It cannot provision, replace or delete the installation-owner registry through its API permissions.

| Table                             | Classification                  | SELECT | INSERT  | UPDATE  | DELETE  |
| --------------------------------- | ------------------------------- | ------ | ------- | ------- | ------- |
| `ai_requests`                     | audit/log data                  | Owner  | Service | Service | Service |
| `analyst_views`                   | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `audit_logs`                      | audit/log data                  | Owner  | Service | Service | Service |
| `automation_pipeline_items`       | system/service-only             | Owner  | Service | Service | Service |
| `automation_pipeline_runs`        | system/service-only             | Owner  | Service | Service | Service |
| `automation_settings`             | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `candidate_score_components`      | system/service-only             | Owner  | Service | Service | Service |
| `candidate_sources`               | system/service-only             | Owner  | Service | Service | Service |
| `claims`                          | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `companies`                       | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `content_assets`                  | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `content_composition_companies`   | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `content_compositions`            | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `content_orchestration_runs`      | system/service-only             | Owner  | Service | Service | Service |
| `content_orchestration_steps`     | system/service-only             | Owner  | Service | Service | Service |
| `content_publications`            | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `daily_market_runs`               | system/service-only             | Owner  | Service | Service | Service |
| `daily_run_executions`            | system/service-only             | Owner  | Service | Service | Service |
| `discovery_runs`                  | system/service-only             | Owner  | Service | Service | Service |
| `discovery_settings`              | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `earnings_reports`                | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `events`                          | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `fact_sprint_runs`                | system/service-only             | Owner  | Service | Service | Service |
| `financial_periods`               | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `market_holidays`                 | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `market_schedules`                | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `market_snapshots`                | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `profiles`                        | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `provider_data_conflicts`         | audit/log data                  | Owner  | Service | Service | Service |
| `provider_raw_responses`          | audit/log data                  | Owner  | Service | Service | Service |
| `provider_requests`               | audit/log data                  | Owner  | Service | Service | Service |
| `provider_stock_data`             | system/service-only             | Owner  | Service | Service | Service |
| `quantitative_metrics`            | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `research_gaps`                   | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `research_orchestration_runs`     | system/service-only             | Owner  | Service | Service | Service |
| `research_orchestration_settings` | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `research_orchestration_steps`    | system/service-only             | Owner  | Service | Service | Service |
| `research_packets`                | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `research_sections`               | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `run_locks`                       | system/service-only             | Owner  | Service | Service | Service |
| `run_notifications`               | audit/log data                  | Owner  | Service | Service | Service |
| `scenario_forecasts`              | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `scores`                          | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `script_audits`                   | audit/log data                  | Owner  | Service | Service | Service |
| `script_repairs`                  | audit/log data                  | Owner  | Service | Service | Service |
| `script_sections`                 | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `script_statements`               | system/service-only             | Owner  | Service | Service | Service |
| `script_style_checks`             | audit/log data                  | Owner  | Service | Service | Service |
| `script_style_profiles`           | shared read-only reference data | Owner  | Service | Service | Service |
| `script_versions`                 | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `scripts`                         | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `sec_facts`                       | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `sec_filings`                     | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `sec_ticker_cik`                  | shared read-only reference data | Owner  | Service | Service | Service |
| `sentiment_snapshots`             | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `sources`                         | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `stories`                         | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `story_candidates`                | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `technical_metrics`               | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `universe_members`                | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `valuations`                      | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `watchlist_items`                 | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `watchlists`                      | user-owned                      | Owner  | Owner   | Owner   | Owner   |
| `web_research_runs`               | system/service-only             | Owner  | Service | Service | Service |

Classification totals: **37 user-owned, 0 workspace-owned, 2 shared read-only reference, 16 system/service-only, 9 audit/log = 64 public application tables**. The machine-readable inventory is [`supabase/authorization-matrix.json`](../supabase/authorization-matrix.json); database tests check every row against actual policies and grants.

The additional `private.installation_owner` registry is system/operator-only: SELECT/INSERT/UPDATE/DELETE are denied to anonymous, authenticated and service API roles. Only the database owner can provision once using the private function. Read-only security-definer helpers expose an owner-membership boolean and supply ownership defaults; they cannot enroll accounts or accept a caller-selected owner ID.

## Migration and safe provisioning

1. Use a fresh development Supabase project/database. Keep its credentials outside source control. Disable hosted Auth signup in its dashboard as well as local configuration.
2. Apply **all 28 SQL migrations in filename order**, as a database migration operator, before creating Auth accounts. The final migration refuses projects containing Auth accounts or existing research records. Do not apply it blindly to an old shared deployment; preserving that data requires a separately reviewed export, ownership reconciliation and import.
3. Create the intended owner account through trusted Auth administration (not public signup). Obtain its UUID privately from that development Auth system.
4. With a database-owner connection, execute the following parameterized statement, binding that UUID to `$1`: `SELECT private.provision_owner($1::uuid);`. No UUID or production credentials are supplied in this repository. PostgREST/browser/service-role calls cannot execute this private provisioning function.
5. The transaction assigns migration-provided public-company universe/configuration seeds, makes ownership columns NOT NULL and creates the owner profile. A second provisioning attempt fails. Owner deletion/transfer is restricted by foreign keys; use a fresh installation or a separately reviewed operator migration.
6. Optionally load [`supabase/seed.sql`](../supabase/seed.sql) through trusted development database tooling. It refuses an unprovisioned database and inserts only an invented company/watchlist with default owner attribution. Automatic Supabase CLI seed loading is disabled in `config.toml`; run the optional seed manually after provisioning.
7. Configure browser publishable credentials and server-only service/provider credentials. Sign in as the provisioned owner. Live acceptance harnesses additionally require a short-lived owner `OWNER_ACCESS_TOKEN`; they verify it and the owner RPC before launching work.

Before provisioning, business writes are rejected even for the service role; authenticated reads return no records. Default seed/configuration rows may temporarily have NULL ownership but are inaccessible through browser policies. Provisioning resolves this state atomically. The private registry is not an exposed application API schema.

## Authorization evidence and limits

Actual PostgreSQL tests replay all migrations using PGlite, a PostgreSQL WASM runtime, with minimal local Auth schemas/roles and the `auth.uid()` JWT-subject contract. Tests change database roles and subject settings, rather than simulating policy decisions in JavaScript. Every table is checked for anonymous denial, second-user isolation, forced RLS, operation grants and policy predicates. Positive business CRUD, ownership/attribution forgery, service-write boundaries, provisioning and synthetic seeding are also exercised. A rollback-only superuser fixture injects an otherwise prohibited foreign-owner row to prove that the owner's RLS still rejects SELECT/UPDATE/DELETE on it.

The original 104 deterministic tests remain. Request-scope, public credential and server-entry-point tests complement the SQL tests. Hosted Supabase Auth/PostgREST, browser end-to-end workflows and paid providers were not exercised. Service credentials and database operators are trusted. Audit records are protected against direct browser writes but are not a tamper-proof or append-only compliance archive: trusted service maintenance and relational cascade actions remain possible. This package makes no multi-tenant, penetration-tested or overall production-readiness claim.
