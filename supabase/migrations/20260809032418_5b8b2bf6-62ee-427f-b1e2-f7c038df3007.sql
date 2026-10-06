ALTER TABLE public.automation_settings
  ADD COLUMN IF NOT EXISTS autonomous_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS autonomous_ai_budget_percent numeric NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS min_content_score_india numeric NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS min_content_score_us numeric NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS min_score_coverage_india numeric NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS min_score_coverage_us numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS max_research_main integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_content_main integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_research_delta integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_content_delta integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS autonomous_short_duration text NOT NULL DEFAULT 'short_60',
  ADD COLUMN IF NOT EXISTS autonomous_long_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS autonomous_long_min_score numeric NOT NULL DEFAULT 85;

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS promotion_source text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS pipeline_run_id uuid;

CREATE TABLE IF NOT EXISTS public.automation_pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid REFERENCES public.daily_run_executions(id) ON DELETE SET NULL,
  daily_run_id uuid REFERENCES public.daily_market_runs(id) ON DELETE CASCADE,
  discovery_run_id uuid REFERENCES public.discovery_runs(id) ON DELETE SET NULL,
  market text NOT NULL,
  market_date date NOT NULL,
  execution_type text NOT NULL DEFAULT 'MAIN_DISCOVERY',
  trigger text NOT NULL DEFAULT 'SCHEDULED',
  dry_run boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'RUNNING',
  skip_reason text,
  candidates_considered integer NOT NULL DEFAULT 0,
  candidates_qualified integer NOT NULL DEFAULT 0,
  stories_promoted integer NOT NULL DEFAULT 0,
  research_runs integer NOT NULL DEFAULT 0,
  research_ready integer NOT NULL DEFAULT 0,
  content_runs integer NOT NULL DEFAULT 0,
  ready_for_review integer NOT NULL DEFAULT 0,
  needs_attention integer NOT NULL DEFAULT 0,
  ai_calls integer NOT NULL DEFAULT 0,
  provider_calls integer NOT NULL DEFAULT 0,
  web_searches integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  autonomous_budget_usd numeric NOT NULL DEFAULT 0,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_pipeline_runs TO authenticated;
GRANT ALL ON public.automation_pipeline_runs TO service_role;
ALTER TABLE public.automation_pipeline_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.automation_pipeline_runs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER automation_pipeline_runs_updated BEFORE UPDATE ON public.automation_pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.automation_pipeline_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id uuid NOT NULL REFERENCES public.automation_pipeline_runs(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES public.story_candidates(id) ON DELETE SET NULL,
  story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL,
  research_run_id uuid REFERENCES public.research_orchestration_runs(id) ON DELETE SET NULL,
  content_run_id uuid REFERENCES public.content_orchestration_runs(id) ON DELETE SET NULL,
  market text NOT NULL,
  company_name text NOT NULL DEFAULT '',
  ticker text,
  title text NOT NULL DEFAULT '',
  content_score numeric NOT NULL DEFAULT 0,
  score_coverage_pct numeric NOT NULL DEFAULT 0,
  rank_index integer NOT NULL DEFAULT 0,
  stage text NOT NULL DEFAULT 'QUALIFIED',
  outcome text NOT NULL DEFAULT 'PENDING',
  research_readiness text,
  content_readiness text,
  skip_reason text,
  gaps_detected integer NOT NULL DEFAULT 0,
  gaps_resolved integer NOT NULL DEFAULT 0,
  ai_calls integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_pipeline_items TO authenticated;
GRANT ALL ON public.automation_pipeline_items TO service_role;
ALTER TABLE public.automation_pipeline_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.automation_pipeline_items
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER automation_pipeline_items_updated BEFORE UPDATE ON public.automation_pipeline_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS automation_pipeline_runs_market_idx
  ON public.automation_pipeline_runs (market, market_date DESC, started_at DESC);
CREATE INDEX IF NOT EXISTS automation_pipeline_items_run_idx
  ON public.automation_pipeline_items (pipeline_run_id, rank_index);