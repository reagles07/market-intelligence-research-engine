CREATE TABLE public.research_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  story_id uuid REFERENCES public.stories(id) ON DELETE CASCADE,
  script_id uuid REFERENCES public.scripts(id) ON DELETE CASCADE,
  script_version integer,
  script_version_id uuid REFERENCES public.script_versions(id) ON DELETE SET NULL,
  audit_id uuid REFERENCES public.script_audits(id) ON DELETE SET NULL,
  statement_id uuid REFERENCES public.script_statements(id) ON DELETE SET NULL,
  research_packet_id uuid REFERENCES public.research_packets(id) ON DELETE SET NULL,
  ticker text,
  market text,
  original_statement text NOT NULL,
  duplicate_statements jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_evidence_type text NOT NULL DEFAULT 'OTHER',
  claim_under_investigation text NOT NULL,
  event_date date,
  reason text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'Medium',
  resolution_type text NOT NULL DEFAULT 'RESEARCH_REQUIRED',
  status text NOT NULL DEFAULT 'OPEN',
  classification text,
  gap_key text,
  queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  searches_performed integer NOT NULL DEFAULT 0,
  web_search_calls integer NOT NULL DEFAULT 0,
  ai_calls integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  sources_found integer NOT NULL DEFAULT 0,
  sources_accepted integer NOT NULL DEFAULT 0,
  sources_rejected integer NOT NULL DEFAULT 0,
  resolution_notes text,
  resolved_source_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  resolved_claim_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  resolved_packet_id uuid REFERENCES public.research_packets(id) ON DELETE SET NULL,
  resolved_packet_version integer,
  resolved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.research_gaps TO authenticated;
GRANT ALL ON public.research_gaps TO service_role;
ALTER TABLE public.research_gaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.research_gaps FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER research_gaps_updated BEFORE UPDATE ON public.research_gaps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX research_gaps_script_idx ON public.research_gaps(script_id, created_at DESC);
CREATE INDEX research_gaps_story_idx ON public.research_gaps(story_id, status);

ALTER TABLE public.script_statements ADD COLUMN resolution_type text;