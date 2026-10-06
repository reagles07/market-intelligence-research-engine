ALTER TABLE public.claims
  ADD COLUMN IF NOT EXISTS evidence_type text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS evidence_metric_keys text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS financial_period_id uuid REFERENCES public.financial_periods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sec_fact_id uuid REFERENCES public.sec_facts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sec_filing_id uuid REFERENCES public.sec_filings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evidence_provider text,
  ADD COLUMN IF NOT EXISTS evidence_accession text,
  ADD COLUMN IF NOT EXISTS evidence_period text,
  ADD COLUMN IF NOT EXISTS evidence_detail jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS claims_evidence_type_idx ON public.claims (evidence_type);

ALTER TABLE public.sec_filings
  ADD COLUMN IF NOT EXISTS filing_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS items_extracted_at timestamptz;