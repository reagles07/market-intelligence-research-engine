-- shared helpers
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- companies
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  exchange TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  sector TEXT,
  industry TEXT,
  market_cap NUMERIC,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT,
  website TEXT,
  ir_url TEXT,
  logo_url TEXT,
  primary_index TEXT,
  peers TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  business_model JSONB NOT NULL DEFAULT '{}'::jsonb,
  moat_categories TEXT[] NOT NULL DEFAULT '{}',
  moat_strength NUMERIC,
  moat_explanation TEXT,
  moat_evidence TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ticker, exchange)
);
CREATE INDEX ON public.companies (country);
CREATE INDEX ON public.companies (sector);
CREATE TRIGGER companies_updated BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- market snapshots
CREATE TABLE public.market_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  price NUMERIC,
  previous_close NUMERIC,
  daily_change_pct NUMERIC,
  volume NUMERIC,
  avg_volume_20d NUMERIC,
  volume_ratio NUMERIC,
  as_of TIMESTAMPTZ NOT NULL DEFAULT now(),
  freshness TEXT NOT NULL DEFAULT 'Unknown',
  source TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT true,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.market_snapshots (company_id, as_of DESC);
CREATE TRIGGER ms_updated BEFORE UPDATE ON public.market_snapshots FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- watchlists
CREATE TABLE public.watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.watchlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id UUID NOT NULL REFERENCES public.watchlists(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  priority TEXT NOT NULL DEFAULT 'Medium',
  notes TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (watchlist_id, company_id)
);

