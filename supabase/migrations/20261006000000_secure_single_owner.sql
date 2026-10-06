-- Secure single-user installation. Apply only to a fresh, empty Auth project.
-- Existing deployments require a separate reviewed export/import; never claim old shared rows.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.users) THEN
    RAISE EXCEPTION 'Authorization migration requires a fresh Auth project; existing data must be reviewed separately';
  END IF;
END $$;
DO $$ DECLARE r record; n bigint; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND tablename NOT IN ('script_style_profiles','sec_ticker_cik','automation_settings','market_schedules','research_orchestration_settings','discovery_settings','universe_members')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I',r.tablename) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'Fresh installation required: % contains existing records',r.tablename; END IF;
  END LOOP;
END $$;
CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
CREATE TABLE private.installation_owner (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT
);
REVOKE ALL ON private.installation_owner FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.is_installation_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM private.installation_owner WHERE user_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.is_installation_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_installation_owner() TO authenticated;

CREATE FUNCTION private.owner_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT user_id FROM private.installation_owner WHERE singleton
$$;
REVOKE ALL ON FUNCTION private.owner_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.owner_id() TO authenticated, service_role;

-- Also constrains service-role writes: a privileged worker cannot create a second tenant.
CREATE FUNCTION private.enforce_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE expected uuid := private.owner_id();
BEGIN
  IF expected IS NULL OR NEW.user_id IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'A provisioned installation owner is required' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Ownership is immutable' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'profiles' AND NEW.id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'Profile identity must equal ownership' USING ERRCODE = '42501';
  END IF;
  IF to_jsonb(NEW) ? 'created_by' THEN
    IF to_jsonb(NEW)->>'created_by' IS NOT NULL AND (to_jsonb(NEW)->>'created_by')::uuid <> expected THEN
      RAISE EXCEPTION 'Record attribution must match the installation owner' USING ERRCODE = '42501';
    END IF;
    NEW := jsonb_populate_record(NEW, jsonb_build_object('created_by',expected));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enforce_owner() FROM PUBLIC, anon, authenticated, service_role;

-- Auth may provision accounts, but that never grants application access.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT t.tgname FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='auth.users'::regclass AND p.proname='handle_new_user'
  LOOP EXECUTE format('DROP TRIGGER %I ON auth.users',r.tgname); END LOOP;
END $$;
DROP FUNCTION public.handle_new_user();
DO $$ DECLARE t text; r record; BEGIN
  FOREACH t IN ARRAY ARRAY['ai_requests', 'analyst_views', 'audit_logs', 'automation_pipeline_items', 'automation_pipeline_runs', 'automation_settings', 'candidate_score_components', 'candidate_sources', 'claims', 'companies', 'content_assets', 'content_composition_companies', 'content_compositions', 'content_orchestration_runs', 'content_orchestration_steps', 'content_publications', 'daily_market_runs', 'daily_run_executions', 'discovery_runs', 'discovery_settings', 'earnings_reports', 'events', 'fact_sprint_runs', 'financial_periods', 'market_holidays', 'market_schedules', 'market_snapshots', 'profiles', 'provider_data_conflicts', 'provider_raw_responses', 'provider_requests', 'provider_stock_data', 'quantitative_metrics', 'research_gaps', 'research_orchestration_runs', 'research_orchestration_settings', 'research_orchestration_steps', 'research_packets', 'research_sections', 'run_locks', 'run_notifications', 'scenario_forecasts', 'scores', 'script_audits', 'script_repairs', 'script_sections', 'script_statements', 'script_style_checks', 'script_style_profiles', 'script_versions', 'scripts', 'sec_facts', 'sec_filings', 'sec_ticker_cik', 'sentiment_snapshots', 'sources', 'stories', 'story_candidates', 'technical_metrics', 'universe_members', 'valuations', 'watchlist_items', 'watchlists', 'web_research_runs'] LOOP
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',r.policyname,t);
    END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    IF t = ANY(ARRAY['script_style_profiles', 'sec_ticker_cik']) THEN
      EXECUTE format('CREATE POLICY reference_read ON public.%I FOR SELECT TO authenticated USING (public.is_installation_owner())',t);
    ELSE
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS user_id uuid',t);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id SET DEFAULT private.owner_id()',t);
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT installation_owner_fk FOREIGN KEY(user_id) REFERENCES private.installation_owner(user_id)',t);
      -- Null is allowed only for the migration-provided initial configuration before provisioning.
      EXECUTE format('CREATE TRIGGER enforce_installation_owner BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.enforce_owner()',t);
      EXECUTE format('CREATE INDEX ON public.%I (user_id)',t);
      EXECUTE format('CREATE POLICY owner_read ON public.%I FOR SELECT TO authenticated USING (public.is_installation_owner() AND user_id = auth.uid())',t);
      IF t = ANY(ARRAY['analyst_views', 'automation_settings', 'claims', 'companies', 'content_assets', 'content_composition_companies', 'content_compositions', 'content_publications', 'discovery_settings', 'earnings_reports', 'events', 'financial_periods', 'market_holidays', 'market_schedules', 'market_snapshots', 'profiles', 'quantitative_metrics', 'research_gaps', 'research_orchestration_settings', 'research_packets', 'research_sections', 'scenario_forecasts', 'scores', 'script_sections', 'script_versions', 'scripts', 'sec_facts', 'sec_filings', 'sentiment_snapshots', 'sources', 'stories', 'story_candidates', 'technical_metrics', 'universe_members', 'valuations', 'watchlist_items', 'watchlists']) THEN
        EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO authenticated',t);
        EXECUTE format('CREATE POLICY owner_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_installation_owner() AND user_id = auth.uid())',t);
        EXECUTE format('CREATE POLICY owner_update ON public.%I FOR UPDATE TO authenticated USING (public.is_installation_owner() AND user_id = auth.uid()) WITH CHECK (public.is_installation_owner() AND user_id = auth.uid())',t);
        EXECUTE format('CREATE POLICY owner_delete ON public.%I FOR DELETE TO authenticated USING (public.is_installation_owner() AND user_id = auth.uid())',t);
      END IF;
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role',t);
  END LOOP;
END $$;

-- Provision once, through the database owner connection only (not PostgREST/service_role).
CREATE FUNCTION private.provision_owner(owner_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t text;
BEGIN
  INSERT INTO private.installation_owner(user_id) VALUES (owner_user_id);
  FOR t IN SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='user_id'
  LOOP
    EXECUTE format('UPDATE public.%I SET user_id=$1 WHERE user_id IS NULL',t) USING owner_user_id;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id SET NOT NULL',t);
  END LOOP;
  INSERT INTO public.profiles(id,user_id,email,display_name)
    SELECT id,id,email,coalesce(raw_user_meta_data->>'display_name','Owner') FROM auth.users WHERE id=owner_user_id;
END $$;
REVOKE ALL ON FUNCTION private.provision_owner(uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
