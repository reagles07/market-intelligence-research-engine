# Security

This sanitized portfolio/reference application implements **one explicitly provisioned owner per installation**. It is not a collaborative workspace or multi-tenant SaaS. Read the [64-table authorization matrix and setup](docs/DATABASE_AUTHORIZATION.md).

## Access boundaries

All 64 public tables have forced RLS. Private rows carry immutable `user_id`, constrained to the installation owner. Browser access requires both matching `auth.uid()` and approved ownership. User-owned tables permit owner CRUD; system/audit/reference tables permit owner reads only. Anonymous and other authenticated accounts are denied. Auth signup does not confer access, and the browser signup UI has been removed.

Every server function verifies an Auth bearer token and the database owner RPC before opening a privileged request scope. The service client refuses access outside that scope. System writes and provider/orchestration work use the trusted server client after this check. Its key never belongs in the browser. Service roles bypass RLS, so key theft or compromised trusted code remains privileged compromise; database ownership triggers/FKs prevent introducing a second owner's private rows but do not turn a service key into an unprivileged credential.

Audit records cannot be directly inserted, updated or deleted with browser credentials. They are not a tamper-proof compliance archive: trusted maintenance and relational cascade actions remain possible.

## Provisioning and upgrades

The final authorization migration requires a fresh project with no Auth users or existing research records. Apply all migrations first, create the intended Auth account through trusted administration, then call the private provisioning function through a database-owner connection. No browser/service API role can enroll itself. Provisioning is one-time and atomic; before it, access is closed. Disable hosted Auth signup to avoid unwanted registrations, although accidental enablement does not grant application access.

Do not retrofit an old shared production database by assigning every row to an arbitrary user. Review/export/reconcile existing ownership separately, or use a new synthetic development installation. Owner transfer and deletion require separately reviewed database-operator work.

## Credentials

Public clients accept only publishable or legacy anon keys. Build-time configuration rejects secret/service-role public values before bundling; server modules use the framework's server-only fence. CI scans browser assets after building with a synthetic service-key canary. Keep service/provider keys and optional short-lived CLI owner JWTs in server environment variables, never `VITE_` variables or source control.

The environment/configuration files contain placeholders. Synthetic tests generate UUIDs at runtime; no live user IDs, project IDs, production backend addresses, service-role values or confidential records are intentionally included. Public-company examples and invented financial fixtures are illustrative.

## Verification and limitations

CI installs from the lockfile and runs formatting, lint, TypeScript, deterministic and actual PostgreSQL RLS tests, migration validation, source scans, production build and a browser-output secret check. Exact local results are recorded in [validation](docs/VALIDATION.md).

The SQL test runtime uses a minimal Auth schema/subject contract. Hosted Supabase Auth/PostgREST, browser end-to-end flows, paid-provider integrations, deployment and penetration testing were not run. Existing dependency deprecations/build warnings remain separate review work. Hosting, TLS, session expiry/revocation, rate limits, backups and provider permissions require deployment validation. No general production-readiness or multi-tenant isolation claim is made.

Report vulnerabilities privately to the repository owner; do not put sensitive records or credentials in public issues.
