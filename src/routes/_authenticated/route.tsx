import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { MarketProvider } from "@/lib/market-context";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const { data: owner, error: authorizationError } = await supabase.rpc("is_installation_owner");
    if (authorizationError || owner !== true) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => (
    <MarketProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </MarketProvider>
  ),
});
