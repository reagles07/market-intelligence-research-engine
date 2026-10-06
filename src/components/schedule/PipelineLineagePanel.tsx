import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";

import { SectionTitle } from "@/components/common/ui-bits";
import { listPipelineRunsForExecution } from "@/lib/automation.functions";
import {
  PIPELINE_OUTCOME_LABEL,
  PIPELINE_OUTCOME_TONE,
  PIPELINE_STAGE_LABEL,
  type PipelineOutcome,
  type PipelineStage,
} from "@/lib/automation/domain";
import { cn } from "@/lib/utils";

const TONE_CLASS = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
  muted: "text-muted-foreground",
} as const;

/**
 * Lineage of one autonomous pass: which candidates qualified, what was
 * promoted, researched and written, and where each story stopped.
 */
export function PipelineLineagePanel({ dailyRunId }: { dailyRunId: string }) {
  const fetchRuns = useServerFn(listPipelineRunsForExecution);
  const { data } = useQuery({
    queryKey: ["pipeline-runs", dailyRunId],
    queryFn: () => fetchRuns({ data: { dailyRunId } }),
  });

  const runs = data ?? [];

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <SectionTitle
        title="Autonomous research + content"
        description="Every story is traceable from candidate to script. Ready for Review is the final state — nothing is published automatically."
      />
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No autonomous pipeline pass ran for this day.
        </p>
      ) : (
        <div className="space-y-4">
          {runs.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">
                  {String(r.execution_type).replaceAll("_", " ")}
                  {r.dry_run ? (
                    <span className="ml-2 rounded-md bg-secondary px-2 py-0.5 text-[11px]">
                      dry run
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.candidates_qualified}/{r.candidates_considered} qualified ·{" "}
                  {r.stories_promoted} promoted · {r.research_ready}/{r.research_runs} research
                  ready · {r.ready_for_review}/{r.content_runs} ready for review · {r.ai_calls} AI
                  calls · ${Number(r.estimated_cost_usd ?? 0).toFixed(4)} of $
                  {Number(r.autonomous_budget_usd ?? 0).toFixed(2)}
                </span>
              </div>
              {r.skip_reason ? (
                <p className="mb-2 text-xs text-muted-foreground">{r.skip_reason}</p>
              ) : null}
              {(r.items ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No candidate qualified.</p>
              ) : (
                <ul className="space-y-1.5">
                  {r.items.map((i) => {
                    const outcome = String(i.outcome) as PipelineOutcome;
                    return (
                      <li
                        key={i.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                      >
                        <span>
                          <span className="font-medium">{i.ticker ?? i.company_name}</span>{" "}
                          <span className="text-muted-foreground">{i.title}</span>
                          {i.skip_reason ? (
                            <span className="block text-xs text-muted-foreground">
                              {i.skip_reason}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">
                            {PIPELINE_STAGE_LABEL[String(i.stage) as PipelineStage] ?? i.stage} ·
                            score {Number(i.content_score ?? 0).toFixed(0)}
                          </span>
                          <span
                            className={cn(
                              "rounded-md bg-secondary px-2 py-0.5 font-medium",
                              TONE_CLASS[PIPELINE_OUTCOME_TONE[outcome] ?? "muted"],
                            )}
                          >
                            {PIPELINE_OUTCOME_LABEL[outcome] ?? outcome}
                          </span>
                          {i.story_id ? (
                            <Link
                              to="/stories/$id"
                              params={{ id: String(i.story_id) }}
                              className="underline underline-offset-2"
                            >
                              Open
                            </Link>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
