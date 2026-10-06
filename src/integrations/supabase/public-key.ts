/** Public clients must never accept a service-role or opaque secret API key. */
export function assertPublishableKey(key: string): void {
  if (key.startsWith("sb_publishable_")) return;
  if (key.startsWith("sb_secret_"))
    throw new Error("A secret API key cannot be used by a public client");
  try {
    const payload = key.split(".")[1];
    if (!payload) throw new Error("Missing JWT payload");
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (
      typeof claims !== "object" ||
      claims === null ||
      !("role" in claims) ||
      claims.role !== "anon"
    ) {
      throw new Error("Expected anon role");
    }
  } catch {
    throw new Error("Public clients require a publishable key or legacy anon key");
  }
}

/** Build-time defense: reject credentials before Vite can inline public environment values. */
export function assertPublicEnvironment(env: Record<string, string | undefined>): void {
  const publicKey = env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (publicKey) assertPublishableKey(publicKey);
  for (const [name, value] of Object.entries(env)) {
    if (value && /^VITE_.*(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN)/i.test(name)) {
      throw new Error(`Private credential ${name} must not be exposed through Vite`);
    }
  }
}
