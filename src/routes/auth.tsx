import { reportAsyncError } from "@/lib/async-errors";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Stock Research Studio" },
      {
        name: "description",
        content:
          "Sign in to Stock Research Studio, the research and content-production workspace for US and Indian equities.",
      },
      { property: "og:title", content: "Sign in — Stock Research Studio" },
      {
        property: "og:description",
        content: "Research workspace for US and Indian equity stories and video scripts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (data.session) {
          const { data: owner, error } = await supabase.rpc("is_installation_owner");
          if (!error && owner === true) return navigate({ to: "/dashboard", replace: true });
        }
        return undefined;
      })
      .catch((error: unknown) => reportAsyncError(error, "navigation"));
  }, [navigate]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const { data: owner, error: authorizationError } = await supabase.rpc("is_installation_owner");
    if (authorizationError || owner !== true) {
      await supabase.auth.signOut();
      toast.error("This account is not the provisioned installation owner.");
      return;
    }
    navigate({ to: "/dashboard", replace: true }).catch((error: unknown) =>
      reportAsyncError(error, "navigation"),
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            SR
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Stock Research Studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Research and content production for US &amp; India equities.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            Sign in with the provisioned installation owner account.
          </p>
          <form
            onSubmit={(e) => {
              signIn(e).catch((error: unknown) => {
                setBusy(false);
                reportAsyncError(error, "sign in");
              });
            }}
            className="space-y-3 pt-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="si-email">Email</Label>
              <Input
                id="si-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="si-pw">Password</Label>
              <Input
                id="si-pw"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
