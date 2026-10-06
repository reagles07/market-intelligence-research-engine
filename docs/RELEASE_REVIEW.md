# Release candidate review

Reviewed on 2026-10-06. No repository was published or deployed. Source: `market-intelligence-research-engine-authorized.zip` (302 files under one repository root).

## Production dependency vulnerability audit

`npm audit --omit=dev --json` completed successfully after lockfile installation. Results: **0 critical, 0 high, 0 moderate, 0 low, 0 total advisories**. No exploitable critical/high production finding required a dependency change. The complete machine-readable report is [DEPENDENCY_AUDIT.json](DEPENDENCY_AUDIT.json).

The audit checks known registry advisories; it is not a penetration test or a guarantee against undisclosed vulnerabilities. Deprecation/support status is a separate classification, not a CVSS severity.

| Package / resolved version | Classification                                | Exposure                                                                                                                 | Decision                                                                                                                                                   |
| -------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recharts 2.15.4            | Deprecated; inactive 2.x branch               | Production browser charting dependency                                                                                   | Retain tested version for this source release; schedule a deliberate 3.x chart/API migration. No known audit advisory found.                               |
| tsconfck 3.1.6             | Unsupported/unmaintained; registry-deprecated | Transitive through vite-tsconfig-paths 6.1.1; classified as production in the lockfile, used by Vite build configuration | Retain for now; modernize/remove the build dependency through a tested change. No known audit advisory found.                                              |
| ESLint 9.39.5              | Unsupported/EOL; registry-deprecated          | Development lint tooling, omitted from production audit                                                                  | Retain working tooling for this release; plan compatible ESLint/plugin modernization. This does not clear development dependencies of security advisories. |

No blind `audit fix --force`, version overrides or major upgrades were used. The lockfile's existing dependency versions are unchanged. Package metadata now explicitly declares `UNLICENSED`, and CI adds a high/critical production-audit gate.

Primary references: [Recharts migration guide](https://github.com/recharts/recharts/wiki/3.0-migration-guide), [ESLint support policy](https://eslint.org/version-support/). Registry deprecation messages are recorded in the lockfile and were also reproduced by installation.

## Content and packaging checks

- README explicitly describes one provisioned owner per installation, private ownership checks and denied access for other accounts. It makes no collaborative or multi-tenant SaaS claim.
- `.env.example` has placeholder URLs/project references/key labels, a sample example.com contact and an empty optional owner-token value. No working credentials are present.
- No screenshots or image assets are included in this candidate. The architecture Mermaid diagram uses generic technical labels; README links/documentation, fixtures, metadata and package files were reviewed and scanned.
- No confidential employer/carrier/platform branding or customer records were found. Public-company research examples and fictitious fixtures are intentional.
- `NOTICE` states Copyright 2026 Sathishkumar Subburam, All Rights Reserved. No LICENSE/COPYING file or open-source source grant is included; dependency licenses remain theirs. `package.json` explicitly uses `UNLICENSED`.
- The archive has one `market-intelligence-research-engine/` root. It excludes working environment files, dependency trees, generated output, temporary files, database dumps and Git history. Synthetic schema migrations/optional seed SQL are source files, not a database export.

## Fresh history and publication plan

Prepare the candidate in a new checkout with a single `main` initial commit: `Initial release: secure single-owner financial research workspace`. No earlier development history is carried forward; no remote or nested Git repository is included in the deliverable ZIP.

Pending explicit approval:

1. Create a public repository named `market-intelligence-research-engine` in the approved GitHub account.
2. Set description: Full-stack financial intelligence platform for US and Indian equities with evidence lineage, deterministic audits, and human-reviewed AI research.
3. Set topics: `typescript`, `react`, `tanstack`, `postgresql`, `supabase`, `financial-data`, `openai-api`, `data-lineage`.
4. Push only the fresh initial commit to `main`. Add no open-source license, credentials, hosted database, paid service or application deployment.
5. Watch the first GitHub Actions run. Investigate/fix cloud differences, commit any necessary correction, and rerun until green before pinning the repository.

Publication is blocked until the user explicitly approves this concrete plan. Dependency support warnings remain disclosed maintenance work rather than being presented as security clearance.
