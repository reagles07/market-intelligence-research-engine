/**
 * Evidence-constrained auto repair (server only).
 *
 * Runs ONCE between the initial audit and the final re-audit. The model may
 * only do four things to a failing sentence:
 *   REMOVE     delete an unsupportable claim
 *   CORRECT    replace a wrong number with the value the packet holds
 *   ATTRIBUTE  name the analyst, firm or management behind an opinion
 *   QUALIFY    turn a deterministic forecast into a conditional
 *
 * It may NOT introduce a new fact, do research, or use model knowledge. Every
 * proposed replacement is validated in code: any number in the new sentence
 * that is neither in the original sentence nor in the research packet causes
 * the item to be rejected outright.
 */
import {
  buildScriptContext,
  scriptContextMessage,
  CONTENT_MODE_RULES,
  type Db,
} from "@/lib/ai/script-context.server";
import { collectResearchNumbers } from "@/lib/ai/precheck.server";
import {
  rebalanceScriptJsonSchema,
  rebalanceScriptValidator,
  repairScriptJsonSchema,
  repairScriptValidator,
} from "@/lib/ai/script-schemas";
import {
  compressionInstruction,
  expansionInstruction,
  interiorTarget,
  loadStyleProfile,
} from "@/lib/ai/style.server";
import { runAuditScript } from "@/lib/ai/audit.server";
import { extractNumericMentions, relDiff } from "@/lib/content/numeric";
import { countWords, estimateSeconds } from "@/lib/content/domain";
import { shortWordBudget } from "@/lib/content/style";
import { contentHash } from "@/lib/content/hash";
import { callStructured, resolveModel } from "@/lib/openai.server";

/** Shorts carry a spoken word band; long-form is governed by its own outline. */
function isShortFormat(format: string | null | undefined): boolean {
  return String(format ?? "").startsWith("short");
}

type Failing = {
  id: string;
  section_id: string | null;
  section_key: string | null;
  statement_text: string;
  status: string;
  severity: string;
  issue: string | null;
  research_value: string | null;
  script_value: string | null;
  recommended_wording: string | null;
  origin: string;
};

