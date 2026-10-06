
ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS canonical_url text,
  ADD COLUMN IF NOT EXISTS discovery_query text,
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS discovered_via text NOT NULL DEFAULT 'manual';

CREATE UNIQUE INDEX IF NOT EXISTS sources_company_canonical_url_idx
  ON public.sources (company_id, canonical_url)
  WHERE canonical_url IS NOT NULL AND company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.analyst_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL,
  source_id uuid REFERENCES public.sources(id) ON DELETE SET NULL,
  firm text NOT NULL,
  analyst text,
  rating text,
  price_target numeric,
  previous_price_target numeric,
  currency text,
  view_date date,
  rationale text,
  is_stale boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.analyst_views TO authenticated;
GRANT ALL ON public.analyst_views TO service_role;
ALTER TABLE public.analyst_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.analyst_views
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER analyst_views_updated BEFORE UPDATE ON public.analyst_views
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.web_research_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL,
  packet_id uuid REFERENCES public.research_packets(id) ON DELETE SET NULL,
  model text,
  queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources_found integer NOT NULL DEFAULT 0,
  sources_new integer NOT NULL DEFAULT 0,
  sources_duplicate integer NOT NULL DEFAULT 0,
  claims_added integer NOT NULL DEFAULT 0,
  conflicts integer NOT NULL DEFAULT 0,
  confirmations integer NOT NULL DEFAULT 0,
  analyst_views integer NOT NULL DEFAULT 0,
  web_search_calls integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  delta_summary text,
  unresolved_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ok boolean NOT NULL DEFAULT true,
  error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.web_research_runs TO authenticated;
GRANT ALL ON public.web_research_runs TO service_role;
ALTER TABLE public.web_research_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.web_research_runs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
