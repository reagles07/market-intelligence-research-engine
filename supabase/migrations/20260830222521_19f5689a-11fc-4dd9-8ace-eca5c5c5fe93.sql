CREATE TABLE public.content_compositions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mode text NOT NULL DEFAULT 'MULTI_STOCK',
  title text,
  theme text,
  creator_instruction text,
  platform text NOT NULL DEFAULT 'YouTube',
  language text NOT NULL DEFAULT 'Tanglish',
  tone text NOT NULL DEFAULT 'Analytical',
  long_enabled boolean NOT NULL DEFAULT true,
  shorts_enabled boolean NOT NULL DEFAULT true,
  target_duration text,
  custom_duration_minutes integer,
  short_allocation jsonb NOT NULL DEFAULT '{}'::jsonb,
  combined_shorts integer NOT NULL DEFAULT 0,
  allow_ranking boolean NOT NULL DEFAULT false,
  auto_allocate boolean NOT NULL DEFAULT false,
  estimated_scripts integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT',
  pack_key text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.content_composition_companies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  composition_id uuid NOT NULL REFERENCES public.content_compositions(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL,
  packet_id uuid REFERENCES public.research_packets(id) ON DELETE SET NULL,
  packet_version integer,
  readiness text,
  eligible boolean NOT NULL DEFAULT false,
  ineligible_reason text,
  short_count integer NOT NULL DEFAULT 0,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (composition_id, company_id)
);

ALTER TABLE public.scripts
  ADD COLUMN composition_id uuid REFERENCES public.content_compositions(id) ON DELETE SET NULL,
  ADD COLUMN is_multi_stock boolean NOT NULL DEFAULT false,
  ADD COLUMN company_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE INDEX idx_scripts_composition ON public.scripts(composition_id);
CREATE INDEX idx_composition_companies_composition ON public.content_composition_companies(composition_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_compositions TO authenticated;
GRANT ALL ON public.content_compositions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_composition_companies TO authenticated;
GRANT ALL ON public.content_composition_companies TO service_role;

ALTER TABLE public.content_compositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_composition_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated workspace access" ON public.content_compositions FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "authenticated workspace access" ON public.content_composition_companies FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TRIGGER set_content_compositions_updated_at BEFORE UPDATE ON public.content_compositions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();