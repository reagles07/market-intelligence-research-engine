CREATE TABLE public.discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market text NOT NULL,
  run_type text NOT NULL DEFAULT 'MANUAL',
  status text NOT NULL DEFAULT 'RUNNING',
  coverage text NOT NULL DEFAULT 'FULL_MARKET_COVERAGE',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  provider_requests integer NOT NULL DEFAULT 0,
  provider_endpoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_request_budget integer NOT NULL DEFAULT 0,
  web_search_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  web_search_calls integer NOT NULL DEFAULT 0,
  web_search_budget integer NOT NULL DEFAULT 0,
  ai_calls integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  raw_signals integer NOT NULL DEFAULT 0,
  candidates_created integer NOT NULL DEFAULT 0,
  clustered_duplicates integer NOT NULL DEFAULT 0,
  shortlisted integer NOT NULL DEFAULT 0,
  evaluated integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovery_runs TO authenticated;
GRANT ALL ON public.discovery_runs TO service_role;
ALTER TABLE public.discovery_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.discovery_runs FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER discovery_runs_updated BEFORE UPDATE ON public.discovery_runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX discovery_runs_market_idx ON public.discovery_runs(market, started_at DESC);

CREATE TABLE public.story_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discovery_run_id uuid REFERENCES public.discovery_runs(id) ON DELETE CASCADE,
  market text NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  company_name text NOT NULL,
  ticker text,
  exchange text,
  title text NOT NULL,
  primary_type text NOT NULL DEFAULT 'OTHER',
  candidate_types text[] NOT NULL DEFAULT '{}'::text[],
  discovery_reason text NOT NULL DEFAULT '',
  catalyst text,
  price_move_pct numeric,
  price_move_source text,
  price_move_at timestamptz,
  reported_price_move_pct numeric,
  volume numeric,
  volume_ratio numeric,
  activity_note text,
  week52_event text,
  headline text,
  url text,
  event_at timestamptz,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  provider_timestamp timestamptz,
  signal_count integer NOT NULL DEFAULT 1,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  best_source_tier text,
  coverage_flag text NOT NULL DEFAULT 'FULL_MARKET_COVERAGE',
  pre_score numeric NOT NULL DEFAULT 0,
  content_score numeric NOT NULL DEFAULT 0,
  score_coverage_pct numeric NOT NULL DEFAULT 0,
  priority_band text NOT NULL DEFAULT 'LOW PRIORITY',
  score_rank integer,
  ai_evaluated boolean NOT NULL DEFAULT false,
  suggested_angle text,
  suggested_hook text,
  core_question text,
  evaluation_notes text,
  status text NOT NULL DEFAULT 'DISCOVERED',
  cluster_key text NOT NULL,
  dismissed_reason text,
  story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL,
  promoted_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.story_candidates TO authenticated;
GRANT ALL ON public.story_candidates TO service_role;
ALTER TABLE public.story_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.story_candidates FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER story_candidates_updated BEFORE UPDATE ON public.story_candidates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX story_candidates_run_idx ON public.story_candidates(discovery_run_id, content_score DESC);
CREATE INDEX story_candidates_market_idx ON public.story_candidates(market, status, discovered_at DESC);
CREATE INDEX story_candidates_cluster_idx ON public.story_candidates(cluster_key);

CREATE TABLE public.candidate_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.story_candidates(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.sources(id) ON DELETE SET NULL,
  provider text NOT NULL,
  endpoint text,
  signal_type text,
  url text,
  canonical_url text,
  title text,
  publisher text,
  source_tier text NOT NULL DEFAULT 'Tier 3 — Financial Data Platform',
  source_type text NOT NULL DEFAULT 'Data Platform',
  published_at timestamptz,
  raw_response_id uuid REFERENCES public.provider_raw_responses(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_sources TO authenticated;
GRANT ALL ON public.candidate_sources TO service_role;
ALTER TABLE public.candidate_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.candidate_sources FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE INDEX candidate_sources_candidate_idx ON public.candidate_sources(candidate_id);

CREATE TABLE public.candidate_score_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.story_candidates(id) ON DELETE CASCADE,
  component_key text NOT NULL,
  label text NOT NULL,
  max_points numeric NOT NULL,
  points numeric NOT NULL DEFAULT 0,
  available boolean NOT NULL DEFAULT true,
  reason text NOT NULL DEFAULT '',
  value_text text,
  stage text NOT NULL DEFAULT 'DETERMINISTIC',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_score_components TO authenticated;
GRANT ALL ON public.candidate_score_components TO service_role;
ALTER TABLE public.candidate_score_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.candidate_score_components FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE UNIQUE INDEX candidate_score_components_unique ON public.candidate_score_components(candidate_id, component_key);

CREATE TABLE public.discovery_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true,
  auto_promote_enabled boolean NOT NULL DEFAULT false,
  auto_promote_top_n integer NOT NULL DEFAULT 0,
  min_score numeric NOT NULL DEFAULT 80,
  min_score_coverage_pct numeric NOT NULL DEFAULT 80,
  min_source_tier text NOT NULL DEFAULT 'Tier 2 — Reputable News',
  max_india_requests integer NOT NULL DEFAULT 7,
  max_us_web_queries integer NOT NULL DEFAULT 4,
  max_eval_candidates integer NOT NULL DEFAULT 10,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX discovery_settings_singleton ON public.discovery_settings(singleton);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discovery_settings TO authenticated;
GRANT ALL ON public.discovery_settings TO service_role;
ALTER TABLE public.discovery_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.discovery_settings FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER discovery_settings_updated BEFORE UPDATE ON public.discovery_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
INSERT INTO public.discovery_settings (singleton) VALUES (true);

ALTER TABLE public.stories ADD COLUMN discovery_run_id uuid REFERENCES public.discovery_runs(id) ON DELETE SET NULL;
ALTER TABLE public.stories ADD COLUMN candidate_id uuid REFERENCES public.story_candidates(id) ON DELETE SET NULL;