const REPAIR_RULES = `TASK: repair a script that failed its fact check. You are a corrector, not a writer.

PERMITTED OPERATIONS ONLY:
- REMOVE — delete the sentence because nothing in the research supports it.
- CORRECT — replace an incorrect number, unit, currency or period with the value the
  research packet actually holds.
- ATTRIBUTE — keep the substance but name the analyst, firm, publication or management
  the research attributes it to.
- QUALIFY — turn a deterministic statement into a conditional or hedged one.
- KEEP — only when the audit finding is clearly wrong and the sentence is already correct.

ABSOLUTELY PROHIBITED:
- Introducing ANY fact, number, date, name or opinion that is not already in the Script
  Context or in the original sentence.
- Performing research, or using anything you know about this company from training.
- Rewriting for style, tone or flow. Change nothing that the audit did not flag.
- Making a sentence longer than it needs to be — replacements should be similar length.

QUALIFICATION RULES (these two failure shapes must be repaired, not removed, when the
underlying evidence exists):
1. INFORMATION GAP STATED AS A FILING FACT. When the script says a reason is "missing",
   that is a statement about what the filing does NOT contain. Rewrite it as an explicit
   observation about the evidence the packet holds — e.g. "indha filing-la … pathi
   vivaram illa" — never as a claim that the company withheld or hid something, and never
   as an assertion about the world beyond the filing.
2. INFERENCE PRESENTED AS A CONCLUSION. A market read, a "bearish/bullish" verdict or a
   cause-and-effect reading is an INFERENCE, not a fact. Keep it only if you mark it as a
   reading of the evidence ("… nu therigiradhu", "… nu paakalaam", "one way to read this
   is …"), naming the evidence it is read from. An unqualified verdict must be QUALIFIED
   or REMOVED.

CLAIM CATEGORY RULES:
- FACT — preserve the factual meaning exactly; never soften a verified figure into a guess.
- INFERENCE — must be explicitly marked as a reading of the evidence. Never promote an
  INFERENCE to a FACT just to make the sentence shorter or cleaner.
- COMPANY CLAIM / ANALYST VIEW — keep only with the attribution the packet holds.
- UNSUPPORTED — may not survive into the final script: CORRECT it against the packet or REMOVE it.

PHRASING THAT THE AUDITOR REJECTS (do not use it):
- "… nu packet support pannala" / "the packet does not support …" — this reads as a verdict on
  the world. Say what the evidence CONTAINS instead: "packet-la … pathi evidence illa",
  "available filing data mattum paatha, … nu conclude panna evidence illa".
- A scenario turned into a takeaway. Bull/base/bear content must name the scenario it comes
  from: "packet-oda bear scenario-padi …", "bull case-la ipdi paakuraanga …" — followed by a
  hedge ("… nu paakalaam", "… nu therigiradhu"). Never present a scenario as what IS true, and
  never present it as the packet's own conclusion.
- "… nu solla mudiyadhu" attached to a metric read, without saying whose read it is.

EDITORIAL / METHOD GUIDANCE. A sentence that tells the viewer how to READ the data ("interpret
it on a financial_periods basis", "watch the next disclosures") is not a company statement, an
analyst view or guidance, and it must not be dressed up as one. If the auditor flags such a
sentence for missing attribution, rewrite it as a plain viewer-directed instruction in the
imperative ("… nu paarunga", "… follow pannunga") with no evaluative verdict words like
"safer", "better", "correct" — never invent an analyst or a management source for it.

EVIDENCE-SCOPE RULE. "The evidence does not establish X" is NOT the same statement as "X is
false" and NOT the same as "not-X is true". When the script comments on what the data does or
does not show, scope it to the evidence you actually have ("available filing data mattum paatha,
… nu conclude panna evidence illa") rather than asserting the opposite conclusion.

Write the replacement in the SAME language and register as the original (Tanglish stays
Tanglish). When you correct a number, cite the metric key or claim id that justifies it.
When you cannot repair a sentence with the evidence available, choose REMOVE.`;

/** Numbers allowed to appear in a replacement sentence. */
function allowedNumbers(original: string, research: number[]): number[] {
  const own = extractNumericMentions(original, null)
    .map((m) => m.value)
    .filter((v): v is number => v !== null);
  return [...own, ...research];
}

/**
 * A repair may not smuggle in a date or fiscal period either. Temporal tokens are
 * excluded from the numeric comparison above (they are validated against filing
 * evidence, not against metric values), so they get their own containment check:
 * every date/period in the replacement must already exist in the sentence it
 * replaces or in the packet context the audit ran against.
 */
function introducesNewTemporal(
  original: string,
  replacement: string,
  contextText: string,
): string | null {
  const haystack = `${original} ${contextText}`.toLowerCase().replace(/\s+/g, " ");
  for (const m of extractNumericMentions(replacement, null)) {
    if (m.kind !== "date" && m.kind !== "period") continue;
    const needle = m.raw.toLowerCase().replace(/\s+/g, " ").trim();
    if (needle && !haystack.includes(needle)) return m.raw;
  }
  return null;
}

function introducesNewNumber(
  original: string,
  replacement: string,
  research: number[],
): string | null {
  const allowed = allowedNumbers(original, research);
  for (const m of extractNumericMentions(replacement, null)) {
    if (m.value === null || m.kind === "date" || m.kind === "period") continue;
    const ok = allowed.some((a) => relDiff(a, m.value!) <= 0.005);
    if (!ok) return m.raw;
  }
  return null;
}

