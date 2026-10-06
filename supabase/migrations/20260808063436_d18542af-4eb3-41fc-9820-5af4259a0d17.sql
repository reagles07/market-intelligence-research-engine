
ALTER TABLE public.scripts
  ADD COLUMN IF NOT EXISTS research_packet_version integer,
  ADD COLUMN IF NOT EXISTS target_duration text,
  ADD COLUMN IF NOT EXISTS tone text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS template_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS audit_status text NOT NULL DEFAULT 'Not Audited',
  ADD COLUMN IF NOT EXISTS word_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_duration_sec integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS series_key text,
  ADD COLUMN IF NOT EXISTS series_part integer,
  ADD COLUMN IF NOT EXISTS generation_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.script_versions
  ADD COLUMN IF NOT EXISTS research_packet_version integer,
  ADD COLUMN IF NOT EXISTS packet_id uuid REFERENCES public.research_packets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS template_version text,
  ADD COLUMN IF NOT EXISTS audit_status text;

ALTER TABLE public.content_assets
  ADD COLUMN IF NOT EXISTS packet_id uuid REFERENCES public.research_packets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS packet_version integer,
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.script_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  order_index integer NOT NULL DEFAULT 0,
  section_key text NOT NULL,
  label text NOT NULL,
  time_range text,
  spoken_text text NOT NULL DEFAULT '',
  on_screen_text text,
  visual_note text,
  micro_hook text,
  claim_ids uuid[] NOT NULL DEFAULT '{}',
  source_ids uuid[] NOT NULL DEFAULT '{}',
  research_section_ids uuid[] NOT NULL DEFAULT '{}',
  metric_keys text[] NOT NULL DEFAULT '{}',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS script_sections_script_idx ON public.script_sections (script_id, order_index);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.script_sections TO authenticated;
GRANT ALL ON public.script_sections TO service_role;
ALTER TABLE public.script_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.script_sections
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER script_sections_updated BEFORE UPDATE ON public.script_sections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.script_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  packet_id uuid REFERENCES public.research_packets(id) ON DELETE SET NULL,
  packet_version integer,
  status text NOT NULL DEFAULT 'FAIL',
  statements_total integer NOT NULL DEFAULT 0,
  supported integer NOT NULL DEFAULT 0,
  supported_with_attribution integer NOT NULL DEFAULT 0,
  needs_qualification integer NOT NULL DEFAULT 0,
  conflicting integer NOT NULL DEFAULT 0,
  unsupported integer NOT NULL DEFAULT 0,
  numeric_failures integer NOT NULL DEFAULT 0,
  blocking_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  model text,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS script_audits_script_idx ON public.script_audits (script_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.script_audits TO authenticated;
GRANT ALL ON public.script_audits TO service_role;
ALTER TABLE public.script_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.script_audits
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.script_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.script_audits(id) ON DELETE CASCADE,
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  section_id uuid REFERENCES public.script_sections(id) ON DELETE SET NULL,
  section_key text,
  statement_text text NOT NULL,
  statement_type text NOT NULL DEFAULT 'FACT',
  is_numeric boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'UNSUPPORTED',
  severity text NOT NULL DEFAULT 'Blocking',
  matched_claim_id uuid REFERENCES public.claims(id) ON DELETE SET NULL,
  matched_source_id uuid REFERENCES public.sources(id) ON DELETE SET NULL,
  matched_metric_key text,
  research_value text,
  script_value text,
  issue text,
  recommended_wording text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS script_statements_script_idx ON public.script_statements (script_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.script_statements TO authenticated;
GRANT ALL ON public.script_statements TO service_role;
ALTER TABLE public.script_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.script_statements
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
