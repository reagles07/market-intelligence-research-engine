ALTER TABLE public.daily_run_executions
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS triggered_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lateness_minutes integer;