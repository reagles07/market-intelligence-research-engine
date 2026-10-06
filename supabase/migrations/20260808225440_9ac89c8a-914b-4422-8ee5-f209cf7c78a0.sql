CREATE TABLE public.research_orchestration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  market text,
  trigger_source text NOT NULL DEFAULT 'MANUAL',
  status text NOT NULL DEFAULT 'QUEUED',
  current_step text,
  is_rerun boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  packet_start_id uuid,
  packet_start_version integer,
  packet_final_id uuid,
  packet_final_version integer,
  provider_requests integer NOT NULL DEFAULT 0,
  indianapi_requests integer NOT NULL DEFAULT 0,
  sec_requests integer NOT NULL DEFAULT 0,
  web_searches integer NOT NULL DEFAULT 0,
  ai_calls integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  sources_added integer NOT NULL DEFAULT 0,
  claims_added integer NOT NULL DEFAULT 0,
  conflicts_found integer NOT NULL DEFAULT 0,
  packet_builds integer NOT NULL DEFAULT 0,
  coverage_flag text,
  data_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  freshness jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness text,
  readiness_reason text,
  readiness_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  delta jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_orchestration_runs TO authenticated;
GRANT ALL ON public.research_orchestration_runs TO service_role;
ALTER TABLE public.research_orchestration_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.research_orchestration_runs FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE INDEX research_orchestration_runs_story_idx ON public.research_orchestration_runs (story_id, started_at DESC);
CREATE TRIGGER research_orchestration_runs_updated BEFORE UPDATE ON public.research_orchestration_runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.research_orchestration_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.research_orchestration_runs(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  step_index integer NOT NULL DEFAULT 0,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  detail text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_orchestration_steps TO authenticated;
GRANT ALL ON public.research_orchestration_steps TO service_role;
ALTER TABLE public.research_orchestration_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.research_orchestration_steps FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE INDEX research_orchestration_steps_run_idx ON public.research_orchestration_steps (run_id, step_index);
CREATE TRIGGER research_orchestration_steps_updated BEFORE UPDATE ON public.research_orchestration_steps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.research_orchestration_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  india_max_company_calls integer NOT NULL DEFAULT 5,
  web_max_queries integer NOT NULL DEFAULT 6,
  max_packet_builds integer NOT NULL DEFAULT 2,
  max_scenario_runs integer NOT NULL DEFAULT 1,
  market_data_max_age_hours integer NOT NULL DEFAULT 12,
  sec_max_age_days integer NOT NULL DEFAULT 7,
  financials_max_age_days integer NOT NULL DEFAULT 30,
  batch_max_stories integer NOT NULL DEFAULT 3,
  indianapi_quota_reserve integer NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_orchestration_settings TO authenticated;
GRANT ALL ON public.research_orchestration_settings TO service_role;
ALTER TABLE public.research_orchestration_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.research_orchestration_settings FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER research_orchestration_settings_updated BEFORE UPDATE ON public.research_orchestration_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.research_orchestration_settings DEFAULT VALUES;