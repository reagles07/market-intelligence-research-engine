import { reportAsyncError } from "@/lib/async-errors";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Globe2,
  Building2,
  FlaskConical,
  FileText,
  Star,
  Settings as SettingsIcon,
  Search,
  Bell,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMarket, type MarketFilter } from "@/lib/market-context-value";
import { FreshnessBadge } from "@/components/common/ui-bits";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Creator-oriented primary navigation. Operational/debug surfaces
 * (Discovery, Daily Runs, Candidates history, Story Queue, Sources,
 * providers, automation, settings) live under Admin.
 */
const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/market", label: "Market Intelligence", icon: Globe2 },
  { to: "/research", label: "Research", icon: FlaskConical },
  { to: "/stocks", label: "Stocks", icon: Building2 },
  { to: "/scripts", label: "Scripts", icon: FileText },
  { to: "/watchlists", label: "Watchlists", icon: Star },
  { to: "/admin", label: "Admin", icon: SettingsIcon },
] as const;

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ["global-search", q],
    enabled: q.trim().length > 0,
    queryFn: async () => {
      const term = `%${q.trim()}%`;
      const { data, error } = await supabase
        .from("companies")
        .select("id,name,ticker,exchange,country")
        .or(`name.ilike.${term},ticker.ilike.${term}`)
        .limit(8);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search tracked company or ticker…"
        className="h-9 pl-8"
        aria-label="Search tracked companies"
        title="Searches companies already tracked in this studio, not the whole market."
      />
      {open && q.trim() && data && data.length > 0 ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-md">
          {data.map((c) => (
            <button
              key={c.id}
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
              onMouseDown={() => {
                setQ("");
                setOpen(false);
                navigate({ to: "/stocks/$id", params: { id: c.id } }).catch((error: unknown) =>
                  reportAsyncError(error, "navigation"),
                );
              }}
            >
              <span className="truncate">{c.name}</span>
              <span className="ml-2 shrink-0 font-mono text-xs text-muted-foreground">
                {c.ticker} · {c.exchange}
              </span>
            </button>
          ))}
          <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            Tracked companies only — this does not search the whole market.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { market, setMarket } = useMarket();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => setMobileOpen(false), [pathname]);

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

  const { data: needsAttention } = useQuery({
    queryKey: ["notifications-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("claims")
        .select("id", { count: "exact", head: true })
        .in("verification_status", ["Conflicting", "Unsupported"]);
      return count ?? 0;
    },
  });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    navigate({ to: "/auth", replace: true }).catch((error: unknown) =>
      reportAsyncError(error, "navigation"),
    );
  }

  const sidebar = (
    <nav className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          SR
        </div>
        <span className="text-sm font-semibold tracking-tight">Stock Research Studio</span>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV.map((item) => {
          const active =
            pathname === item.to || (item.to !== "/dashboard" && pathname.startsWith(item.to));
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className="border-t border-border p-3 text-[11px] leading-relaxed text-muted-foreground">
        Research with evidence first — scripts are drafted only from verified research. Automation
        stays off unless you enable it in Settings.
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen w-full bg-background">
      <div className="hidden md:block">{sidebar}</div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="h-full">{sidebar}</div>
          <button
            type="button"
            aria-label="Close navigation"
            className="flex-1 bg-foreground/20"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-card/95 px-3 backdrop-blur md:px-5">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle navigation"
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>

          <GlobalSearch />

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center rounded-md border border-border p-0.5 sm:flex">
              {(["All", "US", "India"] as MarketFilter[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMarket(m)}
                  className={cn(
                    "rounded px-2 py-1 text-xs font-medium transition-colors",
                    market === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="hidden items-center gap-1.5 lg:flex">
              <span className="text-xs text-muted-foreground">Data</span>
              <FreshnessBadge freshness="Unknown" />
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
                  <Bell className="h-4 w-4" />
                  {needsAttention ? (
                    <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                      {needsAttention}
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Attention required</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/sources">
                    {needsAttention
                      ? `${needsAttention} claim(s) conflicting or unsupported`
                      : "No claims need attention"}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold">
                    {(profile?.display_name ?? profile?.email ?? "?").slice(0, 2).toUpperCase()}
                  </span>
                  <span className="hidden max-w-28 truncate text-xs sm:inline">
                    {profile?.display_name ?? profile?.email ?? "Account"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {profile?.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/settings">Profile & settings</Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    signOut().catch((error: unknown) => reportAsyncError(error, "sign out"));
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
