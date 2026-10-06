import { reportAsyncError } from "@/lib/async-errors";
/**
 * AI script generation controls for one story.
 *
 * Generation reads ONE research packet version and never performs research.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ElapsedIndicator } from "@/components/common/elapsed";
import { SectionTitle } from "@/components/common/ui-bits";
import { useAiModel } from "@/components/providers/use-ai-model";
import {
  generateContentPack,
  generateContentPackage,
  generateLongScript,
  generateShortScript,
  generateShortSeries,
  getCreatorIdentity,
  listStyleProfiles,
  updateCreatorIdentity,
} from "@/lib/ai/script.functions";
import { DEFAULT_STYLE_PROFILE_NAME, formatWordRange, shortWordBudget } from "@/lib/content/style";
import {
  CONTENT_PACK_MIN_SHORTS,
  DEFAULT_PLATFORM,
  DEFAULT_TARGET_DURATION,
  DEFAULT_TONE,
  PLATFORMS,
  SCRIPT_TONES,
  SHORT_ANGLES,
  SHORT_ANGLE_PLAN,
  SHORT_DURATIONS,
  TARGET_DURATIONS,
  formatDuration,
  type Platform,
  type ScriptTone,
  type ShortDurationKey,
  type TargetDurationKey,
} from "@/lib/content/domain";
import { LANGUAGES, type Language } from "@/lib/domain";
import { runFactSprintFn } from "@/lib/research/fact-sprint.functions";

type Result = Record<string, unknown> & { ok?: boolean; error?: string };

const selectCls = "h-9 rounded-md border border-input bg-background px-2 text-sm";

type MissingCategory = { key: string; label: string; question: string; optional: boolean };

/**
 * When the deterministic long-form precheck blocks generation, name exactly
 * which facts are missing and offer the bounded fact sprint that targets them.
 * Generation itself stays blocked until the packet is rebuilt.
 */
