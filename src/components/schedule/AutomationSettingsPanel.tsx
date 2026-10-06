import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SectionTitle } from "@/components/common/ui-bits";
import {
  addMarketHoliday,
  deleteMarketHoliday,
  getAutomationConfig,
  updateAutomationSettings,
  updateMarketSchedule,
} from "@/lib/schedule.functions";
import { SCHEDULE_MARKETS, type ScheduleMarket } from "@/lib/schedule/domain";

const NUMBER_FIELDS: {
  key: keyof import("@/lib/data-types").Row<"automation_settings">;
  label: string;
  hint: string;
}[] = [
  { key: "max_retries", label: "Max retries", hint: "Per failed execution" },
  { key: "catchup_window_minutes", label: "Catch-up window (min)", hint: "Late scheduler ticks" },
  { key: "stuck_after_minutes", label: "Stuck after (min)", hint: "Auto-fail hung runs" },
  { key: "ai_daily_cost_cap_usd", label: "AI daily cap ($)", hint: "Hard stop per day" },
  { key: "ai_monthly_cost_cap_usd", label: "AI monthly cap ($)", hint: "Hard stop per month" },
  { key: "daily_web_search_cap", label: "Web searches / day", hint: "Across all runs" },
  {
    key: "indianapi_monthly_reserve",
    label: "IndianAPI reserve",
    hint: "Requests kept for manual work",
  },
  {
    key: "high_priority_delta_threshold",
    label: "High-priority score",
    hint: "Delta alert threshold",
  },
];

const AUTONOMOUS_FIELDS: {
  key: keyof import("@/lib/data-types").Row<"automation_settings">;
  label: string;
  hint: string;
}[] = [
  {
    key: "autonomous_ai_budget_percent",
    label: "Autonomous AI share (%)",
    hint: "Rest of the daily cap stays for manual work",
  },
  { key: "min_content_score_india", label: "India min score", hint: "Qualification floor" },
  { key: "min_content_score_us", label: "US min score", hint: "Qualification floor" },
  {
    key: "min_score_coverage_india",
    label: "India min coverage (%)",
    hint: "Score data completeness",
  },
  { key: "min_score_coverage_us", label: "US min coverage (%)", hint: "Score data completeness" },
  { key: "max_research_main", label: "Research / main run", hint: "Stories researched per run" },
  { key: "max_content_main", label: "Content / main run", hint: "Scripts written per run" },
  { key: "max_research_delta", label: "Research / delta run", hint: "Late-delta cap" },
  { key: "max_content_delta", label: "Content / delta run", hint: "Late-delta cap" },
  { key: "autonomous_long_min_score", label: "Long-form min score", hint: "Deep dive threshold" },
];

