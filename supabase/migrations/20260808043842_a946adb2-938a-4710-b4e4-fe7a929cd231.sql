CREATE TABLE public.provider_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'IndianAPI',
  endpoint text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status_code integer,
  ok boolean NOT NULL DEFAULT false,
  latency_ms integer,
  error text,
  is_test boolean NOT NULL DEFAULT false,
  ingestion_run_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_requests TO authenticated;
GRANT ALL ON public.provider_requests TO service_role;
ALTER TABLE public.provider_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.provider_requests FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE INDEX provider_requests_created_at_idx ON public.provider_requests (created_at DESC);

CREATE TABLE public.provider_raw_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'IndianAPI',
  endpoint text NOT NULL,
  query text,
  label text NOT NULL DEFAULT 'RAW_PROVIDER_DATA',
  payload jsonb NOT NULL,
  ingestion_run_id uuid,
  request_id uuid REFERENCES public.provider_requests(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_raw_responses TO authenticated;
GRANT ALL ON public.provider_raw_responses TO service_role;
ALTER TABLE public.provider_raw_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.provider_raw_responses FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TABLE public.provider_stock_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'IndianAPI',
  endpoint text NOT NULL,
  company_searched text NOT NULL,
  data_mode text NOT NULL DEFAULT 'LIVE_PROVIDER',
  mapped jsonb NOT NULL DEFAULT '{}'::jsonb,
  unmapped jsonb NOT NULL DEFAULT '{}'::jsonb,
  currency text NOT NULL DEFAULT 'INR',
  source_identifier text,
  provider_timestamp timestamptz,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  ingestion_run_id uuid,
  raw_response_id uuid REFERENCES public.provider_raw_responses(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_stock_data TO authenticated;
GRANT ALL ON public.provider_stock_data TO service_role;
ALTER TABLE public.provider_stock_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.provider_stock_data FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER provider_stock_data_updated BEFORE UPDATE ON public.provider_stock_data FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.provider_data_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'IndianAPI',
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  entity text NOT NULL,
  entity_id uuid,
  field text NOT NULL,
  existing_value text,
  incoming_value text,
  resolution text NOT NULL DEFAULT 'Unresolved',
  ingestion_run_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_data_conflicts TO authenticated;
GRANT ALL ON public.provider_data_conflicts TO service_role;
ALTER TABLE public.provider_data_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.provider_data_conflicts FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER provider_data_conflicts_updated BEFORE UPDATE ON public.provider_data_conflicts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS data_mode text NOT NULL DEFAULT 'MANUAL';
ALTER TABLE public.market_snapshots ADD COLUMN IF NOT EXISTS data_mode text NOT NULL DEFAULT 'MANUAL';
ALTER TABLE public.market_snapshots ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE public.market_snapshots ADD COLUMN IF NOT EXISTS ingestion_run_id uuid;