-- stories
CREATE TABLE public.stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  story_type TEXT NOT NULL DEFAULT 'Custom',
  event_at TIMESTAMPTZ,
  price NUMERIC,
  price_at TIMESTAMPTZ,
  daily_change_pct NUMERIC,
  volume_ratio NUMERIC,
  primary_catalyst TEXT,
  content_opportunity_score NUMERIC,
  verification_score NUMERIC,
  priority TEXT NOT NULL DEFAULT 'Medium',
  status TEXT NOT NULL DEFAULT 'New',
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.stories (status);
CREATE INDEX ON public.stories (company_id);
CREATE TRIGGER stories_updated BEFORE UPDATE ON public.stories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- sources
CREATE TABLE public.sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  story_id UUID REFERENCES public.stories(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  url TEXT,
  publisher TEXT,
  source_type TEXT NOT NULL DEFAULT 'News',
  source_tier TEXT NOT NULL DEFAULT 'Tier 2',
  published_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.sources (company_id);
CREATE TRIGGER sources_updated BEFORE UPDATE ON public.sources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- claims
CREATE TABLE public.claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  story_id UUID REFERENCES public.stories(id) ON DELETE CASCADE,
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  claim_text TEXT NOT NULL,
  claim_category TEXT NOT NULL DEFAULT 'FACT',
  value TEXT,
  unit TEXT,
  reporting_period TEXT,
  verification_status TEXT NOT NULL DEFAULT 'Needs Cross-Check',
  confidence NUMERIC,
  is_critical BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.claims (story_id);
CREATE INDEX ON public.claims (verification_status);
CREATE TRIGGER claims_updated BEFORE UPDATE ON public.claims FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- events
CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  story_id UUID REFERENCES public.stories(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'Other',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  description TEXT,
  importance TEXT NOT NULL DEFAULT 'Medium',
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  market_reaction TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.events (company_id, occurred_at DESC);
CREATE TRIGGER events_updated BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- financial periods
CREATE TABLE public.financial_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL DEFAULT 'Quarterly',
  fiscal_year INTEGER NOT NULL,
  fiscal_quarter TEXT,
  period_end DATE,
  basis TEXT NOT NULL DEFAULT 'GAAP',
  consolidation TEXT NOT NULL DEFAULT 'Consolidated',
  currency TEXT NOT NULL DEFAULT 'USD',
  units TEXT NOT NULL DEFAULT 'Millions',
  revenue NUMERIC, gross_profit NUMERIC, operating_income NUMERIC, ebitda NUMERIC,
  net_income NUMERIC, eps_gaap NUMERIC, eps_adjusted NUMERIC,
  operating_cash_flow NUMERIC, capex NUMERIC, free_cash_flow NUMERIC,
  cash NUMERIC, debt NUMERIC, total_assets NUMERIC, total_liabilities NUMERIC,
  shareholder_equity NUMERIC, shares_outstanding NUMERIC, stock_based_comp NUMERIC,
  accounts_receivable NUMERIC, inventory NUMERIC,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.financial_periods (company_id, fiscal_year DESC);
CREATE TRIGGER fp_updated BEFORE UPDATE ON public.financial_periods FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- earnings
CREATE TABLE public.earnings_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  story_id UUID REFERENCES public.stories(id) ON DELETE SET NULL,
  fiscal_quarter TEXT,
  earnings_date DATE,
  revenue_actual NUMERIC, revenue_consensus NUMERIC, revenue_surprise_pct NUMERIC,
  eps_gaap_actual NUMERIC, eps_adjusted_actual NUMERIC, eps_consensus NUMERIC, eps_surprise_pct NUMERIC,
  gross_margin NUMERIC, operating_margin NUMERIC, net_margin NUMERIC, free_cash_flow NUMERIC,
  capex NUMERIC, stock_based_comp NUMERIC,
  guidance_previous TEXT, guidance_new TEXT, guidance_change TEXT, management_commentary TEXT,
  previous_close NUMERIC, opening_price NUMERIC, closing_price NUMERIC, after_hours_price NUMERIC,
  next_day_reaction_pct NUMERIC, move_explanation TEXT, move_causes TEXT[] NOT NULL DEFAULT '{}',
  currency TEXT NOT NULL DEFAULT 'USD', units TEXT NOT NULL DEFAULT 'Millions',
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.earnings_reports (company_id);
CREATE TRIGGER er_updated BEFORE UPDATE ON public.earnings_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- valuations
CREATE TABLE public.valuations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  as_of DATE NOT NULL DEFAULT CURRENT_DATE,
  trailing_pe NUMERIC, forward_pe NUMERIC, price_sales NUMERIC, price_book NUMERIC,
  ev_sales NUMERIC, ev_ebitda NUMERIC, fcf_yield NUMERIC, peg NUMERIC, dividend_yield NUMERIC,
  hist_3y JSONB NOT NULL DEFAULT '{}'::jsonb,
  hist_5y JSONB NOT NULL DEFAULT '{}'::jsonb,
  peer_median JSONB NOT NULL DEFAULT '{}'::jsonb,
  classification TEXT, explanation TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.valuations (company_id, as_of DESC);
CREATE TRIGGER val_updated BEFORE UPDATE ON public.valuations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- technical
CREATE TABLE public.technical_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  as_of DATE NOT NULL DEFAULT CURRENT_DATE,
  ma_20 NUMERIC, ma_50 NUMERIC, ma_200 NUMERIC, rsi NUMERIC, atr NUMERIC,
  current_volume NUMERIC, avg_volume_20d NUMERIC, volume_ratio NUMERIC, relative_strength NUMERIC,
  support_levels NUMERIC[] NOT NULL DEFAULT '{}',
  resistance_levels NUMERIC[] NOT NULL DEFAULT '{}',
  gap_levels NUMERIC[] NOT NULL DEFAULT '{}',
  high_52w NUMERIC, low_52w NUMERIC, trend TEXT, interpretation TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.technical_metrics (company_id, as_of DESC);
CREATE TRIGGER tech_updated BEFORE UPDATE ON public.technical_metrics FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- quantitative
CREATE TABLE public.quantitative_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  as_of DATE NOT NULL DEFAULT CURRENT_DATE,
  return_1d NUMERIC, return_5d NUMERIC, return_1m NUMERIC, return_3m NUMERIC,
  return_ytd NUMERIC, return_1y NUMERIC,
  relative_return_index NUMERIC, relative_return_sector NUMERIC,
  beta NUMERIC, volatility NUMERIC, max_drawdown NUMERIC,
  earnings_surprise NUMERIC, volume_ratio NUMERIC, valuation_percentile NUMERIC,
  historical_earnings_reaction TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.quantitative_metrics (company_id, as_of DESC);
CREATE TRIGGER quant_updated BEFORE UPDATE ON public.quantitative_metrics FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- sentiment
CREATE TABLE public.sentiment_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  story_id UUID REFERENCES public.stories(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'News Sentiment',
  rating TEXT NOT NULL DEFAULT 'Neutral',
  evidence TEXT,
  source_id UUID REFERENCES public.sources(id) ON DELETE SET NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence NUMERIC,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.sentiment_snapshots (company_id);
CREATE TRIGGER sent_updated BEFORE UPDATE ON public.sentiment_snapshots FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- research
CREATE TABLE public.research_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL UNIQUE REFERENCES public.stories(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'In Progress',
  completion_pct NUMERIC NOT NULL DEFAULT 0,
  verification_score NUMERIC NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER rp_updated BEFORE UPDATE ON public.research_packets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.research_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id UUID NOT NULL REFERENCES public.research_packets(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  content TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (packet_id, section_key)
);
CREATE TRIGGER rs_updated BEFORE UPDATE ON public.research_sections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.scenario_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id UUID NOT NULL REFERENCES public.research_packets(id) ON DELETE CASCADE,
  scenario_type TEXT NOT NULL,
  probability NUMERIC NOT NULL DEFAULT 0,
  time_horizon TEXT NOT NULL DEFAULT '6-12 Months',
  assumptions TEXT,
  financial_assumptions TEXT,
  catalysts TEXT,
  risks TEXT,
  valuation_low NUMERIC,
  valuation_high NUMERIC,
  invalidation_conditions TEXT,
  confidence TEXT NOT NULL DEFAULT 'Medium',
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (packet_id, scenario_type)
);
CREATE TRIGGER sf_updated BEFORE UPDATE ON public.scenario_forecasts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- scores
CREATE TABLE public.scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  story_id UUID REFERENCES public.stories(id) ON DELETE CASCADE,
  score_type TEXT NOT NULL,
  total NUMERIC NOT NULL DEFAULT 0,
  components JSONB NOT NULL DEFAULT '{}'::jsonb,
  classification TEXT,
  reasoning TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.scores (story_id, score_type);
CREATE INDEX ON public.scores (company_id, score_type);
CREATE TRIGGER sc_updated BEFORE UPDATE ON public.scores FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- scripts
CREATE TABLE public.scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id UUID REFERENCES public.research_packets(id) ON DELETE SET NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  story_id UUID REFERENCES public.stories(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'English',
  title TEXT,
  body TEXT,
  status TEXT NOT NULL DEFAULT 'Draft',
  is_ai_placeholder BOOLEAN NOT NULL DEFAULT true,
  approved_at TIMESTAMPTZ,
  rejected_reason TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.scripts (story_id);
CREATE INDEX ON public.scripts (status);
CREATE TRIGGER scripts_updated BEFORE UPDATE ON public.scripts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.script_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id UUID NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  body TEXT,
  note TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.script_versions (script_id, version DESC);

-- content
CREATE TABLE public.content_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id UUID REFERENCES public.scripts(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  story_id UUID REFERENCES public.stories(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  content TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER ca_updated BEFORE UPDATE ON public.content_assets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.content_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id UUID REFERENCES public.scripts(id) ON DELETE CASCADE,
  content_asset_id UUID REFERENCES public.content_assets(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'YouTube',
  status TEXT NOT NULL DEFAULT 'Unpublished',
  published_at TIMESTAMPTZ,
  url TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER cp_updated BEFORE UPDATE ON public.content_publications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID DEFAULT auth.uid(),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id UUID,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.audit_logs (created_at DESC);

-- grants + RLS for shared workspace tables
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies','market_snapshots','watchlists','watchlist_items','stories','sources','claims',
    'events','financial_periods','earnings_reports','valuations','technical_metrics',
    'quantitative_metrics','sentiment_snapshots','research_packets','research_sections',
    'scenario_forecasts','scores','scripts','script_versions','content_assets',
    'content_publications','audit_logs'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "authenticated workspace access" ON public.%I FOR ALL TO authenticated USING (false) WITH CHECK (false)', t);
  END LOOP;
END $$;