# Material changes

The code-quality review retained the research scoring and numeric/evidence algorithms while fixing types, hooks, promises and accessibility. The subsequent authorization review deliberately replaces database permissions and signup behavior with a fail-closed, explicitly provisioned single-user model. Research algorithms remain unchanged.

| Group                | Main changes                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lint and CI          | Enabled unused-variable and typed promise checks; exact recipe-export allowlists; CI now installs from lockfile and checks formatting, lint, tests, TypeScript, and build on Node 24 |
| Data contracts       | Schema-backed database client/row/table types and inferred query results replaced handwritten any contracts and suppressions                                                         |
| Orchestrators        | Typed metadata/results, null guards, serializable responses; provider/research sequence retained                                                                                     |
| React                | Stable hook dependencies, corrected showTest filtering, custom hooks/utilities split from components                                                                                 |
| Async errors         | Cache refresh/navigation/clipboard/auth rejections logged and surfaced; auth SDK sign-out error handled                                                                              |
| Accessibility        | Automation switches named; holiday market select explicitly labelled                                                                                                                 |
| Acceptance harnesses | Typed clients and results, checked nulls/JSON, corrected obsolete report fields and nonexistent column; live scripts not executed                                                    |
| Documentation        | 139-item baseline lint ledger, additional findings, full 64-table authorization audit, explicit reference-environment boundaries                                                     |

## Code-quality changed-file list

- `.github/workflows/ci.yml`
- `README.md`
- `SECURITY.md`
- `docs/DATABASE_AUTHORIZATION.md`
- `docs/DATA_MODEL.md`
- `docs/LINT_REVIEW.md`
- `eslint.config.js`
- `package.json`
- `scripts/evidence-backfill.ts`
- `scripts/final-content-pass.ts`
- `scripts/golden-path-acceptance.ts`
- `scripts/golden-path-rerun.ts`
- `scripts/pass1b-acceptance.ts`
- `scripts/pass1c-acceptance.ts`
- `scripts/pass1d-acceptance.ts`
- `scripts/pass1e-acceptance.ts`
- `scripts/pass1f-acceptance.ts`
- `scripts/pass2a-acceptance.ts`
- `scripts/pass2b-acceptance.ts`
- `scripts/pass2c-acceptance.ts`
- `scripts/pass2d1-acceptance.ts`
- `scripts/pass2d2-acceptance.ts`
- `src/components/common/elapsed-utils.ts`
- `src/components/common/elapsed.tsx`
- `src/components/content/ContentOrchestratorPanel.tsx`
- `src/components/content/ResearchGapsPanel.tsx`
- `src/components/content/ScriptAuditPanel.tsx`
- `src/components/content/ScriptGeneratorPanel.tsx`
- `src/components/layout/AppShell.tsx`
- `src/components/providers/IndianApiPanel.tsx`
- `src/components/providers/OpenAiPanel.tsx`
- `src/components/providers/SecEdgarPanel.tsx`
- `src/components/providers/SyncIndianApiButton.tsx`
- `src/components/providers/SyncSecButton.tsx`
- `src/components/providers/use-ai-model.ts`
- `src/components/research/AiResearchPanel.tsx`
- `src/components/research/FactSprintPanel.tsx`
- `src/components/research/ResearchOrchestratorPanel.tsx`
- `src/components/schedule/AutomationSettingsPanel.tsx`
- `src/components/schedule/PipelineLineagePanel.tsx`
- `src/lib/ai/precheck.server.ts`
- `src/lib/ai/research.server.ts`
- `src/lib/ai/script.server.ts`
- `src/lib/async-errors.ts`
- `src/lib/automation/pipeline.server.ts`
- `src/lib/content/orchestrator.server.ts`
- `src/lib/data-types.ts`
- `src/lib/discovery.functions.ts`
- `src/lib/discovery/promote.server.ts`
- `src/lib/market-context-value.ts`
- `src/lib/market-context.tsx`
- `src/lib/research/evidence.server.ts`
- `src/lib/research/fact-sprint.server.ts`
- `src/lib/research/freshness.server.ts`
- `src/lib/research/material.server.ts`
- `src/lib/research/orchestrator.server.ts`
- `src/lib/schedule.functions.ts`
- `src/lib/schedule/controller.server.ts`
- `src/lib/schedule/scheduler.server.ts`
- `src/lib/sec/items.server.ts`
- `src/routes/__root.tsx`
- `src/routes/_authenticated/admin.tsx`
- `src/routes/_authenticated/candidates.tsx`
- `src/routes/_authenticated/dashboard.tsx`
- `src/routes/_authenticated/discovery.tsx`
- `src/routes/_authenticated/library.tsx`
- `src/routes/_authenticated/market.tsx`
- `src/routes/_authenticated/research.tsx`
- `src/routes/_authenticated/runs/$id.tsx`
- `src/routes/_authenticated/runs/index.tsx`
- `src/routes/_authenticated/scripts/$id.tsx`
- `src/routes/_authenticated/scripts/composer.tsx`
- `src/routes/_authenticated/settings.tsx`
- `src/routes/_authenticated/sources.tsx`
- `src/routes/_authenticated/stocks/$id.tsx`
- `src/routes/_authenticated/stocks/index.tsx`
- `src/routes/_authenticated/stories/$id.tsx`
- `src/routes/_authenticated/stories/index.tsx`
- `src/routes/_authenticated/watchlists.tsx`
- `src/routes/auth.tsx`
- `tsconfig.json`
- `docs/CHANGES.md`
- `docs/VALIDATION.md`

