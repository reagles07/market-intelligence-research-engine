import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MinusCircle,
  RotateCcw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CANDIDATE_TYPE_LABELS, type CandidateType } from "@/lib/discovery/domain";

export type ScoreComponentRow = {
  component_key: string;
  label: string;
  max_points: number;
  points: number;
  available: boolean;
  reason: string;
  value_text: string | null;
  stage: string;
};

export type CandidateSourceRow = {
  id: string;
  provider: string;
  endpoint: string | null;
  signal_type: string | null;
  url: string | null;
  title: string | null;
  publisher: string | null;
  source_tier: string;
  published_at: string | null;
};

export type CandidateRow = {
  id: string;
  market: string;
  company_name: string;
  ticker: string | null;
  title: string;
  primary_type: string;
  candidate_types: string[];
  discovery_reason: string;
  catalyst: string | null;
  price_move_pct: number | null;
  reported_price_move_pct: number | null;
  volume_ratio: number | null;
  week52_event: string | null;
  headline: string | null;
  url: string | null;
  event_at: string | null;
  signal_count: number;
  best_source_tier: string | null;
  coverage_flag: string;
  content_score: number;
  score_coverage_pct: number;
  priority_band: string;
  score_rank: number | null;
  ai_evaluated: boolean;
  suggested_angle: string | null;
  suggested_hook: string | null;
  core_question: string | null;
  evaluation_notes: string | null;
  status: string;
  dismissed_reason: string | null;
  story_id: string | null;
  candidate_score_components: ScoreComponentRow[];
  candidate_sources: CandidateSourceRow[];
};

const bandTone: Record<string, string> = {
  IMMEDIATE: "bg-destructive/15 text-destructive border-destructive/30",
  STRONG: "bg-primary/15 text-primary border-primary/30",
  WATCH: "bg-secondary text-secondary-foreground border-border",
  "LOW PRIORITY": "bg-muted text-muted-foreground border-border",
};

export function CandidateCard({
  candidate,
  onPromote,
  onDismiss,
  onRestore,
  busy,
}: {
  candidate: CandidateRow;
  onPromote: (id: string) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const components = useMemo(
    () => [...candidate.candidate_score_components].sort((a, b) => b.max_points - a.max_points),
    [candidate.candidate_score_components],
  );
  const missing = components.filter((c) => !c.available);
  const promoted = candidate.status === "PROMOTED_TO_STORY";
  const dismissed = candidate.status === "DISMISSED";

  return (
    <Card className={`p-4 ${dismissed ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {candidate.score_rank ? (
              <span className="text-xs font-mono text-muted-foreground">
                #{candidate.score_rank}
              </span>
            ) : null}
            <span className="font-semibold">{candidate.company_name}</span>
            {candidate.ticker ? (
              <span className="font-mono text-xs text-muted-foreground">{candidate.ticker}</span>
            ) : null}
            <Badge variant="outline" className="text-[10px]">
              {candidate.market}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {CANDIDATE_TYPE_LABELS[candidate.primary_type as CandidateType] ??
                candidate.primary_type}
            </Badge>
            {candidate.ai_evaluated ? (
              <Badge variant="secondary" className="text-[10px]">
                AI evaluated
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm">{candidate.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{candidate.discovery_reason}</p>
        </div>

        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">{candidate.content_score}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Content opportunity
          </div>
          <Badge
            variant="outline"
            className={`mt-1 text-[10px] ${bandTone[candidate.priority_band] ?? ""}`}
          >
            {candidate.priority_band}
          </Badge>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{candidate.signal_count} signal(s)</span>
        {candidate.price_move_pct !== null ? (
          <span className={candidate.price_move_pct >= 0 ? "text-primary" : "text-destructive"}>
            {candidate.price_move_pct > 0 ? "+" : ""}
            {candidate.price_move_pct}% measured
          </span>
        ) : candidate.reported_price_move_pct !== null ? (
          <span>{candidate.reported_price_move_pct}% reported by a source (not measured)</span>
        ) : (
          <span>No measured price move</span>
        )}
        {candidate.volume_ratio !== null ? (
          <span>{candidate.volume_ratio.toFixed(2)}x volume</span>
        ) : null}
        {candidate.week52_event ? <span>{candidate.week52_event}</span> : null}
        {candidate.best_source_tier ? <span>{candidate.best_source_tier}</span> : null}
        <span>Score coverage {candidate.score_coverage_pct}%</span>
      </div>

      {candidate.score_coverage_pct < 80 ? (
        <p className="mt-2 flex items-start gap-2 rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Scored on partial data — {missing.map((m) => m.label).join(", ") || "some inputs"}{" "}
          unavailable. The score is not comparable with a fully covered candidate.
        </p>
      ) : null}

      {candidate.suggested_angle ? (
        <div className="mt-3 rounded-md border border-border/60 p-3 text-xs">
          <p>
            <span className="font-medium">Angle:</span> {candidate.suggested_angle}
          </p>
          {candidate.core_question ? (
            <p className="mt-1 text-muted-foreground">
              <span className="font-medium">Core question:</span> {candidate.core_question}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {promoted ? (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <CheckCircle2 className="h-3 w-3" /> Promoted to a story
          </Badge>
        ) : dismissed ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onRestore(candidate.id)}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore
          </Button>
        ) : (
          <>
            <Button size="sm" disabled={busy} onClick={() => onPromote(candidate.id)}>
              <ArrowUpRight className="mr-1 h-3.5 w-3.5" /> Promote to story
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onDismiss(candidate.id)}
            >
              <MinusCircle className="mr-1 h-3.5 w-3.5" /> Dismiss
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? (
            <ChevronUp className="mr-1 h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="mr-1 h-3.5 w-3.5" />
          )}
          Score breakdown
        </Button>
      </div>

      {open ? (
        <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
          <div className="space-y-2">
            {components.map((c) => (
              <div key={c.component_key} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className={c.available ? "" : "text-muted-foreground line-through"}>
                    {c.label}
                    {c.stage === "AI" ? " · AI" : ""}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {c.available
                      ? `${c.points} / ${c.max_points}`
                      : `unavailable / ${c.max_points}`}
                  </span>
                </div>
                <Progress
                  value={c.available ? (Number(c.points) / Number(c.max_points)) * 100 : 0}
                  className="mt-1 h-1"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">{c.reason}</p>
              </div>
            ))}
          </div>

          <div>
            <p className="text-xs font-medium">Signals &amp; sources</p>
            <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
              {candidate.candidate_sources.map((s) => (
                <li key={s.id}>
                  <span className="font-mono">{s.provider}</span>
                  {s.endpoint ? ` ${s.endpoint}` : ""} · {s.source_tier}
                  {s.title ? ` — ${s.title}` : ""}
                  {s.url ? (
                    <>
                      {" "}
                      <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                        open
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          {candidate.evaluation_notes ? (
            <p className="text-[11px] text-muted-foreground">{candidate.evaluation_notes}</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
