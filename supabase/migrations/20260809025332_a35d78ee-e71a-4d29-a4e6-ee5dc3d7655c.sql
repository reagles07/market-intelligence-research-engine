-- ============================================================ automation settings
CREATE TABLE public.automation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true,
  automation_enabled boolean NOT NULL DEFAULT false,
  dry_run boolean NOT NULL DEFAULT true,
  india_enabled boolean NOT NULL DEFAULT true,
  us_enabled boolean NOT NULL DEFAULT true,
  max_retries integer NOT NULL DEFAULT 1,
  catchup_window_minutes integer NOT NULL DEFAULT 180,
  stuck_after_minutes integer NOT NULL DEFAULT 30,
  lock_ttl_minutes integer NOT NULL DEFAULT 20,
  ai_daily_cost_cap_usd numeric NOT NULL DEFAULT 2.00,
  ai_monthly_cost_cap_usd numeric NOT NULL DEFAULT 25.00,
  daily_web_search_cap integer NOT NULL DEFAULT 12,
  indianapi_monthly_reserve integer NOT NULL DEFAULT 50,
  high_priority_delta_threshold numeric NOT NULL DEFAULT 80,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX automation_settings_singleton ON public.automation_settings (singleton);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_settings TO authenticated;
GRANT ALL ON public.automation_settings TO service_role;
ALTER TABLE public.automation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.automation_settings
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER automation_settings_updated BEFORE UPDATE ON public.automation_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================ market schedules
CREATE TABLE public.market_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market text NOT NULL,
  timezone text NOT NULL,
  market_close_local time NOT NULL,
  main_run_local time NOT NULL,
  delta_run_local time NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  skip_weekends boolean NOT NULL DEFAULT true,
  honor_holidays boolean NOT NULL DEFAULT true,
  main_max_provider_requests integer NOT NULL DEFAULT 7,
  main_max_web_searches integer NOT NULL DEFAULT 4,
  main_max_eval_candidates integer NOT NULL DEFAULT 10,
  delta_max_provider_requests integer NOT NULL DEFAULT 3,
  delta_max_web_searches integer NOT NULL DEFAULT 2,
  delta_max_eval_candidates integer NOT NULL DEFAULT 5,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX market_schedules_market ON public.market_schedules (market);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_schedules TO authenticated;
GRANT ALL ON public.market_schedules TO service_role;
ALTER TABLE public.market_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.market_schedules
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER market_schedules_updated BEFORE UPDATE ON public.market_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================ market holidays
CREATE TABLE public.market_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market text NOT NULL,
  holiday_date date NOT NULL,
  holiday_name text NOT NULL,
  market_closed boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'MANUAL',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX market_holidays_market_date ON public.market_holidays (market, holiday_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.market_holidays TO authenticated;
GRANT ALL ON public.market_holidays TO service_role;
ALTER TABLE public.market_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.market_holidays
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER market_holidays_updated BEFORE UPDATE ON public.market_holidays
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================ daily market runs
CREATE TABLE public.daily_market_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market text NOT NULL,
  market_date date NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED',
  main_run_status text,
  delta_run_status text,
  market_open_decision text,
  started_at timestamptz,
  completed_at timestamptz,
  raw_signal_count integer NOT NULL DEFAULT 0,
  candidate_count integer NOT NULL DEFAULT 0,
  shortlisted_count integer NOT NULL DEFAULT 0,
  top_score numeric,
  provider_calls integer NOT NULL DEFAULT 0,
  web_searches integer NOT NULL DEFAULT 0,
  ai_calls integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX daily_market_runs_identity ON public.daily_market_runs (market, market_date);
CREATE INDEX daily_market_runs_date_idx ON public.daily_market_runs (market_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_market_runs TO authenticated;
GRANT ALL ON public.daily_market_runs TO service_role;
ALTER TABLE public.daily_market_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.daily_market_runs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER daily_market_runs_updated BEFORE UPDATE ON public.daily_market_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================ executions
CREATE TABLE public.daily_run_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_run_id uuid NOT NULL REFERENCES public.daily_market_runs(id) ON DELETE CASCADE,
  market text NOT NULL,
  market_date date NOT NULL,
  execution_type text NOT NULL,
  execution_key text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  trigger text NOT NULL DEFAULT 'MANUAL',
  status text NOT NULL DEFAULT 'SCHEDULED',
  dry_run boolean NOT NULL DEFAULT false,
  skip_reason text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  discovery_run_id uuid REFERENCES public.discovery_runs(id) ON DELETE SET NULL,
  baseline_execution_id uuid,
  provider_calls integer NOT NULL DEFAULT 0,
  web_searches integer NOT NULL DEFAULT 0,
  ai_calls integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  raw_signal_count integer NOT NULL DEFAULT 0,
  new_candidates integer NOT NULL DEFAULT 0,
  updated_candidates integer NOT NULL DEFAULT 0,
  unchanged_candidates integer NOT NULL DEFAULT 0,
  duplicate_candidates integer NOT NULL DEFAULT 0,
  high_priority_candidates integer NOT NULL DEFAULT 0,
  top_score numeric,
  cancel_requested boolean NOT NULL DEFAULT false,
  heartbeat_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error text,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX daily_run_executions_run_idx ON public.daily_run_executions (daily_run_id, started_at DESC);
CREATE INDEX daily_run_executions_key_idx ON public.daily_run_executions (execution_key, started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_run_executions TO authenticated;
GRANT ALL ON public.daily_run_executions TO service_role;
ALTER TABLE public.daily_run_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.daily_run_executions
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER daily_run_executions_updated BEFORE UPDATE ON public.daily_run_executions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================ run locks
CREATE TABLE public.run_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lock_key text NOT NULL,
  owner text NOT NULL,
  execution_id uuid,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX run_locks_key ON public.run_locks (lock_key);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.run_locks TO authenticated;
GRANT ALL ON public.run_locks TO service_role;
ALTER TABLE public.run_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.run_locks
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ============================================================ notifications
CREATE TABLE public.run_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'INFO',
  title text NOT NULL,
  body text,
  market text,
  daily_run_id uuid REFERENCES public.daily_market_runs(id) ON DELETE CASCADE,
  execution_id uuid REFERENCES public.daily_run_executions(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES public.story_candidates(id) ON DELETE SET NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX run_notifications_created_idx ON public.run_notifications (created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.run_notifications TO authenticated;
GRANT ALL ON public.run_notifications TO service_role;
ALTER TABLE public.run_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated workspace access" ON public.run_notifications
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ============================================================ defaults
INSERT INTO public.automation_settings (singleton) VALUES (true);

INSERT INTO public.market_schedules
  (market, timezone, market_close_local, main_run_local, delta_run_local,
   main_max_provider_requests, main_max_web_searches, main_max_eval_candidates,
   delta_max_provider_requests, delta_max_web_searches, delta_max_eval_candidates)
VALUES
  ('India', 'Asia/Kolkata', '15:30', '18:30', '21:30', 7, 0, 10, 3, 0, 5),
  ('US', 'America/New_York', '16:00', '19:00', '20:15', 0, 4, 10, 0, 2, 5);