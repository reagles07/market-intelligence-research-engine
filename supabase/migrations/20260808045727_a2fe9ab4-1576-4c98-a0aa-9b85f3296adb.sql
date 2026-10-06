ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS sec_cik text,
  ADD COLUMN IF NOT EXISTS sec_last_sync timestamptz,
  ADD COLUMN IF NOT EXISTS sec_status text NOT NULL DEFAULT 'Not Synced';

CREATE INDEX IF NOT EXISTS companies_sec_cik_idx ON public.companies (sec_cik);

CREATE TABLE public.sec_ticker_cik (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL UNIQUE,
  cik text NOT NULL,
  title text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sec_ticker_cik TO authenticated;
GRANT ALL ON public.sec_ticker_cik TO service_role;
ALTER TABLE public.sec_ticker_cik ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sec_ticker_cik readable by authenticated"
  ON public.sec_ticker_cik FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE TRIGGER sec_ticker_cik_updated BEFORE UPDATE ON public.sec_ticker_cik
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.sec_filings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  cik text NOT NULL,
  form text NOT NULL,
  filing_date date,
  report_date date,
  accepted_at timestamptz,
  accession_number text NOT NULL,
  primary_document text,
  url text,
  source_id uuid REFERENCES public.sources(id) ON DELETE SET NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  data_mode text NOT NULL DEFAULT 'LIVE_PROVIDER',
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  ingestion_run_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cik, accession_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_filings TO authenticated;
GRANT ALL ON public.sec_filings TO service_role;
ALTER TABLE public.sec_filings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sec_filings authenticated access"
  ON public.sec_filings FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER sec_filings_updated BEFORE UPDATE ON public.sec_filings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS sec_filings_company_form_idx ON public.sec_filings (company_id, form, filing_date DESC);

CREATE TABLE public.sec_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  cik text NOT NULL,
  metric_key text NOT NULL,
  concept text NOT NULL,
  taxonomy text NOT NULL,
  unit text NOT NULL,
  value numeric,
  fiscal_year integer,
  fiscal_period text,
  form text,
  filed date,
  start_date date,
  end_date date,
  frame text,
  accession_number text,
  period_kind text NOT NULL DEFAULT 'Duration',
  mapping_confidence text NOT NULL DEFAULT 'Mapped',
  candidate_concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_mode text NOT NULL DEFAULT 'LIVE_PROVIDER',
  ingestion_run_id uuid,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cik, concept, unit, fiscal_year, fiscal_period, form, start_date, end_date, accession_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sec_facts TO authenticated;
GRANT ALL ON public.sec_facts TO service_role;
ALTER TABLE public.sec_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sec_facts authenticated access"
  ON public.sec_facts FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER sec_facts_updated BEFORE UPDATE ON public.sec_facts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS sec_facts_company_metric_idx ON public.sec_facts (company_id, metric_key, fiscal_year DESC);