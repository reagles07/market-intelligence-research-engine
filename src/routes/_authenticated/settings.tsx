import { reportAsyncError } from "@/lib/async-errors";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Disclaimer, SectionTitle } from "@/components/common/ui-bits";
import { IndianApiPanel } from "@/components/providers/IndianApiPanel";
import { OpenAiPanel } from "@/components/providers/OpenAiPanel";
import { SecEdgarPanel } from "@/components/providers/SecEdgarPanel";
import { AutomationSettingsPanel } from "@/components/schedule/AutomationSettingsPanel";
import { useMarket } from "@/lib/market-context-value";
import { LANGUAGES, MARKETS } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Stock Research Studio" },
      {
        name: "description",
        content:
          "Profile, default market, default script language and data-provider status for Stock Research Studio.",
      },
      { property: "og:title", content: "Settings" },
      {
        property: "og:description",
        content: "Profile, market defaults and data-provider status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

const PROVIDERS = [
  { name: "Market data", detail: "Prices, volume, snapshots" },
  { name: "Financial statements", detail: "Income statement, balance sheet, cash flow" },
  { name: "News & filings", detail: "Headlines, filings, transcripts" },
  { name: "AI analysis", detail: "Summaries, scenarios, script drafting" },
];

function SettingsPage() {
  const qc = useQueryClient();
  const { market, setMarket } = useMarket();
  const [displayName, setDisplayName] = useState("");
  const [language, setLanguage] = useState<string>(
    () => globalThis.localStorage?.getItem("srs:language") ?? "Tanglish",
  );

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("id,email,display_name")
        .eq("id", auth.user.id)
        .maybeSingle();
      return data ?? { id: auth.user.id, email: auth.user.email ?? "", display_name: null };
    },
  });

  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name);
  }, [profile?.display_name]);

  const save = useMutation({
    mutationFn: async () => {
      if (!profile?.id) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: displayName || null })
        .eq("id", profile.id);
      if (error) throw error;
      globalThis.localStorage?.setItem("srs:language", language);
    },
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["profile"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Profile and workspace defaults.</p>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <SectionTitle title="Profile" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={profile?.email ?? ""} readOnly disabled />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="display_name">Display name</Label>
            <Input
              id="display_name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <SectionTitle title="Defaults" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Default market</Label>
            <select
              value={market}
              onChange={(e) => setMarket(e.target.value as typeof market)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="All">All</option>
              {MARKETS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Default script language</Label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
        </div>
        <Button className="mt-4" size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </section>

      <AutomationSettingsPanel />

      <OpenAiPanel />

      <IndianApiPanel />

      <SecEdgarPanel />

      <section className="rounded-xl border border-border bg-card p-4">
        <SectionTitle
          title="Data providers"
          description="Phase 1 runs on manual entry and demo data. Provider interfaces are vendor-neutral so live feeds can be connected later without changing the research model."
        />
        <div className="space-y-2">
          {PROVIDERS.map((p) => (
            <div
              key={p.name}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.detail}</p>
              </div>
              <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium">
                Not connected
              </span>
            </div>
          ))}
        </div>
      </section>

      <Disclaimer />
    </div>
  );
}
