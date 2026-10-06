# Data model

The 28 chronological SQL migrations are the authoritative schema. Generated TypeScript database bindings live in `src/integrations/supabase/types.ts`.

| Domain          | Representative tables                                                      | Purpose                           |
| --------------- | -------------------------------------------------------------------------- | --------------------------------- |
| Identity        | profiles                                                                   | Authenticated user metadata       |
| Market universe | companies, watchlists, watchlist_items                                     | Company selection                 |
| Market facts    | market_snapshots, financial_periods, earnings_reports, valuations          | Structured financial context      |
| Filings         | sec_filings, sec_facts, sec_ticker_cik                                     | Primary-source data               |
| Evidence        | sources, claims                                                            | Traceable research inputs         |
| Research        | research_packets, research_sections, research_gaps                         | Research state and completeness   |
| Discovery       | discovery_runs, story_candidates, candidate_sources                        | Candidate generation and lineage  |
| Content         | scripts, script_versions, script_sections, script_audits                   | Generation, revisions, and checks |
| Composition     | content_compositions, content_composition_companies                        | Multi-company output              |
| Operations      | provider_requests, content_orchestration_runs, content_orchestration_steps | Usage and workflow state          |

Migration seeds contain public-company universe examples, application configuration and editorial profiles, not a production export. The optional `supabase/seed.sql` adds an invented company/watchlist only after explicit owner provisioning.

All 64 public tables have forced RLS. 62 private tables carry immutable `user_id` with a foreign key to the one-row `private.installation_owner` registry. Provisioning assigns only fresh migration seed/configuration rows and makes these columns NOT NULL. Profiles additionally require `id = user_id`. All application rows belong to one installation owner; global company keys and singleton settings remain valid because multiple owners cannot share an installation.

The two reference tables are browser read-only. System/audit tables are browser read-only, with trusted server maintenance. The [complete authorization matrix](DATABASE_AUTHORIZATION.md) and `supabase/authorization-matrix.json` classify every public table. No workspace membership or multi-tenant model is claimed.
