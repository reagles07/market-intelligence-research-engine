ALTER TABLE public.research_packets DROP CONSTRAINT IF EXISTS research_packets_story_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS research_packets_story_version_uidx
  ON public.research_packets (story_id, version_number);