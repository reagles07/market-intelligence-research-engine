-- Optional synthetic business fixture, for a provisioned development installation only.
-- No Auth accounts, credentials, user UUIDs or production data are included.
-- Execute as the database owner or a trusted service role after private.provision_owner().
BEGIN;
DO $$ BEGIN
  IF private.owner_id() IS NULL THEN
    RAISE EXCEPTION 'Provision a development installation owner before loading synthetic fixtures';
  END IF;
END $$;
INSERT INTO public.companies(ticker,exchange,name,country,currency,is_demo,description)
VALUES ('SYNTH-DEMO','SYNTHETIC','Synthetic Research Example','US','USD',true,
        'Invented company for local authorization and research demonstrations; no real market data.')
ON CONFLICT(ticker,exchange) DO NOTHING;
INSERT INTO public.watchlists(name,description)
SELECT 'Synthetic demo watchlist','Development fixture only'
WHERE NOT EXISTS (SELECT 1 FROM public.watchlists WHERE name='Synthetic demo watchlist');
INSERT INTO public.watchlist_items(watchlist_id,company_id,notes)
SELECT w.id,c.id,'Synthetic data; not investment research'
FROM public.watchlists w CROSS JOIN public.companies c
WHERE w.name='Synthetic demo watchlist' AND c.ticker='SYNTH-DEMO' AND c.exchange='SYNTHETIC'
ON CONFLICT(watchlist_id,company_id) DO NOTHING;
COMMIT;
