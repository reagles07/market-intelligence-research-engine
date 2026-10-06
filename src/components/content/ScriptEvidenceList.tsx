/**
 * Evidence trace for a generated script: every section with the claims,
 * sources and metrics it was allowed to use.
 */
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { supabase as db } from "@/integrations/supabase/client";
import { countWords, estimateSeconds, formatDuration } from "@/lib/content/domain";

export function ScriptEvidenceList({ scriptId }: { scriptId: string }) {
  const { data: sections } = useQuery({
    queryKey: ["script-sections", scriptId],
    queryFn: async () => {
      const { data } = await supabase
        .from("script_sections")
        .select("*")
        .eq("script_id", scriptId)
        .order("order_index", { ascending: true });
      return data ?? [];
    },
  });

  const sourceIds = [...new Set((sections ?? []).flatMap((s) => s.source_ids ?? []))];

  const { data: sources } = useQuery({
    queryKey: ["script-section-sources", scriptId, sourceIds.length],
    enabled: sourceIds.length > 0,
    queryFn: async () => {
      const { data } = await db
        .from("sources")
        .select("id,title,publisher,source_tier,url")
        .in("id", sourceIds);
      return data ?? [];
    },
  });

  if (!sections?.length) return null;
  const byId = new Map((sources ?? []).map((s) => [s.id, s] as const));

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-medium">Evidence per section</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Each spoken block links back to the verified claims, sources and metrics it came from.
      </p>
      <div className="mt-3 space-y-2">
        {sections.map((s) => {
          const words = countWords(s.spoken_text);
          return (
            <details key={s.id} className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-xs font-medium">
                {s.label}
                <span className="ml-2 font-normal text-muted-foreground">
                  {words} words · {formatDuration(estimateSeconds(words))} ·{" "}
                  {(s.claim_ids ?? []).length} claims · {(s.source_ids ?? []).length} sources
                </span>
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm">{s.spoken_text}</p>
              {(s.source_ids ?? []).length ? (
                <ul className="mt-2 space-y-1">
                  {(s.source_ids ?? []).map((sid) => {
                    const src = byId.get(sid);
                    return (
                      <li key={sid} className="text-[11px] text-muted-foreground">
                        {src ? (
                          <>
                            <span className="font-medium">{src.source_tier}</span> · {src.publisher}{" "}
                            ·{" "}
                            {src.url ? (
                              <a
                                href={src.url}
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                {src.title}
                              </a>
                            ) : (
                              src.title
                            )}
                          </>
                        ) : (
                          sid
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {(s.metric_keys ?? []).length ? (
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {(s.metric_keys ?? []).join(" · ")}
                </p>
              ) : null}
            </details>
          );
        })}
      </div>
    </section>
  );
}
