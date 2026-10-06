UPDATE public.claims
SET is_critical = false
WHERE is_critical = true
  AND claim_category = 'UNSUPPORTED'
  AND verification_status = 'Unsupported';