export async function runScriptRepair(
  db: Db,
  args: { scriptId: string; auditId?: string | null; model?: string | null; userId: string },
) {
  const { data: script } = await db
    .from("scripts")
    .select("id,title,body,status,language,format,packet_id,style_profile_id,target_duration")
    .eq("id", args.scriptId)
    .maybeSingle();
  if (!script) throw new Error("Script not found");
  if (!script.packet_id) throw new Error("This script is not linked to a research packet.");
  if (["Approved", "Published"].includes(script.status)) {
    return {
      ok: false as const,
      error: "An approved or published script cannot be auto-repaired.",
    };
  }

  const { data: audit } = args.auditId
    ? await db.from("script_audits").select("*").eq("id", args.auditId).maybeSingle()
    : await db
        .from("script_audits")
        .select("*")
        .eq("script_id", script.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  if (!audit) return { ok: false as const, error: "Run the fact check before repairing." };

  const { data: rows } = await db
    .from("script_statements")
    .select(
      "id,section_id,section_key,statement_text,status,severity,issue,research_value,script_value,recommended_wording,origin",
    )
    .eq("audit_id", audit.id)
    .in("severity", ["Blocking", "Warning"]);

  const failing = (rows ?? []) as Failing[];
  if (!failing.length) {
    return {
      ok: false as const,
      error: "Nothing to repair — the audit found no blocking or warning statements.",
    };
  }

  const ctx = await buildScriptContext(db, { packetId: script.packet_id });
  const researchNumbers = collectResearchNumbers(ctx).map((r) => r.value);
  const contextText = `${scriptContextMessage(ctx, "")} ${script.body ?? ""}`;
  const model = resolveModel(args.model ?? null);

  // The word budget is a repair objective, not an afterthought: fixing a
  // qualification and hitting the spoken band in one evidence-locked pass beats
  // repair → expand → repair, which drifts and costs three model calls.
  const budget = isShortFormat(script.format)
    ? shortWordBudget(
        (await loadStyleProfile(db, script.style_profile_id ?? null))?.wordBudgets ?? {},
        script.target_duration ?? script.format,
      )
    : null;
  const startWordCount = countWords(script.body ?? "");
  const aim = budget ? interiorTarget(budget) : null;
  const budgetObjective =
    budget && aim
      ? `\n\nWORD BUDGET OBJECTIVE (applies to the whole script, not one sentence)
The script currently runs ${startWordCount} spoken words. The delivered format requires
${budget.low}–${budget.high} words; aim for ${aim.low}–${aim.high}. ${
          startWordCount < budget.low
            ? `It is UNDER the floor, so your replacements should be LONGER than the sentences they replace: add the attribution, period, scope or hedge that the evidence already carries.`
            : startWordCount > budget.high
              ? `It is OVER the ceiling, so your replacements should be SHORTER than the sentences they replace.`
              : `It is inside the band, so keep replacements about the same length.`
        }
You may only add words that carry supported information: an attribution already in the packet,
the period or scope a cited figure already has, or the hedge an inference needs. Never add a new
number, date, metric, price, forecast, opinion or generic filler ("so guys", "overall-a paatha").`
      : "";

  const listed = failing
    .map(
      (f, i) =>
        `[${i}] ${f.status} (${f.severity}, ${f.origin}) section=${f.section_key ?? "?"}\n     sentence: ${f.statement_text}\n     issue: ${f.issue ?? "—"}\n     research holds: ${f.research_value ?? "—"} · script says: ${f.script_value ?? "—"}${f.recommended_wording ? `\n     auditor suggested: ${f.recommended_wording}` : ""}`,
    )
    .join("\n");

  const res = await callStructured({
    operation: "repair-script-from-audit",
    mode: "DATABASE",
    model,
    instructions: `${CONTENT_MODE_RULES}\n\n${REPAIR_RULES}${budgetObjective}`,
    input: scriptContextMessage(
      ctx,
      `Repair these ${failing.length} failing statements from script "${script.title}" (${script.language}), packet v${ctx.packet.version}.\n\nFAILING STATEMENTS:\n${listed}`,
    ),
    schemaName: "repair_script",
    jsonSchema: repairScriptJsonSchema,
    validator: repairScriptValidator,
    webSearch: false,
    maxOutputTokens: 20000,
    refs: {
      companyId: ctx.packet.companyId,
      storyId: ctx.packet.storyId,
      packetId: ctx.packet.id,
      scriptId: script.id,
    },
    userId: args.userId,
  });
  if (!res.ok)
    return { ok: false as const, error: res.error, needsHumanReview: res.needsHumanReview };

  const validClaims = new Set(ctx.claimIds);
  const validSources = new Set(ctx.sourceIds);
  const validMetrics = new Set(ctx.metricKeys);

  type Applied = {
    findingIndex: number;
    statementId: string;
    action: string;
    original: string;
    replacement: string | null;
    accepted: boolean;
    rejectedReason: string | null;
    reason: string;
  };

  const applied: Applied[] = [];

  for (const item of res.data.items) {
    const f = failing[item.finding_index];
    if (!f) continue;

    let accepted = true;
    let rejected: string | null = null;
    let replacement: string | null = item.action === "REMOVE" ? "" : (item.new_text ?? null);

    if (item.action === "KEEP") {
      accepted = false;
      rejected = "Auditor finding kept — no change applied.";
      replacement = null;
    } else if (item.action !== "REMOVE") {
      if (!replacement || !replacement.trim()) {
        accepted = false;
        rejected = "No replacement sentence was produced.";
      } else {
        const invented =
          introducesNewNumber(f.statement_text, replacement, researchNumbers) ??
          introducesNewTemporal(f.statement_text, replacement, contextText);
        if (invented) {
          accepted = false;
          rejected = `Rejected: the replacement introduces "${invented}", which is in neither the original sentence nor the research packet.`;
        }
        // A cited id must exist in the packet.
        if (
          accepted &&
          ((item.evidence_claim_id && !validClaims.has(item.evidence_claim_id)) ||
            (item.evidence_source_id && !validSources.has(item.evidence_source_id)) ||
            (item.evidence_metric_key && !validMetrics.has(item.evidence_metric_key)))
        ) {
          accepted = false;
          rejected = "Rejected: the cited evidence id does not exist in the research packet.";
        }
      }
    }

    applied.push({
      findingIndex: item.finding_index,
      statementId: f.id,
      action: item.action,
      original: f.statement_text,
      replacement,
      accepted,
      rejectedReason: rejected,
      reason: item.reason,
    });
  }

  // ---- Apply accepted edits deterministically to the sections and the body.
  const { data: sections } = await db
    .from("script_sections")
    .select("id,spoken_text,order_index")
    .eq("script_id", script.id)
    .order("order_index", { ascending: true });

  const edits = applied.filter((a) => a.accepted && a.replacement !== null);
  const patch = (text: string) => {
    let out = text;
    for (const e of edits) {
      if (!out.includes(e.original)) continue;
      out = out.replace(e.original, e.replacement === "" ? "" : e.replacement!);
    }
    return out
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  let changedSections = 0;
  const patched = (sections ?? []).map((s) => ({ ...s, spoken_text: patch(s.spoken_text) }));
  for (const s of patched) {
    const before = (sections ?? []).find((o) => o.id === s.id)?.spoken_text ?? "";
    if (s.spoken_text !== before) {
      changedSections++;
      await db.from("script_sections").update({ spoken_text: s.spoken_text }).eq("id", s.id);
    }
  }

  let newBody = patch(script.body ?? "");

  // ---- Word-budget repair. BOTH bounds are constraints: repairs that removed
  // sentences routinely drop a Short under its floor, which is as much a defect
  // as overshooting. The rebalance is evidence-locked — any number it adds that
  // is not already present is rejected and the rebalance is discarded.
  let rebalance: {
    direction: "EXPAND" | "COMPRESS";
    from: number;
    to: number;
    notes: string;
  } | null = null;
  let rebalanceDiscarded: string | null = null;

  if (budget && patched.length) {
    let current = patched.map((s) => ({ id: s.id, spoken_text: s.spoken_text }));
    const startWords = current.reduce((n, s) => n + countWords(s.spoken_text), 0);

    // At most ONE additional duration pass after the combined repair — the
    // repair itself already carried the budget objective, so a loop here only
    // burns calls and drifts the wording away from the audited evidence.
    for (let attempt = 0; attempt < 1; attempt++) {
      const spokenWords = current.reduce((n, s) => n + countWords(s.spoken_text), 0);
      const tooShort = spokenWords < budget.low;
      const tooLong = spokenWords > budget.high;
      if (!tooShort && !tooLong) break;

      const res2 = await callStructured({
        operation: tooShort ? "expand-repaired-script" : "compress-repaired-script",
        mode: "DATABASE",
        model,
        instructions: `${CONTENT_MODE_RULES}\n\n${
          tooShort
            ? expansionInstruction(budget, spokenWords)
            : compressionInstruction(budget, spokenWords)
        }\n\nReturn every section, with its id unchanged.`,
        input: scriptContextMessage(
          ctx,
          `${tooShort ? "Expand" : "Trim"} the repaired script "${script.title}" (${script.language}) to ${budget.low}–${budget.high} spoken words; it is currently ${spokenWords}. SECTIONS (JSON):\n${JSON.stringify(
            current.map((s) => ({ section_id: s.id, spoken_text: s.spoken_text })),
          )}`,
        ),
        schemaName: "rebalance_script",
        jsonSchema: rebalanceScriptJsonSchema,
        validator: rebalanceScriptValidator,
        webSearch: false,
        maxOutputTokens: 9000,
        refs: {
          companyId: ctx.packet.companyId,
          storyId: ctx.packet.storyId,
          packetId: ctx.packet.id,
          scriptId: script.id,
        },
        userId: args.userId,
      });

      if (!res2.ok) {
        rebalanceDiscarded = res2.error;
        break;
      }

      const byId = new Map(current.map((s) => [s.id, s.spoken_text]));
      let invented: string | null = null;
      for (const s of res2.data.sections) {
        const original = byId.get(s.section_id);
        if (original === undefined) continue;
        invented ??=
          introducesNewNumber(original, s.spoken_text, researchNumbers) ??
          introducesNewTemporal(original, s.spoken_text, contextText);
      }
      const next = current.map((s) => {
        const found = res2.data.sections.find((x) => x.section_id === s.id);
        return { ...s, spoken_text: found ? found.spoken_text : s.spoken_text };
      });
      const nextWords = next.reduce((n, s) => n + countWords(s.spoken_text), 0);
      const aimBand = interiorTarget(budget);
      const target = tooShort ? aimBand.low : aimBand.high;
      const inBand = nextWords >= budget.low && nextWords <= budget.high;
      const closer = inBand || Math.abs(nextWords - target) < Math.abs(spokenWords - target);

      if (invented) {
        rebalanceDiscarded = `Rebalance discarded: it introduced "${invented}", which is in neither the script nor the research packet.`;
        break;
      }
      if (!closer) {
        rebalanceDiscarded = `Rebalance discarded: ${spokenWords} → ${nextWords} words did not move toward the ${budget.low}–${budget.high} band.`;
        break;
      }

      current = next;
      rebalance = {
        direction: tooShort ? "EXPAND" : "COMPRESS",
        from: startWords,
        to: nextWords,
        notes: res2.data.notes,
      };
    }

    if (rebalance) {
      for (const s of current) {
        const before = patched.find((p) => p.id === s.id)?.spoken_text ?? "";
        if (s.spoken_text !== before) {
          changedSections++;
          await db.from("script_sections").update({ spoken_text: s.spoken_text }).eq("id", s.id);
          if (before && newBody.includes(before)) newBody = newBody.replace(before, s.spoken_text);
        }
      }
    }
  }

  const words = countWords(newBody);

  const removed = applied.filter((a) => a.accepted && a.action === "REMOVE").length;
  const corrected = applied.filter((a) => a.accepted && a.action === "CORRECT").length;
  const attributed = applied.filter((a) => a.accepted && a.action === "ATTRIBUTE").length;
  const qualified = applied.filter((a) => a.accepted && a.action === "QUALIFY").length;

  const { data: lastVersion } = await db
    .from("script_versions")
    .select("version")
    .eq("script_id", script.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (lastVersion?.version ?? 0) + 1;

  await db
    .from("scripts")
    .update({
      body: newBody,
      word_count: words,
      estimated_duration_sec: estimateSeconds(words),
      body_hash: contentHash(newBody),
      status: "Needs Fact Check",
      audit_status: "Not Audited",
    })
    .eq("id", script.id);

  await db.from("script_versions").insert({
    script_id: script.id,
    version,
    body: newBody,
    note: `Evidence-constrained auto repair · ${corrected} corrected · ${attributed} attributed · ${qualified} qualified · ${removed} removed`,
    packet_id: ctx.packet.id,
    research_packet_version: ctx.packet.version,
    model,
    audit_status: "Not Audited",
    created_by: args.userId,
  });

  const { data: repair, error: repairError } = await db
    .from("script_repairs")
    .insert({
      script_id: script.id,
      initial_audit_id: audit.id,
      packet_id: ctx.packet.id,
      packet_version: ctx.packet.version,
      script_version: version,
      status: edits.length ? "APPLIED" : "NO_CHANGE",
      items_total: applied.length,
      corrected,
      attributed,
      qualified,
      removed,
      items: applied as never,
      notes: [
        res.data.notes,
        rebalance
          ? `Word budget ${rebalance.direction.toLowerCase()}: ${rebalance.from} → ${rebalance.to} words (${rebalance.notes})`
          : null,
        rebalanceDiscarded,
      ]
        .filter(Boolean)
        .join(" · "),
      model,
      estimated_cost_usd: res.usage.estimatedCostUsd,
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (repairError || !repair) throw new Error(repairError?.message ?? "Could not save the repair");

  return {
    ok: true as const,
    repairId: repair.id,
    scriptId: script.id,
    scriptVersion: version,
    itemsTotal: applied.length,
    accepted: edits.length,
    rejected: applied.filter((a) => !a.accepted).length,
    corrected,
    attributed,
    qualified,
    removed,
    changedSections,
    items: applied,
    notes: res.data.notes,
    rebalance,
    rebalanceDiscarded,
    model,
    usage: res.usage,
  };
}

/**
 * The full hardened pipeline for an existing script:
 *   audit → (one repair + re-audit when it failed) → readiness gate.
 */
export async function runAuditRepairCycle(
  db: Db,
  args: { scriptId: string; model?: string | null; userId: string; allowRepair?: boolean },
) {
  const first = await runAuditScript(db, {
    scriptId: args.scriptId,
    model: args.model ?? null,
    userId: args.userId,
    pass: 1,
  });
  if (!first.ok) return first;
  if (first.readyForReview || args.allowRepair === false) {
    return { ...first, repaired: false as const, repair: null, finalAudit: first };
  }

  const repair = await runScriptRepair(db, {
    scriptId: args.scriptId,
    auditId: first.auditId,
    model: args.model ?? null,
    userId: args.userId,
  });
  if (!repair.ok) return { ...first, repaired: false as const, repair, finalAudit: first };

  const second = await runAuditScript(db, {
    scriptId: args.scriptId,
    model: args.model ?? null,
    userId: args.userId,
    pass: 2,
    repairId: repair.repairId,
  });
  if (!second.ok) return { ...first, repaired: true as const, repair, finalAudit: first };

  await db
    .from("script_repairs")
    .update({
      final_audit_id: second.auditId,
      status: second.readyForReview ? "RESOLVED" : "UNRESOLVED",
    })
    .eq("id", repair.repairId);
  await db.from("scripts").update({ last_repair_id: repair.repairId }).eq("id", args.scriptId);

  // Anything still failing after the one permitted repair is an evidence gap,
  // not a wording problem — triage it so a human sees what research is missing.
  const gaps = second.readyForReview
    ? null
    : await detectGapsQuietly(db, {
        scriptId: args.scriptId,
        auditId: second.auditId,
        model: args.model ?? null,
        userId: args.userId,
      });

  return {
    ...second,
    initialAudit: first,
    repaired: true as const,
    repair,
    finalAudit: second,
    gaps,
  };
}

/** Gap triage must never make the fact check itself fail. */
async function detectGapsQuietly(
  db: Db,
  args: { scriptId: string; auditId: string; model: string | null; userId: string },
) {
  try {
    const { runDetectResearchGaps } = await import("@/lib/ai/gaps.server");
    const r = await runDetectResearchGaps(db, args);
    return r.ok ? { gapsCreated: r.gapsCreated, summary: r.summary ?? null } : null;
  } catch {
    return null;
  }
}
