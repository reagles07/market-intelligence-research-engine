import { reportAsyncError } from "@/lib/async-errors";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Radar,
  CalendarClock,
  Sparkles,
  ListChecks,
  ShieldCheck,
  Library,
  Settings as SettingsIcon,
  Link2,
  ChevronRight,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/common/ui-bits";
import { getAutomationConfig } from "@/lib/schedule.functions";
import { linkUniverseCompanies } from "@/lib/universe.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Stock Research Studio" },
      {
        name: "description",
        content:
          "Operational controls and diagnostics: discovery, runs, candidates history, sources, providers, automation and universe maintenance.",
      },
      { property: "og:title", content: "Admin" },
      { property: "og:description", content: "Operational controls and diagnostics." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

const SECTIONS = [
  {
    title: "Operations",
    items: [
      {
        to: "/discovery",
        label: "Discovery",
        description: "Provider signals, clustering and scoring runs for US and India.",
        icon: Radar,
      },
      {
        to: "/runs",
        label: "Daily Runs",
        description: "Scheduled execution history, step outcomes and controller state.",
        icon: CalendarClock,
      },
      {
        to: "/candidates",
        label: "Candidates",
        description: "Candidate history, scoring breakdowns and promote/dismiss diagnostics.",
        icon: Sparkles,
      },
      {
        to: "/stories",
        label: "Story Queue",
        description: "Full operational story table with filters and manual story creation.",
        icon: ListChecks,
      },
      {
        to: "/sources",
        label: "Sources & Verification",
        description: "Evidence registry, claim verification and conflict resolution.",
        icon: ShieldCheck,
      },
      {
        to: "/library",
        label: "Content Library",
        description: "Published assets and supporting-content records.",
        icon: Library,
      },
    ],
  },
  {
    title: "System",
    items: [
      {
        to: "/settings",
        label: "Settings, providers & automation",
        description:
          "Profile, provider status and quota (IndianAPI, SEC EDGAR, AI), scheduler and automation controls.",
        icon: SettingsIcon,
      },
    ],
  },
] as const;

function UniverseMaintenance() {
  const qc = useQueryClient();
  const link = useServerFn(linkUniverseCompanies);
  const linkMutation = useMutation({
    mutationFn: () => link({ data: { createMissing: true } }),
    onSuccess: (res) => {
      toast.success(
        `${res.linked} universe entries linked (${res.created} minimal identities created). ` +
          `${res.after.linked}/${res.after.total} now linked.`,
      );
      if (res.unresolved.length) toast.warning(`${res.unresolved.length} still unresolved.`);
      qc.invalidateQueries({ queryKey: ["universe"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["universe-coverage"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Universe maintenance</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Attach Core 50 / Discovery Trending 50 entries to canonical company records using
          alias-aware, market-scoped ticker matching. Where a canonical identity does not exist yet
          it creates an identity-only row (ticker, seeded name, exchange, market, currency, sector).
          It never fabricates price, valuation, fundamentals or provider data.
        </p>

        <Button
          variant="outline"
          size="sm"
          onClick={() => linkMutation.mutate()}
          disabled={linkMutation.isPending}
        >
          <Link2 className="mr-2 h-4 w-4" />
          Link tracked companies
        </Button>
      </CardContent>
    </Card>
  );
}

function AdminPage() {
  const fetchConfig = useServerFn(getAutomationConfig);
  const { data: config } = useQuery({
    queryKey: ["automation-config"],
    queryFn: () => fetchConfig({}),
  });
  const settings = config?.settings;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operational controls and diagnostics. Day-to-day creator work happens on the Dashboard,
          Market Intelligence, Research, Stocks and Scripts pages.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Automation state</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge value={settings?.automation_enabled ? "Automation ON" : "Automation OFF"} />
          <StatusBadge value={settings?.dry_run ? "Dry run ON" : "Dry run OFF"} />
          <span className="text-xs text-muted-foreground">
            Scheduler and autonomous pipeline are controlled in Settings. Nothing here starts a run.
          </span>
          <Button asChild size="sm" variant="ghost" className="ml-auto">
            <Link to="/settings">Open settings</Link>
          </Button>
        </CardContent>
      </Card>

      {SECTIONS.map((section) => (
        <section key={section.title} className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{section.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {section.items.map((item) => (
              <Link key={item.to} to={item.to} className="group">
                <Card className="h-full transition-colors group-hover:border-primary/50">
                  <CardContent className="flex items-start gap-3 p-4">
                    <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <UniverseMaintenance />
    </div>
  );
}