## Authorization architecture changes

The final authorization migration replaces shared CRUD with a secure single-owner installation. It adds a private, operator-only owner registry, row ownership defaults/FKs/triggers, forced RLS and exact per-operation policies. System/audit/reference browser writes are removed. Old business migration policies now deny access until the final migration, and unused database cron/network extension declarations are removed.

Auth middleware now requires a verified owner RPC result before a server-only privileged request scope. The service client refuses access outside that scope. Browser credentials and public build configuration reject private keys; the signup UI is removed and authenticated route entry checks ownership. All live CLI harnesses require a verified development owner token.

The 64-table matrix, PostgreSQL tests, provisioning/seed tests, source-entry-point tests, repeatable synthetic seed, migration validator and publication scanner are included. CI runs these and checks browser output after a synthetic-secret canary build. README/security/architecture/data-model/validation documents describe the implemented single-user model and its limitations.

### Files materially changed in the authorization review

- `.env.example`
- `.github/workflows/ci.yml`
- `README.md`
- `SECURITY.md`
- `docs/ARCHITECTURE.md`
- `docs/CHANGES.md`
- `docs/DATABASE_AUTHORIZATION.md`
- `docs/DATA_MODEL.md`
- `docs/VALIDATION.md`
- `package-lock.json`
- `package.json`
- `scripts/evidence-backfill.ts`
- `scripts/final-content-pass.ts`
- `scripts/golden-path-acceptance.ts`
- `scripts/golden-path-rerun.ts`
- `scripts/pass1b-acceptance.ts`
- `scripts/pass1c-acceptance.ts`
- `scripts/pass1d-acceptance.ts`
- `scripts/pass1e-acceptance.ts`
- `scripts/pass1f-acceptance.ts`
- `scripts/pass2a-acceptance.ts`
- `scripts/pass2b-acceptance.ts`
- `scripts/pass2c-acceptance.ts`
- `scripts/pass2d1-acceptance.ts`
- `scripts/pass2d2-acceptance.ts`
- `scripts/security/database.ts`
- `scripts/security/owner-cli.ts`
- `scripts/security/scan-publication.ts`
- `scripts/security/validate-migrations.ts`
- `src/integrations/supabase/auth-middleware.ts`
- `src/integrations/supabase/client.server.ts`
- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/owner-scope.server.ts`
- `src/integrations/supabase/public-key.ts`
- `src/integrations/supabase/types.ts`
- `src/lib/ai.functions.ts`
- `src/lib/ai/context.server.ts`
- `src/routes/_authenticated/route.tsx`
- `src/routes/auth.tsx`
- `src/security/authorization.test.ts`
- `src/security/entry-points.test.ts`
- `src/security/migration-lifecycle.test.ts`
- `src/security/owner-scope.test.ts`
- `supabase/authorization-matrix.json`
- `supabase/config.toml`
- `supabase/migrations/20260807190851_505d3359-4e61-4599-8ef4-95601b9a7f77.sql`
- `supabase/migrations/20260808043842_a946adb2-938a-4710-b4e4-fe7a929cd231.sql`
- `supabase/migrations/20260808045727_a2fe9ab4-1576-4c98-a0aa-9b85f3296adb.sql`
- `supabase/migrations/20260808061323_8bab7448-6c57-4cef-8b73-16d1d5323789.sql`
- `supabase/migrations/20260808063436_d18542af-4eb3-41fc-9820-5af4259a0d17.sql`
- `supabase/migrations/20260808201711_f742658a-4c93-432c-b5f9-a570d3c2fa46.sql`
- `supabase/migrations/20260808212425_15206511-c4d1-4b21-a758-494f45e86a3d.sql`
- `supabase/migrations/20260808220404_393d971e-d466-4fc1-a171-6d9c106de5af.sql`
- `supabase/migrations/20260808222625_74e84285-0d27-4b66-b64b-ebe69842f57a.sql`
- `supabase/migrations/20260808225440_9ac89c8a-914b-4422-8ee5-f209cf7c78a0.sql`
- `supabase/migrations/20260809021608_99f46fa7-7476-4245-985c-fd5a2b69d02d.sql`
- `supabase/migrations/20260809025332_a35d78ee-e71a-4d29-a4e6-ee5dc3d7655c.sql`
- `supabase/migrations/20260809030117_6f5f0c4f-eb75-415a-b35f-a8069b4cfd53.sql`
- `supabase/migrations/20260809030142_6d22bd7d-a2a7-4419-be7a-2cc001da6b58.sql`
- `supabase/migrations/20260809032418_5b8b2bf6-62ee-427f-b1e2-f7c038df3007.sql`
- `supabase/migrations/20260820211200_cda00c63-9e64-4315-a500-577bd88e3a7d.sql`
- `supabase/migrations/20260828185555_8a7cf60c-0da1-4292-a13b-cb99d2627c14.sql`
- `supabase/migrations/20260830222521_19f5689a-11fc-4dd9-8ace-eca5c5c5fe93.sql`
- `supabase/migrations/20261006000000_secure_single_owner.sql`
- `supabase/seed.sql`
- `vite.config.ts`