export function AutomationSettingsPanel() {
  const qc = useQueryClient();
  const fetchConfig = useServerFn(getAutomationConfig);
  const saveSettings = useServerFn(updateAutomationSettings);
  const saveSchedule = useServerFn(updateMarketSchedule);
  const addHoliday = useServerFn(addMarketHoliday);
  const removeHoliday = useServerFn(deleteMarketHoliday);
  const { data } = useQuery({ queryKey: ["automation-config"], queryFn: () => fetchConfig() });
  const [holiday, setHoliday] = useState({
    market: "India" as ScheduleMarket,
    holiday_date: "",
    holiday_name: "",
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["automation-config"] });

  const settingsMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => saveSettings({ data: patch }),
    onSuccess: () => {
      toast.success("Automation settings saved");
      return invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const scheduleMut = useMutation({
    mutationFn: (input: { market: ScheduleMarket; patch: Record<string, unknown> }) =>
      saveSchedule({ data: input }),
    onSuccess: () => {
      toast.success("Schedule saved");
      return invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const holidayMut = useMutation({
    mutationFn: () => addHoliday({ data: holiday }),
    onSuccess: () => {
      toast.success("Holiday added");
      setHoliday({ ...holiday, holiday_date: "", holiday_name: "" });
      return invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteHolidayMut = useMutation({
    mutationFn: (id: string) => removeHoliday({ data: { id } }),
    onSuccess: () => {
      toast.success("Holiday removed");
      return invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const settings = data?.settings;
  const schedules = data?.schedules ?? [];
  const holidays = data?.holidays ?? [];

  if (!settings) {
    return (
      <section className="rounded-xl border border-border bg-card p-4">
        <SectionTitle title="Daily automation" />
        <p className="text-sm text-muted-foreground">Loading automation settings…</p>
      </section>
    );
  }

  const toggle = (
    key: keyof import("@/lib/data-types").Row<"automation_settings">,
    label: string,
    hint: string,
  ) => (
    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch
        aria-label={label}
        checked={Boolean(settings[key])}
        onCheckedChange={(v) => settingsMut.mutate({ [key]: v })}
      />
    </div>
  );

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <SectionTitle
        title="Daily automation"
        description="Scheduled runs perform discovery only. Research, scripts and publishing stay manual."
      />

      <div className="grid gap-2 sm:grid-cols-2">
        {toggle("automation_enabled", "Automation enabled", "Master switch for all scheduled runs")}
        {toggle("dry_run", "Global dry run", "Plan and log runs without spending quota")}
        {toggle("india_enabled", "India runs", "NSE/BSE discovery")}
        {toggle("us_enabled", "US runs", "SEC EDGAR + web discovery")}
      </div>

      <div className="mt-6 space-y-3">
        <SectionTitle
          title="Autonomous research + content"
          description="When on, a completed discovery run promotes qualifying candidates, researches them and writes scripts up to the caps below. The end state is always Ready for Review — nothing is published."
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {toggle(
            "autonomous_enabled",
            "Autonomous pipeline",
            "Off by default. Discovery keeps running either way.",
          )}
          {toggle(
            "autonomous_long_enabled",
            "Long-form when warranted",
            "Adds a deep dive for very high scoring stories",
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {AUTONOMOUS_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Input
                id={f.key}
                type="number"
                defaultValue={String(settings[f.key] ?? "")}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v) || v === Number(settings[f.key])) return;
                  settingsMut.mutate({ [f.key]: v });
                }}
              />
              <p className="text-[11px] text-muted-foreground">{f.hint}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {NUMBER_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={f.key}>{f.label}</Label>
            <Input
              id={f.key}
              type="number"
              defaultValue={String(settings[f.key] ?? "")}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v) || v === Number(settings[f.key])) return;
                settingsMut.mutate({ [f.key]: v });
              }}
            />
            <p className="text-[11px] text-muted-foreground">{f.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        <SectionTitle
          title="Market schedules"
          description="Times are market-local; daylight saving is handled automatically."
        />
        {schedules.map((s) => (
          <div key={s.id} className="rounded-lg border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">
                {s.market} <span className="text-muted-foreground">· {s.timezone}</span>
              </p>
              <Switch
                aria-label={`Enable ${s.market} schedule`}
                checked={Boolean(s.enabled)}
                onCheckedChange={(v) =>
                  scheduleMut.mutate({ market: s.market as ScheduleMarket, patch: { enabled: v } })
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { key: "market_close_local", label: "Market close", type: "time" },
                { key: "main_run_local", label: "Main run", type: "time" },
                { key: "delta_run_local", label: "Late delta", type: "time" },
                { key: "main_max_provider_requests", label: "Main provider", type: "number" },
                { key: "main_max_web_searches", label: "Main web", type: "number" },
                { key: "delta_max_provider_requests", label: "Delta provider", type: "number" },
              ].map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`${s.market}-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`${s.market}-${f.key}`}
                    type={f.type}
                    defaultValue={String(s[f.key as keyof typeof s] ?? "").slice(
                      0,
                      f.type === "time" ? 5 : undefined,
                    )}
                    onBlur={(e) => {
                      const raw = e.target.value;
                      if (!raw) return;
                      const value = f.type === "number" ? Number(raw) : raw;
                      scheduleMut.mutate({
                        market: s.market as ScheduleMarket,
                        patch: { [f.key]: value },
                      });
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        <SectionTitle
          title="Market holidays"
          description="Runs are skipped on closed days instead of burning quota."
        />
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="holiday-market">Market</Label>
            <select
              id="holiday-market"
              value={holiday.market}
              onChange={(e) => setHoliday({ ...holiday, market: e.target.value as ScheduleMarket })}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {SCHEDULE_MARKETS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="holiday-date">Date</Label>
            <Input
              id="holiday-date"
              type="date"
              value={holiday.holiday_date}
              onChange={(e) => setHoliday({ ...holiday, holiday_date: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="holiday-name">Name</Label>
            <Input
              id="holiday-name"
              value={holiday.holiday_name}
              onChange={(e) => setHoliday({ ...holiday, holiday_name: e.target.value })}
              placeholder="Diwali"
            />
          </div>
          <Button
            size="sm"
            disabled={!holiday.holiday_date || !holiday.holiday_name || holidayMut.isPending}
            onClick={() => holidayMut.mutate()}
          >
            Add holiday
          </Button>
        </div>
        {holidays.length > 0 && (
          <ul className="space-y-1.5">
            {holidays.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-sm"
              >
                <span>
                  {h.holiday_date} · {h.market} —{" "}
                  <span className="text-muted-foreground">{h.holiday_name}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => deleteHolidayMut.mutate(h.id)}
                  aria-label={`Remove ${h.holiday_name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
