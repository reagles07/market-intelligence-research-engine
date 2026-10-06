CREATE TABLE public.content_orchestration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  market text,
  trigger_source text NOT NULL DEFAULT 'MANUAL',
  status text NOT NULL DEFAULT 'QUEUED',
  current_step text,
  request_key text,
  cache_hit boolean NOT NULL DEFAULT false,
  reused_run_id uuid REFERENCES public.content_orchestration_runs(id) ON DELETE SET NULL,
  packet_id uuid REFERENCES public.research_packets(id) ON DELETE SET NULL,
  packet_version integer,
  style_profile_id text,
  style_profile_version integer,
  formats jsonb NOT NULL DEFAULT '[]'::jsonb,
  long_script_id uuid REFERENCES public.scripts(id) ON DELETE SET NULL,
  short_script_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  scripts_generated integer NOT NULL DEFAULT 0,
  word_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  audit_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  repairs_run integer NOT NULL DEFAULT 0,
  gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  gaps_resolved integer NOT NULL DEFAULT 0,
  gaps_unresolved integer NOT NULL DEFAULT 0,
  readiness text,
  readiness_reason text,
  readiness_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_calls integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_orchestration_runs TO authenticated;
GRANT ALL ON public.content_orchestration_runs TO service_role;
ALTER TABLE public.content_orchestration_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.content_orchestration_runs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE INDEX content_orchestration_runs_story_idx ON public.content_orchestration_runs (story_id, started_at DESC);
CREATE INDEX content_orchestration_runs_request_key_idx ON public.content_orchestration_runs (request_key, started_at DESC);

CREATE TRIGGER content_orch_runs_updated BEFORE UPDATE ON public.content_orchestration_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.content_orchestration_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.content_orchestration_runs(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  label text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_calls integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_orchestration_steps TO authenticated;
GRANT ALL ON public.content_orchestration_steps TO service_role;
ALTER TABLE public.content_orchestration_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.content_orchestration_steps
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE INDEX content_orchestration_steps_run_idx ON public.content_orchestration_steps (run_id, order_index);

CREATE TRIGGER content_orch_steps_updated BEFORE UPDATE ON public.content_orchestration_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS content_status text NOT NULL DEFAULT 'NOT_STARTED';