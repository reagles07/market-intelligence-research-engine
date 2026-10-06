/**
 * The provenance strip for one generated script: which writing style, which
 * research packet version, which format, and how the word count compares to
 * the target band for that format.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { listStyleProfiles } from "@/lib/ai/script.functions";
import { TARGET_DURATIONS, SHORT_DURATIONS } from "@/lib/content/domain";
import {
  DEFAULT_STYLE_PROFILE_NAME,
  formatWordRange,
  shortWordBudget,
  type WordBudgets,
} from "@/lib/content/style";

type ScriptRow = {
  format: string;
  target_duration: string | null;
  word_count: number;
  audit_status: string;
  research_packet_version: number | null;
  style_profile_id: string | null;
  style_profile_version: number | null;
};

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-32">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xs font-medium">{value}</p>
    </div>
  );
}

export function ScriptMetaStrip({ script }: { script: ScriptRow }) {
  const stylesFn = useServerFn(listStyleProfiles);
  const { data: styles } = useQuery({
    queryKey: ["script-style-profiles"],
    queryFn: () => stylesFn(),
  });

  const profile =
    (styles ?? []).find((s) => s.id === script.style_profile_id) ??
    (styles ?? []).find((s) => s.isDefault) ??
    null;

  const durationKey = script.target_duration ?? script.format;
  const longDef = TARGET_DURATIONS.find((d) => d.key === durationKey);
  const shortDef = SHORT_DURATIONS.find((d) => d.key === durationKey);

  const budget = longDef
    ? {
        low: Math.round((longDef.lowSec / 60) * 150),
        high: Math.round((longDef.highSec / 60) * 150),
      }
    : shortDef
      ? shortWordBudget((profile?.wordBudgets ?? {}) as WordBudgets, shortDef.key)
      : null;

  const within = budget
    ? script.word_count >= budget.low && script.word_count <= budget.high
    : null;

  return (
    <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <Cell
        label="Writing style"
        value={
          script.style_profile_id
            ? `${profile?.name ?? DEFAULT_STYLE_PROFILE_NAME}`
            : "Not recorded"
        }
      />
      <Cell
        label="Style version"
        value={script.style_profile_version ? `v${script.style_profile_version}` : "—"}
      />
      <Cell
        label="Research packet"
        value={script.research_packet_version ? `v${script.research_packet_version}` : "—"}
      />
      <Cell label="Content format" value={script.format} />
      <Cell label="Target duration" value={longDef?.label ?? shortDef?.label ?? durationKey} />
      <Cell label="Target words" value={budget ? formatWordRange(budget) : "—"} />
      <Cell
        label="Actual words"
        value={
          within === null
            ? String(script.word_count)
            : `${script.word_count} · ${within ? "in range" : "out of range"}`
        }
      />
      <Cell label="Audit status" value={script.audit_status} />
    </div>
  );
}