function BlockedFactSprintCta({ storyId, result }: { storyId: string; result: Result }) {
  const qc = useQueryClient();
  const { model } = useAiModel();
  const sprintFn = useServerFn(runFactSprintFn);

  const long = (result["long"] as Record<string, unknown> | undefined) ?? result;
  const missing = (long["missingCategories"] as MissingCategory[] | undefined) ?? [];
  const sprint = useMutation({
    mutationFn: async () =>
      (await sprintFn({
        data: { storyId, gapKeys: missing.map((m) => m.key), model },
      })) as Record<string, unknown>,
    onSuccess: (r) => {
      if (!r["ok"]) return void toast.error(String(r["error"] ?? "Fact sprint failed"));
      const s = (r["summary"] ?? {}) as Record<string, number>;
      toast.success(
        `${s["gapsFilled"] ?? 0}/${s["gapsTargeted"] ?? 0} gaps filled · ${s["sourcesAdded"] ?? 0} sources added`,
      );
      qc.invalidateQueries({ queryKey: ["fact-sprint", storyId] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["packet", storyId] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!missing.length) return null;
  return (
    <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
      <p className="font-medium text-amber-700 dark:text-amber-400">Missing facts for long-form</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
        {missing.map((m) => (
          <li key={m.key}>
            {m.label}
            {m.optional ? " (only if the story needs it)" : ""}
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="outline"
        className="mt-2 h-7 text-xs"
        disabled={sprint.isPending}
        onClick={() => sprint.mutate()}
      >
        {sprint.isPending ? "Running fact sprint…" : "Run fact sprint to fill these gaps"}
      </Button>
      <ElapsedIndicator active={sprint.isPending} step="Searching official sources" />
    </div>
  );
}

export function ScriptGeneratorPanel({
  storyId,
  packetId,
  onGenerated,
}: {
  storyId: string;
  packetId: string | null;
  onGenerated: (scriptId: string) => void;
}) {
  const qc = useQueryClient();
  const { model } = useAiModel();

  const [duration, setDuration] = useState<TargetDurationKey>(DEFAULT_TARGET_DURATION);
  const [shortDuration, setShortDuration] = useState<ShortDurationKey>("short_60");
  const [angle, setAngle] = useState<string>(SHORT_ANGLES[0]);
  const [language, setLanguage] = useState<Language>("Tanglish");
  const [tone, setTone] = useState<ScriptTone>(DEFAULT_TONE);
  const [platform, setPlatform] = useState<Platform | "">("");
  const [last, setLast] = useState<Result | null>(null);
  const [styleProfileId, setStyleProfileId] = useState<string>("");
  const [identityOpen, setIdentityOpen] = useState(false);
  const [channelDraft, setChannelDraft] = useState<string | null>(null);
  const [hostDraft, setHostDraft] = useState<string | null>(null);

  const stylesFn = useServerFn(listStyleProfiles);
  const { data: styles } = useQuery({
    queryKey: ["script-style-profiles"],
    queryFn: () => stylesFn(),
  });

  const identityFn = useServerFn(getCreatorIdentity);
  const { data: identity } = useQuery({
    queryKey: ["creator-identity"],
    queryFn: () => identityFn(),
  });
  const saveIdentityFn = useServerFn(updateCreatorIdentity);
  const saveIdentity = useMutation({
    mutationFn: async () =>
      saveIdentityFn({
        data: {
          channelName: channelDraft ?? identity?.channelName ?? "",
          hostName: hostDraft ?? identity?.hostName ?? "",
          defaultPlatform: (platform || identity?.defaultPlatform || DEFAULT_PLATFORM) as Platform,
        },
      }),
    onSuccess: () => {
      toast.success("Creator identity saved");
      setChannelDraft(null);
      setHostDraft(null);
      qc.invalidateQueries({ queryKey: ["creator-identity"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activePlatform: Platform = (platform ||
    identity?.defaultPlatform ||
    DEFAULT_PLATFORM) as Platform;

  const activeStyle =
    (styles ?? []).find((s) => s.id === styleProfileId) ??
    (styles ?? []).find((s) => s.isDefault) ??
    (styles ?? [])[0] ??
    null;
  const styleId = activeStyle?.id;
  const shortBudget = shortWordBudget(activeStyle?.wordBudgets ?? {}, shortDuration);
  const longDef = TARGET_DURATIONS.find((d) => d.key === duration) ?? TARGET_DURATIONS[2];
  const longBudget = {
    low: Math.round((longDef.lowSec / 60) * 150),
    high: Math.round((longDef.highSec / 60) * 150),
  };

  const longFn = useServerFn(generateLongScript);
  const shortFn = useServerFn(generateShortScript);
  const seriesFn = useServerFn(generateShortSeries);
  const packageFn = useServerFn(generateContentPackage);
  const packFn = useServerFn(generateContentPack);

  function settle(res: Result, label: string) {
    setLast(res);
    if (!res.ok) {
      toast.error(res.error ?? `${label} failed`);
      return;
    }
    toast.success(`${label} complete`);
    qc.invalidateQueries({ queryKey: ["story-scripts", storyId] }).catch((error: unknown) =>
      reportAsyncError(error, "refresh"),
    );
    qc.invalidateQueries({ queryKey: ["content-assets"] }).catch((error: unknown) =>
      reportAsyncError(error, "refresh"),
    );
    const id = res["scriptId"];
    if (typeof id === "string") onGenerated(id);
  }

  const longRun = useMutation({
    mutationFn: async () =>
      (await longFn({
        data: {
          storyId,
          packetId: packetId ?? undefined,
          targetDuration: duration,
          language,
          tone,
          platform: activePlatform,
          model,
          styleProfileId: styleId,
        },
      })) as Result,
    onSuccess: (r) => settle(r, "Long-form script"),
    onError: (e: Error) => toast.error(e.message),
  });

  const shortRun = useMutation({
    mutationFn: async () =>
      (await shortFn({
        data: {
          storyId,
          packetId: packetId ?? undefined,
          duration: shortDuration,
          angle,
          language,
          tone,
          platform: activePlatform,
          model,
          styleProfileId: styleId,
        },
      })) as Result,
    onSuccess: (r) => settle(r, "Short script"),
    onError: (e: Error) => toast.error(e.message),
  });

  const seriesRun = useMutation({
    mutationFn: async () =>
      (await seriesFn({
        data: {
          storyId,
          packetId: packetId ?? undefined,
          language,
          tone,
          platform: activePlatform,
          model,
          styleProfileId: styleId,
        },
      })) as Result,
    onSuccess: (r) => settle(r, `${CONTENT_PACK_MIN_SHORTS} Shorts`),
    onError: (e: Error) => toast.error(e.message),
  });

  const contentPackRun = useMutation({
    mutationFn: async () =>
      (await packFn({
        data: {
          storyId,
          packetId: packetId ?? undefined,
          targetDuration: duration,
          language,
          tone,
          platform: activePlatform,
          model,
          styleProfileId: styleId,
        },
      })) as Result,
    onSuccess: (r) => {
      setLast(r);
      const shortCount = Number(r["shortCount"] ?? 0);
      const longId = r["longScriptId"];
      if (!r.ok) {
        toast.error(r.error ?? "Content pack failed");
      } else {
        toast.success(
          `Content pack: ${shortCount} Shorts${longId ? " + 1 long-form script" : " (long-form blocked)"}`,
        );
      }
      const blocked = [r["shortsBlockedReason"], r["longBlockedReason"]].filter(
        (v): v is string => typeof v === "string",
      );
      for (const b of blocked) toast.warning(b);
      qc.invalidateQueries({ queryKey: ["story-scripts", storyId] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["scripts"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      if (typeof longId === "string") onGenerated(longId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const packRun = useMutation({
    mutationFn: async () =>
      (await packageFn({
        data: {
          storyId,
          packetId: packetId ?? undefined,
          language,
          model,
          styleProfileId: styleId,
        },
      })) as Result,
    onSuccess: (r) => {
      setLast(r);
      if (!r.ok) return void toast.error(r.error ?? "Content package failed");
      toast.success("Content package saved to the library");
      qc.invalidateQueries({ queryKey: ["content-assets"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy =
    longRun.isPending ||
    shortRun.isPending ||
    seriesRun.isPending ||
    packRun.isPending ||
    contentPackRun.isPending;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <SectionTitle
        title="AI script generation"
        description="Written only from the verified research packet — the model performs no new research and states nothing it cannot trace."
      />

      {!packetId ? (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Build a research packet in the story workspace before generating scripts.
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Writing style</Label>
          <select
            value={activeStyle?.id ?? ""}
            onChange={(e) => setStyleProfileId(e.target.value)}
            className={`${selectCls} w-80`}
          >
            {(styles ?? []).length === 0 ? (
              <option value="">{DEFAULT_STYLE_PROFILE_NAME}</option>
            ) : (
              (styles ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · v{s.version}
                </option>
              ))
            )}
          </select>
          {activeStyle ? (
            <p className="text-[11px] text-muted-foreground">{activeStyle.languageStyle}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label>Language</Label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            className={`${selectCls} w-36`}
          >
            {LANGUAGES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Tone</Label>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value as ScriptTone)}
            className={`${selectCls} w-40`}
          >
            {SCRIPT_TONES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Platform</Label>
          <select
            value={activePlatform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
            className={`${selectCls} w-36`}
          >
            {PLATFORMS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            {activePlatform === "Instagram" ? "CTA asks for a follow" : "CTA asks for a subscribe"}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs">
            <span className="font-medium">Self intro:</span>{" "}
            {identity?.hostName || identity?.channelName ? (
              <span>{[identity?.hostName, identity?.channelName].filter(Boolean).join(" · ")}</span>
            ) : (
              <span className="text-muted-foreground">
                no name configured — scripts use a role-based intro and invent no name
              </span>
            )}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setIdentityOpen((v) => !v)}>
            {identityOpen ? "Close" : "Edit creator identity"}
          </Button>
        </div>
        {identityOpen ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="host-name">Host name</Label>
              <Input
                id="host-name"
                className="h-9 w-48"
                value={hostDraft ?? identity?.hostName ?? ""}
                onChange={(e) => setHostDraft(e.target.value)}
                placeholder="Leave blank for none"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="channel-name">Channel name</Label>
              <Input
                id="channel-name"
                className="h-9 w-56"
                value={channelDraft ?? identity?.channelName ?? ""}
                onChange={(e) => setChannelDraft(e.target.value)}
                placeholder="Leave blank for none"
              />
            </div>
            <Button
              size="sm"
              onClick={() => saveIdentity.mutate()}
              disabled={saveIdentity.isPending}
            >
              {saveIdentity.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-lg border border-primary/40 bg-primary/5 p-3">
        <p className="text-xs font-medium">
          Content pack — {CONTENT_PACK_MIN_SHORTS} distinct Shorts + 1 long-form script
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Angles: {SHORT_ANGLE_PLAN.map((a) => a.label).join(" · ")}. An angle the packet cannot
          evidence is replaced with another verified angle, never paraphrased.
        </p>
        <Button
          size="sm"
          className="mt-2"
          disabled={busy || !packetId}
          onClick={() => contentPackRun.mutate()}
        >
          {contentPackRun.isPending
            ? "Writing the pack…"
            : `Generate content pack (${CONTENT_PACK_MIN_SHORTS} Shorts + 1 long)`}
        </Button>
        <ElapsedIndicator active={busy} className="mt-2" />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium">Long-form video</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value as TargetDurationKey)}
              className={`${selectCls} w-56`}
              aria-label="Target duration"
            >
              {TARGET_DURATIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label} · {d.minutes}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-muted-foreground">
              target {formatWordRange(longBudget)}
            </span>
            <Button size="sm" disabled={busy || !packetId} onClick={() => longRun.mutate()}>
              {longRun.isPending ? "Writing…" : "Generate long script"}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium">Shorts</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <select
              value={shortDuration}
              onChange={(e) => setShortDuration(e.target.value as ShortDurationKey)}
              className={`${selectCls} w-48`}
              aria-label="Short duration"
            >
              {SHORT_DURATIONS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
            <select
              value={angle}
              onChange={(e) => setAngle(e.target.value)}
              className={`${selectCls} w-52`}
              aria-label="Short angle"
            >
              {SHORT_ANGLES.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <span className="text-[11px] text-muted-foreground">
              target {formatWordRange(shortBudget)}
            </span>
            <Button size="sm" disabled={busy || !packetId} onClick={() => shortRun.mutate()}>
              {shortRun.isPending ? "Writing…" : "Generate Short"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !packetId}
              onClick={() => seriesRun.mutate()}
            >
              {seriesRun.isPending ? "Writing…" : `Generate ${CONTENT_PACK_MIN_SHORTS} Shorts only`}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !packetId}
          onClick={() => packRun.mutate()}
        >
          {packRun.isPending
            ? "Building…"
            : "Generate content package (titles, thumbnails, B-roll)"}
        </Button>
      </div>

      {typeof last?.["packKey"] === "string" ? (
        <div className="mt-3 space-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          <p>
            Pack {String(last["packKey"])} · {String(last["shortCount"] ?? 0)} Shorts ·{" "}
            {last["longScriptId"] ? "1 long-form script" : "long-form not produced"} ·{" "}
            {last["metMinimumShorts"] ? "meets the 6-Short minimum" : "below the 6-Short minimum"}
          </p>
          {(() => {
            const long = last["long"] as Record<string, unknown> | undefined;
            if (!long?.["ok"]) return null;
            return (
              <>
                <p>Story angle: {String(long["storyAngle"] ?? "—")}</p>
                <p>
                  Company revealed around {String(long["revealPoint"] ?? "—")} ·{" "}
                  {String(long["retentionDeviceCount"] ?? "—")}{" "}
                  {String(long["retentionDeviceLabel"] ?? "retention loops")}
                </p>
                <p>Thesis: {String(long["keyThesis"] ?? "—")}</p>
                <p>Main risk: {String(long["mainRisk"] ?? "—")}</p>
              </>
            );
          })()}
          {(() => {
            const shorts = last["shorts"] as Record<string, unknown> | undefined;
            const note = shorts?.["uniquenessNote"];
            if (typeof note !== "string") return null;
            return (
              <p className="text-amber-700 dark:text-amber-400">
                Uniqueness check: {note}
                {shorts?.["uniquenessRetry"] ? " (one rewrite pass applied)" : ""}
              </p>
            );
          })()}
          {typeof last["longBlockedReason"] === "string" ? (
            <p className="text-amber-700 dark:text-amber-400">
              Long-form blocked: {String(last["longBlockedReason"])}
            </p>
          ) : null}
          <BlockedFactSprintCta storyId={storyId} result={last} />
        </div>
      ) : null}

      {last?.ok ? (
        <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          {typeof last["words"] === "number" ? (
            <span>
              {String(last["words"])} words · approx{" "}
              {formatDuration(Number(last["estimatedSeconds"] ?? 0))} spoken ·{" "}
            </span>
          ) : null}
          {typeof last["packetVersion"] === "number" ? (
            <span>research packet v{String(last["packetVersion"])} · </span>
          ) : null}
          {activeStyle ? (
            <span>
              style {activeStyle.name} v{activeStyle.version} ·{" "}
            </span>
          ) : null}
          {typeof last["targetWordLow"] === "number" ? (
            <span>
              target {String(last["targetWordLow"])}–{String(last["targetWordHigh"])} words ·{" "}
              {last["withinWordBudget"] ? "within budget" : "outside budget"}
              {last["compressionPass"] ? " after one compression pass" : ""} ·{" "}
            </span>
          ) : null}
          <span>model {String(last["model"] ?? "")}</span>
          {Array.isArray(last["missingInputs"]) && last["missingInputs"].length ? (
            <p className="mt-1 text-amber-700 dark:text-amber-400">
              Marked as insufficient data: {(last["missingInputs"] as string[]).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
