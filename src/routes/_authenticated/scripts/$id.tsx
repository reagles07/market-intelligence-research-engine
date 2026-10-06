import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Download } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Disclaimer, EmptyState, SectionTitle, StatusBadge } from "@/components/common/ui-bits";
import {
  LANGUAGES,
  SCRIPT_FORMATS,
  SCRIPT_STATUSES,
  SUPPORTING_ASSETS,
  type Language,
  type ScriptFormatKey,
} from "@/lib/domain";
import { CLIP_IDEAS, buildScriptScaffold, buildSupportingAsset } from "@/lib/scriptTemplates";
import { ScriptGeneratorPanel } from "@/components/content/ScriptGeneratorPanel";
import { ScriptMetaStrip } from "@/components/content/ScriptMetaStrip";
import { ScriptAuditPanel } from "@/components/content/ScriptAuditPanel";
import { ResearchGapsPanel } from "@/components/content/ResearchGapsPanel";
import { ScriptEvidenceList } from "@/components/content/ScriptEvidenceList";
import { contentHash } from "@/lib/content/hash";
import { fmtDateTime } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/scripts/$id")({
  head: () => ({
    meta: [
      { title: "Script Studio — Stock Research Studio" },
      {
        name: "description",
        content:
          "Generate long-form, Shorts and Tanglish script scaffolds from a verified research packet, then review and approve.",
      },
      { property: "og:title", content: "Script Studio" },
      {
        property: "og:description",
        content: "Long-form, Shorts and Tanglish script scaffolds from verified research.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  errorComponent: () => (
    <EmptyState title="Could not load Script Studio" description="Try again in a moment." />
  ),
  notFoundComponent: () => (
    <EmptyState title="Story not found" description="This story no longer exists." />
  ),
  component: ScriptStudio,
});

function ScriptStudio() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [format, setFormat] = useState<ScriptFormatKey>(SCRIPT_FORMATS[0].key);
  const [language, setLanguage] = useState<Language>("Tanglish");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [body, setBody] = useState("");

  const { data: story } = useQuery({
    queryKey: ["story", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stories")
        .select("*, companies(*)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: packet } = useQuery({
    queryKey: ["packet", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("research_packets")
        .select("*, research_sections(section_key,content)")
        .eq("story_id", id)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: claims } = useQuery({
    queryKey: ["story-claims", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("claims")
        .select("id,verification_status,is_critical")
        .eq("story_id", id);
      return data ?? [];
    },
  });

  const { data: scripts } = useQuery({
    queryKey: ["story-scripts", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("scripts")
        .select("*")
        .eq("story_id", id)
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  const active = (scripts ?? []).find((s) => s.id === activeId) ?? null;

  const selectedScriptId = active?.id;
  const selectedScriptBody = active?.body;
  useEffect(() => {
    if (selectedScriptId) setBody(selectedScriptBody ?? "");
  }, [selectedScriptId, selectedScriptBody]);

  const blocking = (claims ?? []).filter((c) =>
    ["Conflicting", "Unsupported"].includes(c.verification_status),
  );
  const filledSections = (packet?.research_sections ?? []).filter(
    (s) => (s.content ?? "").trim().length > 0,
  ).length;
  const readyToApprove = blocking.length === 0 && filledSections > 0;

  const generate = useMutation({
    mutationFn: async () => {
      if (!story) throw new Error("Story not loaded");
      const meta = SCRIPT_FORMATS.find((f) => f.key === format)!;
      const scaffold = buildScriptScaffold({
        format,
        formatLabel: meta.label,
        language,
        company: story.companies?.name ?? "",
        ticker: story.companies?.ticker ?? "",
        storyTitle: story.title,
      });
      const { data, error } = await supabase
        .from("scripts")
        .insert({
          story_id: story.id,
          company_id: story.company_id,
          packet_id: packet?.id ?? null,
          format,
          language,
          title: `${story.companies?.ticker} — ${meta.label} (${language})`,
          body: scaffold,
          status: "Draft",
          is_ai_placeholder: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (newId) => {
      toast.success("Script scaffold created");
      setActiveId(newId);
      qc.invalidateQueries({ queryKey: ["story-scripts", id] }).catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
      qc.invalidateQueries({ queryKey: ["scripts"] }).catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveBody = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("No script selected");
      // A human edit invalidates the fact check: the script must be re-audited.
      const changed = (active.body ?? "") !== body;
      const { error } = await supabase
        .from("scripts")
        .update({
          body,
          is_ai_placeholder: body.includes("AI PLACEHOLDER OUTPUT"),
          body_hash: contentHash(body),
          ...(changed
            ? {
                ready_for_review: false,
                audit_status: "Not Audited",
                status: ["Approved", "Published"].includes(active.status)
                  ? active.status
                  : "Needs Fact Check",
              }
            : {}),
        })
        .eq("id", active.id);
      if (error) throw error;
      const nextVersion =
        ((
          await supabase
            .from("script_versions")
            .select("version")
            .eq("script_id", active.id)
            .order("version", { ascending: false })
            .limit(1)
            .maybeSingle()
        ).data?.version ?? 0) + 1;
      await supabase
        .from("script_versions")
        .insert({ script_id: active.id, version: nextVersion, body });
      return changed;
    },
    onSuccess: (changed) => {
      toast.success(
        changed
          ? "Saved as a new version — re-run the fact check before approving"
          : "Script saved as a new version",
      );
      qc.invalidateQueries({ queryKey: ["story-scripts", id] }).catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
      qc.invalidateQueries({ queryKey: ["script-readiness", active?.id] }).catch(
        (error: unknown) => {
          console.error(error);
          process.exitCode = 1;
        },
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async (status: string) => {
      if (!active) throw new Error("No script selected");
      if (status === "Approved" && !readyToApprove) {
        throw new Error("Resolve conflicting or unsupported claims before approving");
      }
      if (status === "Approved" && !active.ready_for_review) {
        throw new Error(
          "The readiness gate has not passed — run the final fact check and clear every blocker first",
        );
      }
      if (status === "Approved" && contentHash(body) !== (active.body_hash ?? "")) {
        throw new Error("This script has unsaved edits — save and re-run the fact check first");
      }

      if (status === "Published") {
        throw new Error("Publishing is manual — mark the publication record instead");
      }
      const { error } = await supabase
        .from("scripts")
        .update({
          status,
          approved_at: status === "Approved" ? new Date().toISOString() : null,
        })
        .eq("id", active.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["story-scripts", id] }).catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
      qc.invalidateQueries({ queryKey: ["scripts"] }).catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const makeAsset = useMutation({
    mutationFn: async (assetKey: string) => {
      if (!story) throw new Error("Story not loaded");
      const { error } = await supabase.from("content_assets").insert({
        asset_type: assetKey,
        company_id: story.company_id,
        story_id: story.id,
        script_id: active?.id ?? null,
        content: buildSupportingAsset(
          assetKey,
          story.companies?.name ?? "",
          story.companies?.ticker ?? "",
        ),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Asset added to Content Library");
      qc.invalidateQueries({ queryKey: ["content-assets"] }).catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addPublication = useMutation({
    mutationFn: async (platform: string) => {
      if (!active) throw new Error("Select a script first");
      const { error } = await supabase.from("content_publications").insert({
        script_id: active.id,
        platform,
        status: "Planned",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Publication record created");
      qc.invalidateQueries({ queryKey: ["content-publications"] }).catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!story) return <div className="text-sm text-muted-foreground">Loading Script Studio…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Script Studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {story.companies?.ticker} · {story.title}
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/stories/$id" params={{ id: story.id }}>
            Back to research
          </Link>
        </Button>
      </div>

      <div
        className={
          readyToApprove
            ? "rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400"
            : "rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
        }
      >
        {readyToApprove
          ? `Verification gate passed — ${filledSections} research sections written, no blocking claims.`
          : `Verification gate blocked — ${blocking.length} conflicting/unsupported claim(s), ${filledSections} research section(s) written.`}
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <SectionTitle
          title="Generate a script scaffold"
          description="Scaffolds are structure only. Every block is marked as placeholder until a human writes the verified content."
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>Format</Label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as ScriptFormatKey)}
              className="h-9 w-64 rounded-md border border-input bg-background px-2 text-sm"
            >
              {SCRIPT_FORMATS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Language</Label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              className="h-9 w-40 rounded-md border border-input bg-background px-2 text-sm"
            >
              {LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
          <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? "Generating…" : "Generate scaffold"}
          </Button>
        </div>
      </section>

      <ScriptGeneratorPanel
        storyId={id}
        packetId={packet?.id ?? null}
        onGenerated={(sid) => setActiveId(sid)}
      />

      <Tabs defaultValue="editor">
        <TabsList>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="clips">Clip ideas</TabsTrigger>
          <TabsTrigger value="assets">Supporting assets</TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="mt-4 grid gap-3 lg:grid-cols-[260px_1fr]">
          <div className="space-y-2">
            {(scripts ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No scripts for this story yet.</p>
            ) : (
              (scripts ?? []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveId(s.id)}
                  className={
                    "w-full rounded-lg border px-3 py-2 text-left " +
                    (s.id === activeId ? "border-primary bg-accent" : "border-border bg-card")
                  }
                >
                  <p className="truncate text-xs font-medium">{s.title}</p>
                  {s.series_key ? (
                    <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                      Pack {s.series_key.slice(-6)} ·{" "}
                      {s.series_part === 0 ? "Long-form" : `Short ${s.series_part}`}
                    </p>
                  ) : null}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <StatusBadge value={s.status} />
                    <span className="text-[10px] text-muted-foreground">
                      {fmtDateTime(s.updated_at)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="space-y-2">
            {active ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={active.status}
                    onChange={(e) => setStatus.mutate(e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    aria-label="Script status"
                  >
                    {SCRIPT_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <Button size="sm" onClick={() => saveBody.mutate()} disabled={saveBody.isPending}>
                    {saveBody.isPending ? "Saving…" : "Save version"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(body).catch((error: unknown) => {
                        console.error(error);
                        process.exitCode = 1;
                      });
                      toast.success("Script copied");
                    }}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const blob = new Blob([body], { type: "text/markdown" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${active.title ?? "script"}.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Export
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => addPublication.mutate("YouTube")}
                  >
                    Track publication
                  </Button>
                </div>

                <ScriptMetaStrip script={active} />

                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={26}
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Word count: {body.trim() ? body.trim().split(/\s+/).length : 0} · approx spoken
                  time: {Math.round((body.trim() ? body.trim().split(/\s+/).length : 0) / 150)} min
                </p>

                <ScriptEvidenceList scriptId={active.id} />
                <ScriptAuditPanel scriptId={active.id} />
                <ResearchGapsPanel scriptId={active.id} />
              </>
            ) : (
              <EmptyState
                title="No script selected"
                description="Generate a scaffold or pick an existing script to edit."
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="clips" className="mt-4">
          <SectionTitle
            title="Clip-first Shorts"
            description="Every research packet should produce these standalone Shorts."
          />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {CLIP_IDEAS.map((idea) => (
              <div key={idea} className="rounded-lg border border-border bg-card p-3 text-sm">
                {idea}
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="assets" className="mt-4">
          <SectionTitle
            title="Supporting assets"
            description="Create placeholder assets and finish them in the Content Library."
          />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {SUPPORTING_ASSETS.map((a) => (
              <div
                key={a.key}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-3"
              >
                <span className="text-sm">{a.label}</span>
                <Button size="sm" variant="outline" onClick={() => makeAsset.mutate(a.key)}>
                  Create
                </Button>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <Disclaimer />
    </div>
  );
}
