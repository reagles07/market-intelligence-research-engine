CREATE TABLE public.fact_sprint_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL,
  packet_id uuid REFERENCES public.research_packets(id) ON DELETE SET NULL,
  packet_version integer,
  status text NOT NULL DEFAULT 'RUNNING',
  current_step text,
  model text,
  gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  gaps_targeted integer NOT NULL DEFAULT 0,
  gaps_filled integer NOT NULL DEFAULT 0,
  gaps_unresolved integer NOT NULL DEFAULT 0,
  sources_added integer NOT NULL DEFAULT 0,
  conflicts integer NOT NULL DEFAULT 0,
  searches integer NOT NULL DEFAULT 0,
  passes integer NOT NULL DEFAULT 0,
  inaccessible_primaries integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  latest_source_at timestamptz,
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX fact_sprint_runs_story_idx ON public.fact_sprint_runs (story_id, created_at DESC);
CREATE INDEX fact_sprint_runs_company_idx ON public.fact_sprint_runs (company_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fact_sprint_runs TO authenticated;
GRANT ALL ON public.fact_sprint_runs TO service_role;
ALTER TABLE public.fact_sprint_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.fact_sprint_runs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);