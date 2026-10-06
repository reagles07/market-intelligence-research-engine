-- Phase 1.3E: production hardening of the script pipeline

-- 1. Audits become a two-pass ledger (initial vs final) and carry the
--    deterministic numeric pre-check plus the readiness gate result.
ALTER TABLE public.script_audits
  ADD COLUMN IF NOT EXISTS audit_pass text NOT NULL DEFAULT 'initial',
  ADD COLUMN IF NOT EXISTS repair_id uuid,
  ADD COLUMN IF NOT EXISTS numeric_precheck jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS numeric_precheck_blocking integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS readiness_gate jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ready_for_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS word_count integer,
  ADD COLUMN IF NOT EXISTS within_word_budget boolean;

ALTER TABLE public.script_audits
  DROP CONSTRAINT IF EXISTS script_audits_audit_pass_check;
ALTER TABLE public.script_audits
  ADD CONSTRAINT script_audits_audit_pass_check
  CHECK (audit_pass IN ('initial','final','manual'));

-- 2. Statements record whether they came from the deterministic pre-check or
--    the AI auditor.
ALTER TABLE public.script_statements
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'ai',
  ADD COLUMN IF NOT EXISTS precheck_kind text;

ALTER TABLE public.script_statements
  DROP CONSTRAINT IF EXISTS script_statements_origin_check;
ALTER TABLE public.script_statements
  ADD CONSTRAINT script_statements_origin_check CHECK (origin IN ('ai','precheck'));

-- 3. One evidence-constrained repair between the two audits.
CREATE TABLE IF NOT EXISTS public.script_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  script_version integer,
  packet_id uuid REFERENCES public.research_packets(id) ON DELETE SET NULL,
  packet_version integer,
  initial_audit_id uuid REFERENCES public.script_audits(id) ON DELETE SET NULL,
  final_audit_id uuid REFERENCES public.script_audits(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'Applied',
  items_total integer NOT NULL DEFAULT 0,
  removed integer NOT NULL DEFAULT 0,
  corrected integer NOT NULL DEFAULT 0,
  attributed integer NOT NULL DEFAULT 0,
  qualified integer NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  model text,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.script_repairs TO authenticated;
GRANT ALL ON public.script_repairs TO service_role;
ALTER TABLE public.script_repairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users manage script repairs"
  ON public.script_repairs FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
CREATE TRIGGER script_repairs_updated BEFORE UPDATE ON public.script_repairs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS script_repairs_script_idx ON public.script_repairs(script_id);

-- 4. Advisory style-quality checks (never block a factually valid script).
CREATE TABLE IF NOT EXISTS public.script_style_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  script_version integer,
  style_profile_id uuid REFERENCES public.script_style_profiles(id) ON DELETE SET NULL,
  style_profile_version integer,
  status text NOT NULL DEFAULT 'PASS',
  warnings_total integer NOT NULL DEFAULT 0,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.script_style_checks TO authenticated;
GRANT ALL ON public.script_style_checks TO service_role;
ALTER TABLE public.script_style_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users manage script style checks"
  ON public.script_style_checks FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
CREATE TRIGGER script_style_checks_updated BEFORE UPDATE ON public.script_style_checks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS script_style_checks_script_idx ON public.script_style_checks(script_id);

ALTER TABLE public.script_style_checks
  DROP CONSTRAINT IF EXISTS script_style_checks_status_check;
ALTER TABLE public.script_style_checks
  ADD CONSTRAINT script_style_checks_status_check CHECK (status IN ('PASS','WARNING'));

-- 5. Scripts track the content fingerprint (to detect human factual edits) and
--    the audit that currently governs their status.
ALTER TABLE public.scripts
  ADD COLUMN IF NOT EXISTS body_hash text,
  ADD COLUMN IF NOT EXISTS audited_body_hash text,
  ADD COLUMN IF NOT EXISTS last_audit_id uuid,
  ADD COLUMN IF NOT EXISTS last_repair_id uuid,
  ADD COLUMN IF NOT EXISTS style_quality_status text,
  ADD COLUMN IF NOT EXISTS ready_for_review boolean NOT NULL DEFAULT false;