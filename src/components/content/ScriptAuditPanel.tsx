import { reportAsyncError } from "@/lib/async-errors";
/**
 * Final fact check + readiness gate for one script.
 *
 * Shows the deterministic numeric pre-check, the AI statement audit, the
 * evidence-constrained repair pass and the advisory style check, and states
 * plainly whether the script may go to human review.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionTitle } from "@/components/common/ui-bits";
import { supabase } from "@/integrations/supabase/client";
import { useAiModel } from "@/components/providers/use-ai-model";
import {
  auditScript,
  repairScript,
  runScriptReadiness,
  scriptReadiness,
  scriptResearchFreshness,
} from "@/lib/ai/script.functions";
import { fmtDateTime } from "@/lib/finance";

const STATUS_CLASS: Record<string, string> = {
  SUPPORTED: "text-emerald-700 dark:text-emerald-400",
  SUPPORTED_WITH_ATTRIBUTION: "text-emerald-700 dark:text-emerald-400",
  NEEDS_QUALIFICATION: "text-amber-700 dark:text-amber-400",
  CONFLICTING: "text-destructive",
  UNSUPPORTED: "text-destructive",
};

const pill = (tone: "good" | "warn" | "bad" | "muted") =>
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium " +
  (tone === "good"
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : tone === "warn"
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : tone === "bad"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground");

type Row = Record<string, unknown>;

export function ScriptAuditPanel({ scriptId }: { scriptId: string }) {
  const qc = useQueryClient();
  const { model } = useAiModel();
  const runAudit = useServerFn(auditScript);
  const runCycle = useServerFn(runScriptReadiness);
  const runRepair = useServerFn(repairScript);
  const readinessFn = useServerFn(scriptReadiness);
  const freshnessFn = useServerFn(scriptResearchFreshness);

  const { data: readiness } = useQuery({
    queryKey: ["script-readiness", scriptId],
    queryFn: async () => (await readinessFn({ data: { scriptId } })) as Row,
  });

  const audit = (readiness?.["audit"] ?? null) as Row | null;
  const repair = (readiness?.["repair"] ?? null) as Row | null;
  const styleCheck = (readiness?.["styleCheck"] ?? null) as Row | null;

  const { data: statements } = useQuery({
    queryKey: ["script-statements", audit?.["id"]],
    enabled: Boolean(audit?.["id"]),
    queryFn: async () => {
      const { data } = await supabase
        .from("script_statements")
        .select("*")
        .eq("audit_id", String(audit!["id"]))
        .order("severity", { ascending: true });
      return data ?? [];
    },
  });

  const { data: freshness } = useQuery({
    queryKey: ["script-freshness", scriptId],
    queryFn: async () => (await freshnessFn({ data: { scriptId } })) as Row,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["script-readiness", scriptId] }).catch((error: unknown) =>
      reportAsyncError(error, "refresh"),
    );
    qc.invalidateQueries({ queryKey: ["script-statements"] }).catch((error: unknown) =>
      reportAsyncError(error, "refresh"),
    );
    qc.invalidateQueries({ queryKey: ["story-scripts"] }).catch((error: unknown) =>
      reportAsyncError(error, "refresh"),
    );
  };

  const cycled = useMutation({
    mutationFn: async () => (await runCycle({ data: { scriptId, model } })) as Row,
    onSuccess: (r) => {
      if (!r["ok"]) return void toast.error(String(r["error"] ?? "Fact check failed"));
      if (r["readyForReview"]) toast.success("Readiness gate passed — Ready for Review");
      else toast.error("Blocking issues remain — the script is not ready for review");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const audited = useMutation({
    mutationFn: async () => (await runAudit({ data: { scriptId, model } })) as Row,
    onSuccess: (r) => {
      if (!r["ok"]) return void toast.error(String(r["error"] ?? "Audit failed"));
      const status = String(r["status"]);
      if (status === "PASS") toast.success("Fact check passed");
      else if (status === "WARN") toast.warning("Fact check passed with warnings");
      else toast.error("Fact check failed — blocking issues found");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const repaired = useMutation({
    mutationFn: async () => (await runRepair({ data: { scriptId, model } })) as Row,
    onSuccess: (r) => {
      if (!r["ok"]) return void toast.error(String(r["error"] ?? "Repair failed"));
      toast.success(
        `Repair applied — ${r["corrected"]} corrected, ${r["attributed"]} attributed, ${r["qualified"]} qualified, ${r["removed"]} removed`,
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = cycled.isPending || audited.isPending || repaired.isPending;
  const stale = freshness?.["stale"] === true;
  const status = String(audit?.["status"] ?? "Not Audited");
  const ready = readiness?.["readyForReview"] === true;
  const needsReaudit = readiness?.["needsReaudit"] === true;
  const gate = (audit?.["readiness_gate"] ?? {}) as Record<string, unknown>;
  const pre = (audit?.["numeric_precheck"] ?? {}) as Record<string, unknown>;
  const preFindings = (pre["findings"] ?? []) as Row[];
  const failing = (statements ?? []).filter((s) => s.severity !== "Info");
  const repairItems = (repair?.["items"] ?? []) as Row[];
  const styleFindings = (styleCheck?.["findings"] ?? []) as Row[];

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <SectionTitle
        title="Final fact check & readiness gate"
        description="Numbers are matched in code against the research packet first, then every factual sentence is audited. One evidence-only repair pass is allowed; nothing reaches review with a blocker open."
      />

      {stale ? (
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Research update available — this script was written from packet v
            {String(freshness?.["scriptPacketVersion"] ?? "?")}, the story now has v
            {String(freshness?.["latestPacketVersion"] ?? "?")}. Regenerate before approving.
          </span>
        </div>
      ) : null}

      {needsReaudit && audit ? (
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>The script was edited after the last fact check — re-run it before approving.</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <span className={pill(ready ? "good" : audit ? "bad" : "muted")}>
          {ready ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          {ready ? "Ready for Review" : audit ? "Not ready" : "Not audited"}
        </span>
        <span
          className={pill(
            status === "PASS"
              ? "good"
              : status === "WARN"
                ? "warn"
                : status === "FAIL"
                  ? "bad"
                  : "muted",
          )}
        >
          Audit {status}
          {audit?.["audit_pass"] ? ` · pass ${String(audit["audit_pass"])}` : ""}
        </span>
        {styleCheck ? (
          <span className={pill(String(styleCheck["status"]) === "PASS" ? "good" : "warn")}>
            Style {String(styleCheck["status"])} · {String(styleCheck["warnings_total"])} advisory
          </span>
        ) : null}
        <Button size="sm" onClick={() => cycled.mutate()} disabled={busy}>
          {cycled.isPending ? "Running…" : "Run fact check + auto repair"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => audited.mutate()} disabled={busy}>
          {audited.isPending ? "Checking…" : "Audit only"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => repaired.mutate()}
          disabled={busy || !audit || status === "PASS"}
        >
          <Wrench className="mr-1.5 h-3.5 w-3.5" />
          {repaired.isPending ? "Repairing…" : "Repair only"}
        </Button>
      </div>

      {audit ? (
        <span className="block text-[11px] text-muted-foreground">
          {String(audit["statements_total"])} statements · {String(audit["unsupported"])}{" "}
          unsupported · {String(audit["conflicting"])} conflicting ·{" "}
          {String(audit["needs_qualification"])} need qualification ·{" "}
          {String(audit["numeric_failures"])} numeric failures · {String(audit["word_count"])} words
          {audit["within_word_budget"] === false ? " (outside budget)" : ""} ·{" "}
          {fmtDateTime(String(audit["created_at"]))}
        </span>
      ) : null}

      {audit?.["summary"] ? (
        <p className="text-xs text-muted-foreground">{String(audit["summary"])}</p>
      ) : null}

      {audit ? (
        <Tabs defaultValue="gate">
          <TabsList>
            <TabsTrigger value="gate">Readiness</TabsTrigger>
            <TabsTrigger value="numbers">Numbers ({preFindings.length})</TabsTrigger>
            <TabsTrigger value="statements">Statements ({failing.length})</TabsTrigger>
            <TabsTrigger value="repair">Repair</TabsTrigger>
            <TabsTrigger value="style">Style</TabsTrigger>
          </TabsList>

          <TabsContent value="gate" className="space-y-2 pt-3">
            {[
              ["Unsupported numbers", gate["unsupported_numbers"]],
              ["Numeric conflicts", gate["numeric_conflicts"]],
              ["Attribution gaps", gate["attribution_gaps"]],
              ["Forecast stated as fact", gate["forecast_errors"]],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs"
              >
                <span>{String(label)}</span>
                <span
                  className={
                    Number(value ?? 0) === 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-destructive"
                  }
                >
                  {Number(value ?? 0) === 0 ? "clear" : `${String(value)} blocking`}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
              <span>
                Word budget{" "}
                {gate["word_budget"] ? `(${String(gate["word_budget"])})` : "(not applicable)"}
              </span>
              <span
                className={
                  gate["word_budget_ok"] === false
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-muted-foreground"
                }
              >
                {String(gate["word_count"] ?? "—")} words
                {gate["word_budget_ok"] === false ? " · advisory" : ""}
              </span>
            </div>
            {pre["currentPriceAllowed"] === false ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {String(pre["currentPriceReason"] ?? "")}
              </p>
            ) : null}
          </TabsContent>

          <TabsContent value="numbers" className="space-y-2 pt-3">
            {preFindings.length ? (
              preFindings.map((f, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                      className={
                        String(f["severity"]) === "Blocking"
                          ? "font-semibold text-destructive"
                          : "font-semibold text-amber-700 dark:text-amber-400"
                      }
                    >
                      {String(f["status"])}
                    </span>
                    <span className="text-muted-foreground">
                      {String(f["severity"])} · {String(f["metric"])} ·{" "}
                      {String(f["sectionKey"] ?? "")}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm">{String(f["sentence"])}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Script <span className="font-mono">{String(f["raw"])}</span>
                    {f["matchedValue"] !== null && f["matchedValue"] !== undefined ? (
                      <>
                        {" "}
                        · research <span className="font-mono">{String(f["matchedValue"])}</span> (
                        {String(f["matchedLabel"] ?? "")})
                      </>
                    ) : null}
                  </p>
                  {f["issue"] ? (
                    <p className="mt-1 text-xs text-muted-foreground">{String(f["issue"])}</p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                Every number in the script matched the research data exactly.
              </p>
            )}
          </TabsContent>

          <TabsContent value="statements" className="space-y-2 pt-3">
            {failing.length ? (
              failing.map((s) => (
                <div key={s.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={"font-semibold " + (STATUS_CLASS[s.status] ?? "")}>
                      {s.status}
                    </span>
                    <span className="text-muted-foreground">
                      {s.severity} · {s.statement_type} · {s.section_key} ·{" "}
                      {s.origin === "precheck" ? "numeric pre-check" : "AI audit"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm">{s.statement_text}</p>
                  {s.issue ? (
                    <p className="mt-1 text-xs text-muted-foreground">Issue: {s.issue}</p>
                  ) : null}
                  {s.research_value || s.script_value ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Script says <span className="font-mono">{s.script_value ?? "—"}</span> ·
                      research holds <span className="font-mono">{s.research_value ?? "—"}</span>
                    </p>
                  ) : null}
                  {s.recommended_wording ? (
                    <p className="mt-1 rounded bg-muted/50 px-2 py-1 text-xs">
                      Suggested: {s.recommended_wording}
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                No blocking or warning statements — every checked sentence traced to the packet.
              </p>
            )}
          </TabsContent>

          <TabsContent value="repair" className="space-y-2 pt-3">
            {repair ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {String(repair["status"])} · {String(repair["corrected"])} corrected ·{" "}
                  {String(repair["attributed"])} attributed · {String(repair["qualified"])}{" "}
                  qualified · {String(repair["removed"])} removed · script v
                  {String(repair["script_version"])}
                </p>
                {repair["notes"] ? <p className="text-xs">{String(repair["notes"])}</p> : null}
                {repairItems.map((it, i) => (
                  <div key={i} className="rounded-lg border border-border p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{String(it["action"])}</span>
                      <span
                        className={
                          it["accepted"]
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-muted-foreground"
                        }
                      >
                        {it["accepted"] ? "applied" : "rejected"}
                      </span>
                    </div>
                    <p className="mt-1 line-through opacity-70">{String(it["original"])}</p>
                    {it["replacement"] ? <p className="mt-1">{String(it["replacement"])}</p> : null}
                    <p className="mt-1 text-muted-foreground">
                      {String(it["rejectedReason"] ?? it["reason"] ?? "")}
                    </p>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                No repair has run for this script. Repair may only correct numbers, add attribution,
                add qualification or remove a claim — it never adds a new fact.
              </p>
            )}
          </TabsContent>

          <TabsContent value="style" className="space-y-2 pt-3">
            {styleCheck ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {String(styleCheck["summary"])} (advisory only — never blocks approval)
                </p>
                {styleFindings.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2 text-xs"
                  >
                    <div>
                      <p className="font-medium">{String(f["label"])}</p>
                      <p className="text-muted-foreground">{String(f["detail"])}</p>
                      {Array.isArray(f["examples"]) && (f["examples"] as string[]).length ? (
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {(f["examples"] as string[]).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={
                        String(f["status"]) === "PASS"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-amber-700 dark:text-amber-400"
                      }
                    >
                      {String(f["status"])}
                    </span>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                The style check runs with the fact check.
              </p>
            )}
          </TabsContent>
        </Tabs>
      ) : null}
    </section>
  );
}
