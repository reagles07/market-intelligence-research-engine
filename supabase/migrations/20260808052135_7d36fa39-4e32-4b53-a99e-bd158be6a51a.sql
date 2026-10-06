ALTER TABLE public.research_packets
  ADD COLUMN IF NOT EXISTS version_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_packet_id uuid REFERENCES public.research_packets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS update_reason text;

CREATE INDEX IF NOT EXISTS research_packets_parent_idx ON public.research_packets(parent_packet_id);

CREATE TABLE IF NOT EXISTS public.ai_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'OpenAI',
  model text NOT NULL,
  operation text NOT NULL,
  mode text NOT NULL DEFAULT 'DATABASE',
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL,
  packet_id uuid REFERENCES public.research_packets(id) ON DELETE SET NULL,
  script_id uuid REFERENCES public.scripts(id) ON DELETE SET NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  reasoning_tokens integer NOT NULL DEFAULT 0,
  web_search_calls integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric NOT NULL DEFAULT 0,
  latency_ms integer,
  ok boolean NOT NULL DEFAULT false,
  error text,
  validation_retries integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.ai_requests TO authenticated;
GRANT ALL ON public.ai_requests TO service_role;

ALTER TABLE public.ai_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own AI request records"
  ON public.ai_requests FOR SELECT TO authenticated
  USING (auth.uid() = created_by);

CREATE POLICY "Users create their own AI request records"
  ON public.ai_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE INDEX IF NOT EXISTS ai_requests_created_at_idx ON public.ai_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS ai_requests_story_idx ON public.ai_requests(story_id);
CREATE INDEX IF NOT EXISTS ai_requests_script_idx ON public.ai_requests(script_id);