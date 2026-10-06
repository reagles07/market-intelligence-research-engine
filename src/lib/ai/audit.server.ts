/**
 * Final fact check (server only).
 *
 * Two operations:
 *   extract-script-claims — pull every factual sentence out of a generated script
 *   audit-script          — check each one against the SAME research packet version
 *                           that produced the script
 *
 * The model proposes; this file decides. Every blocking rule (numeric mismatch,
 * unattributed analyst/management statement, deterministic scenario, unresolved
 * conflict) is enforced in code so a compliant-sounding model reply can never
 * promote an unsafe script.
 */
import {
  NUMERIC_STATEMENT_TYPES,
  type AuditStatementStatus,
  type StatementType,
} from "@/lib/content/domain";
import {
  CONTENT_MODE_RULES,
  buildScriptContext,
  scriptContextMessage,
  type Db,
  type ScriptContext,
} from "@/lib/ai/script-context.server";
import {
  auditScriptJsonSchema,
  auditScriptValidator,
  extractStatementsJsonSchema,
  extractStatementsValidator,
  type ExtractStatementsOutput,
} from "@/lib/ai/script-schemas";
import { utilityModel } from "@/lib/ai/script.server";
import { loadStyleProfile } from "@/lib/ai/style.server";
import { runNumericPrecheck } from "@/lib/ai/precheck.server";
import { countWords } from "@/lib/content/domain";
import { contentHash } from "@/lib/content/hash";
import { shortWordBudget } from "@/lib/content/style";
import { runStyleQuality } from "@/lib/content/style-quality";
import { callStructured, resolveModel } from "@/lib/openai.server";

type Statement = ExtractStatementsOutput["statements"][number];

const EXTRACTION_RULES = `TASK: extract every sentence from the supplied script that makes a checkable
statement. A sentence qualifies when it contains any of: a number, a date, a percentage,
a price, a financial metric, an event, a management statement, an analyst opinion, a
historical assertion, a claim about the company or its business, a market reaction, or a
forecast/scenario.

Rules:
- Copy each sentence verbatim. Do not paraphrase, merge or split sentences.
- Ignore pure narration, questions to the viewer, CTAs and the disclaimer.
- Classify the statement type, and mark is_numeric when it carries a number, price,
  percentage or date.
- attribution_present is true only when the sentence itself names the analyst, firm,
  publication or "management/the company".
- hedged is true only when the sentence uses conditional or qualifying language
  ("if", "may", "could", "one reading is", "suggests").
- The script may be in Tanglish or Tamil. Extract the sentence in its original language.`;

async function loadScriptWithSections(db: Db, scriptId: string) {
  const { data: script } = await db
    .from("scripts")
    .select(
      "id,title,body,status,language,format,packet_id,research_packet_version,company_id,story_id,target_duration,style_profile_id,style_profile_version,body_hash,is_multi_stock,company_ids,composition_id",
    )
    .eq("id", scriptId)
    .maybeSingle();
  if (!script) throw new Error("Script not found");
  if (!script.packet_id) {
    throw new Error("This script is not linked to a research packet and cannot be audited.");
  }
  const { data: sections } = await db
    .from("script_sections")
    .select("id,section_key,label,spoken_text,claim_ids,source_ids,metric_keys,order_index")
    .eq("script_id", scriptId)
    .order("order_index", { ascending: true });
  return { script, sections: sections ?? [] };
}

// ---------------------------------------------------------------- extraction

export async function runExtractScriptClaims(
  db: Db,
  args: { scriptId: string; model?: string | null; userId: string },
) {
  const { script, sections } = await loadScriptWithSections(db, args.scriptId);
  // Preprocessing is cheap work — routed to the cheaper model on purpose.
  const model = utilityModel(args.model);

  const scriptText = sections.length
    ? sections
        .map((s) => `### SECTION ${s.section_key} — ${s.label}\n${s.spoken_text}`)
        .join("\n\n")
    : (script.body ?? "");

  const res = await callStructured({
    operation: "extract-script-claims",
    mode: "DATABASE",
    model,
    instructions: `You are the fact-check preprocessor of a stock research studio.\n\n${EXTRACTION_RULES}`,
    input: `SCRIPT (${script.language}):\n\n${scriptText}`,
    schemaName: "extract_script_claims",
    jsonSchema: extractStatementsJsonSchema,
    validator: extractStatementsValidator,
    webSearch: false,
    maxOutputTokens: 20000,
    refs: {
      companyId: script.company_id,
      storyId: script.story_id,
      packetId: script.packet_id,
      scriptId: script.id,
    },
    userId: args.userId,
  });

  if (!res.ok)
    return { ok: false as const, error: res.error, needsHumanReview: res.needsHumanReview };

  return {
    ok: true as const,
    statements: res.data.statements,
    count: res.data.statements.length,
    model,
    usage: res.usage,
    latencyMs: res.latencyMs,
  };
}

// ---------------------------------------------------------------- audit

const ATTRIBUTION_TYPES: readonly StatementType[] = ["ANALYST OPINION", "MANAGEMENT STATEMENT"];

type Assessed = {
  statement: Statement;
  sectionId: string | null;
  status: AuditStatementStatus;
  severity: "Blocking" | "Warning" | "Info";
  matchedClaimId: string | null;
  matchedSourceId: string | null;
  matchedMetricKey: string | null;
  researchValue: string | null;
  scriptValue: string | null;
  issue: string | null;
  recommendedWording: string | null;
};

/** Word budget for this script, when the style profile defines one. */
async function wordBudgetFor(
  db: Db,
  script: { format: string; target_duration: string | null; style_profile_id: string | null },
) {
  if (!script.format.startsWith("short_") || script.format === "short_series") return null;
  const style = await loadStyleProfile(db, script.style_profile_id);
  if (!style) return null;
  return shortWordBudget(style.wordBudgets, script.target_duration ?? "60s");
}

// -------------------------------------------------- multi-stock audit support

type CompanyAuditContext = { ctx: ScriptContext; companyId: string; ticker: string };

/** Audit context as one clearly separated block per company. */
function multiCompanyAuditMessage(companies: CompanyAuditContext[], task: string): string {
  return [
    task,
    "",
    ...companies.map((c) =>
      [
        `=== COMPANY BLOCK · ${c.ticker} · company_id ${c.companyId} ===`,
        `MARKET: ${c.ctx.market} · REPORTING CURRENCY: ${c.ctx.currency}`,
        `VALID CLAIM IDS: ${c.ctx.claimIds.join(", ") || "(none)"}`,
        `VALID SOURCE IDS: ${c.ctx.sourceIds.join(", ") || "(none)"}`,
        `VALID METRIC KEYS: ${c.ctx.metricKeys.join(", ") || "(none)"}`,
        `CONTEXT (JSON): ${JSON.stringify(c.ctx.bundle)}`,
        `=== END COMPANY BLOCK ${c.ticker} ===`,
      ].join("\n"),
    ),
  ].join("\n\n");
}

/** One curated context per company the script covers (single-stock → one). */
async function loadCompanyContexts(
  db: Db,
  script: {
    company_id: string;
    packet_id: string | null;
    is_multi_stock?: boolean | null;
    company_ids?: string[] | null;
  },
  primary: ScriptContext,
): Promise<CompanyAuditContext[]> {
  const primaryEntry: CompanyAuditContext = {
    ctx: primary,
    companyId: primary.packet.companyId,
    ticker: String(primary.company["ticker"] ?? ""),
  };
  const others = (script.company_ids ?? []).filter((id) => id && id !== script.company_id);
  if (!script.is_multi_stock || others.length === 0) return [primaryEntry];

  const out: CompanyAuditContext[] = [primaryEntry];
  for (const companyId of others) {
    const { data: packet } = await db
      .from("research_packets")
      .select("id")
      .eq("company_id", companyId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!packet) continue;
    const ctx = await buildScriptContext(db, { packetId: packet.id });
    out.push({ ctx, companyId, ticker: String(ctx.company["ticker"] ?? "") });
  }
  return out;
}

/**
 * Numeric pre-check for a multi-stock script. A section that belongs to one
 * company is checked ONLY against that company's research. A shared section is
 * flagged only when no company's research supports the figure.
 */
function multiStockPrecheck(
  companies: CompanyAuditContext[],
  sections: Array<{ section_key: string; label: string | null }>,
  spoken: Array<{ section_key: string; spoken_text: string }>,
) {
  const labelByKey = new Map(sections.map((s) => [s.section_key, s.label ?? ""] as const));
  const ownerOf = (key: string) => {
    const label = labelByKey.get(key) ?? "";
    return companies.find((c) => c.ticker && label.includes(c.ticker)) ?? null;
  };

  const owned = new Map<string, Array<{ section_key: string; spoken_text: string }>>();
  const shared: Array<{ section_key: string; spoken_text: string }> = [];
  for (const s of spoken) {
    const owner = ownerOf(s.section_key);
    if (owner) {
      const list = owned.get(owner.companyId) ?? [];
      list.push(s);
      owned.set(owner.companyId, list);
    } else shared.push(s);
  }

  const base = runNumericPrecheck(companies[0]!.ctx, []);
  const findings: typeof base.findings = [];
  let mentions = 0;

  for (const c of companies) {
    const own = owned.get(c.companyId) ?? [];
    if (!own.length) continue;
    const r = runNumericPrecheck(c.ctx, own);
    findings.push(...r.findings);
    mentions += r.total;
  }

  if (shared.length) {
    const perCompany = companies.map((c) => runNumericPrecheck(c.ctx, shared));
    mentions += perCompany[0]!.total;
    // Only a figure that no company's research can support is a finding.
    const sharedFindings = perCompany[0]!.findings.filter((f) =>
      perCompany.every((r) => r.findings.some((x) => x.raw === f.raw && x.sentence === f.sentence)),
    );
    findings.push(...sharedFindings);
  }

  return {
    ...base,
    findings,
    total: mentions,
    blocking: findings.filter((f) => f.severity === "Blocking").length,
    warnings: findings.filter((f) => f.severity === "Warning").length,
  } satisfies typeof base;
}

/**
 * Full fact check for one script.
 *
 * Order is fixed: deterministic numeric pre-check → AI statement audit →
 * merged severity → readiness gate → advisory style check.
 */
export async function runAuditScript(
  db: Db,
  args: {
    scriptId: string;
    model?: string | null;
    userId: string;
    /** 1 = initial audit, 2 = re-audit after repair. */
    pass?: number;
    repairId?: string | null;
  },
) {
  const { script, sections } = await loadScriptWithSections(db, args.scriptId);
  const ctx = await buildScriptContext(db, { packetId: script.packet_id! });

  // A multi-stock script is audited against EVERY company it covers, and each
  // company keeps its own evidence: a number is only judged against the packet
  // of the company whose segment it was spoken in.
  const companyContexts = await loadCompanyContexts(db, script, ctx);
  const multiStock = companyContexts.length > 1;

  // ---- Stage 1: deterministic numeric pre-check (no model, always runs).
  const spoken = sections.length
    ? sections.map((s) => ({ section_key: s.section_key, spoken_text: s.spoken_text }))
    : [{ section_key: "body", spoken_text: script.body ?? "" }];
  const precheck = multiStock
    ? multiStockPrecheck(companyContexts, sections, spoken)
    : runNumericPrecheck(ctx, spoken);

  // ---- Stage 2: statement extraction + AI audit.
  const extraction = await runExtractScriptClaims(db, {
    scriptId: args.scriptId,
    model: args.model ?? null,
    userId: args.userId,
  });
  if (!extraction.ok) return extraction;

  const statements = extraction.statements;
  // Judging evidence is the hard part — keep the strong model here.
  const model = resolveModel(args.model ?? null);

  if (!statements.length) {
    return {
      ok: false as const,
      error: "No factual statements were extracted — the script may be empty.",
      needsHumanReview: true,
    };
  }

  const listed = statements
    .map(
      (s, i) =>
        `[${i}] (${s.statement_type}${s.is_numeric ? ", numeric" : ""}${s.attribution_present ? ", attributed" : ""}${s.hedged ? ", hedged" : ""}) section=${s.section_key} :: ${s.statement_text}`,
    )
    .join("\n");

  const precheckBrief = precheck.findings.length
    ? `\n\nDETERMINISTIC NUMERIC PRE-CHECK (already run in code, treat as authoritative):\n${precheck.findings
        .slice(0, 40)
        .map(
          (f) =>
            `- ${f.status} · ${f.raw} (${f.metric}) in "${f.sentence.slice(0, 120)}" — ${f.issue ?? ""}`,
        )
        .join("\n")}`
    : "\n\nDETERMINISTIC NUMERIC PRE-CHECK: every number in the script matched the research data.";

  const res = await callStructured({
    operation: "audit-script",
    mode: "DATABASE",
    model,
    instructions: `${CONTENT_MODE_RULES}

TASK: fact check a generated script against the research packet that produced it. You are
an auditor, not a writer. Assess EVERY supplied statement by index.

Status meanings:
- SUPPORTED — the research packet directly supports the sentence as written.
- SUPPORTED_WITH_ATTRIBUTION — the underlying evidence is a company claim, an analyst
  view or a news report, and the sentence already names that source correctly.
- NEEDS_QUALIFICATION — true only with hedging, attribution or a conditional; the sentence
  currently overstates it.
- CONFLICTING — the packet holds a different value or a documented disagreement.
- UNSUPPORTED — nothing in the packet supports it.

NUMERIC EXACTNESS — be pedantic. Any of these is a FAILURE, never an approximation:
- magnitude mismatch ($10M vs $10B, crore vs million)
- period mismatch (Q2 vs FY, FY2025 vs FY2026, TTM vs quarter)
- basis mismatch (GAAP EPS vs adjusted EPS, revenue vs bookings, backlog vs revenue,
  run-rate vs actual)
- currency mismatch (₹ vs $)
- unit mismatch (10% vs 10 percentage points, x vs %)
- a rounded or converted figure the packet does not itself state
Report the packet's value in research_value and the script's value in script_value.

ATTRIBUTION — a forward-looking or opinion sentence stated as fact fails. For example
"Revenue will grow 30% next year" must become "Analysts at <firm> currently expect
around 30% growth…" or "Management guided towards…", depending on the evidence.
Always fill recommended_wording with a corrected sentence for anything that is not
SUPPORTED.

Cite matched_claim_id / matched_source_id / matched_metric_key verbatim from the Script
Context, or null. Never invent an id.${
      multiStock
        ? `

MULTI-STOCK AUDIT: the context is supplied as one block per company. A statement spoken in
a company's segment may ONLY be matched against that company's block. Evidence from another
company never supports it — mark it UNSUPPORTED or CONFLICTING instead. Treat a metric
compared across companies with different periods or currencies as NEEDS_QUALIFICATION
unless the sentence itself states the period and currency for each company.`
        : ""
    }`,
    input: multiStock
      ? multiCompanyAuditMessage(
          companyContexts,
          `Audit these ${statements.length} statements from the multi-stock script "${script.title}" (${script.language}).\n\nSTATEMENTS:\n${listed}${precheckBrief}`,
        )
      : scriptContextMessage(
          ctx,
          `Audit these ${statements.length} statements from script "${script.title}" (${script.language}), generated from research packet v${ctx.packet.version}.\n\nSTATEMENTS:\n${listed}${precheckBrief}`,
        ),
    schemaName: "script_audit",
    jsonSchema: auditScriptJsonSchema,
    validator: auditScriptValidator,
    webSearch: false,
    maxOutputTokens: 26000,
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

  const validClaims = new Set(companyContexts.flatMap((c) => c.ctx.claimIds));
  const validSources = new Set(companyContexts.flatMap((c) => c.ctx.sourceIds));
  const validMetrics = new Set(companyContexts.flatMap((c) => c.ctx.metricKeys));
  const sectionIdByKey = new Map(sections.map((s) => [s.section_key, s.id] as const));
  const byIndex = new Map(res.data.assessments.map((a) => [a.statement_index, a] as const));

  // Sentences the pre-check already condemned — the model cannot clear them.
  const precheckBlockingSentences = precheck.findings
    .filter((f) => f.severity === "Blocking")
    .map((f) => f.sentence.replace(/\s+/g, " ").trim());

  const assessed: Assessed[] = statements.map((st, i) => {
    const a = byIndex.get(i);
    let status: AuditStatementStatus = a?.status ?? "UNSUPPORTED";
    let issue = a?.issue ?? null;
    let recommended = a?.recommended_wording ?? null;

    const matchedClaimId =
      a?.matched_claim_id && validClaims.has(a.matched_claim_id) ? a.matched_claim_id : null;
    const matchedSourceId =
      a?.matched_source_id && validSources.has(a.matched_source_id) ? a.matched_source_id : null;
    const matchedMetricKey =
      a?.matched_metric_key && validMetrics.has(a.matched_metric_key) ? a.matched_metric_key : null;

    // Code-enforced rule 1: no evidence handle at all can never read as supported.
    if (
      (status === "SUPPORTED" || status === "SUPPORTED_WITH_ATTRIBUTION") &&
      !matchedClaimId &&
      !matchedSourceId &&
      !matchedMetricKey
    ) {
      status = "UNSUPPORTED";
      issue = issue ?? "The auditor cited no claim, source or metric from the research packet.";
    }

    // Code-enforced rule 2: analyst/management statements must be attributed in the line.
    if (ATTRIBUTION_TYPES.includes(st.statement_type) && !st.attribution_present) {
      if (status === "SUPPORTED" || status === "SUPPORTED_WITH_ATTRIBUTION") {
        status = "NEEDS_QUALIFICATION";
        issue =
          issue ?? "Opinion or guidance stated without naming the analyst, firm or management.";
      }
    }

    // Code-enforced rule 3: a scenario or forecast must be conditional.
    if (st.statement_type === "FORECAST / SCENARIO" && !st.hedged) {
      if (status !== "CONFLICTING" && status !== "UNSUPPORTED") status = "NEEDS_QUALIFICATION";
      issue =
        issue ?? "A scenario or forecast is presented deterministically instead of conditionally.";
    }

    // Code-enforced rule 4: the deterministic pre-check outranks the model.
    const flat = st.statement_text.replace(/\s+/g, " ").trim();
    if (precheckBlockingSentences.some((s) => s.includes(flat) || flat.includes(s))) {
      if (status === "SUPPORTED" || status === "SUPPORTED_WITH_ATTRIBUTION") status = "CONFLICTING";
      issue = issue ?? "The numeric pre-check found this figure does not match the research data.";
    }

    const isNumeric = st.is_numeric || NUMERIC_STATEMENT_TYPES.includes(st.statement_type);
    const precheckAgrees = precheckBlockingSentences.some(
      (s) => s.includes(flat) || flat.includes(s),
    );

    let severity: Assessed["severity"] = "Info";
    if (status === "CONFLICTING") severity = "Blocking";
    else if (status === "UNSUPPORTED") severity = isNumeric ? "Blocking" : "Warning";
    else if (status === "NEEDS_QUALIFICATION") {
      severity =
        st.statement_type === "FORECAST / SCENARIO" ||
        ATTRIBUTION_TYPES.includes(st.statement_type) ||
        isNumeric
          ? "Blocking"
          : "Warning";
    } else if (status === "SUPPORTED_WITH_ATTRIBUTION" && !st.attribution_present) {
      severity = "Warning";
    }

    // Code-enforced rule 5: an ungrounded model contradiction is advisory, not
    // blocking. When the deterministic pre-check cleared every figure in the
    // sentence and the auditor names neither a conflicting packet value nor any
    // claim/source/metric, the disagreement is recorded but must not gate the
    // script (§14/§15). Genuine, located findings are untouched.
    const ungroundedConflict =
      status === "CONFLICTING" &&
      !precheckAgrees &&
      !a?.research_value &&
      !matchedClaimId &&
      !matchedSourceId &&
      !matchedMetricKey;
    if (ungroundedConflict) {
      severity = "Warning";
      issue = `${issue ?? "The auditor reported a conflict."} (Advisory: the deterministic pre-check matched every figure in this sentence and the auditor cited no conflicting packet value or evidence id.)`;
    }

    // Code-enforced rule 6: two sentence shapes are, deterministically, not
    // third-party claims and cannot be repaired by naming a source, so they
    // must not gate the script. The classification is lexical, not a model
    // judgement, and it never touches numeric, conflicting or unsupported
    // findings.
    //   (a) A viewer instruction ("… paarunga", "… follow pannunga") asserts
    //       nothing about the company and carries no figure or future value.
    //   (b) The narrator's own reading of the packet, when it is explicitly
    //       hedged AND scoped to the evidence, is already qualified — there is
    //       no analyst or management behind it to name.
    const low = flat.toLowerCase();
    const HEDGE = [
      "nu paakalaam",
      "nu therigiradhu",
      "nu theriyudhu",
      "oru reading",
      "reading irukku",
      "kashtam",
      "irukkalaam",
      "maadhiri",
      "conclude panna evidence illa",
      "evidence illa",
      "avasiyam illa",
    ];
    const SCOPE = [
      "packet",
      "filing",
      "available",
      "supplied",
      "evidence",
      "data",
      "context",
      "financial_periods",
      "disclosure",
    ];
    const THIRD_PARTY = [
      "analyst",
      "brokerage",
      "management",
      "guidance",
      "ceo",
      "cfo",
      "firm",
      "sonnaanga",
      "sollraanga",
    ];
    const IMPERATIVE = [
      "pannunga",
      "paarunga",
      "kavanikkanga",
      "follow pannunga",
      "watch",
      "monitor pannunga",
    ];
    const FUTURE_VALUE = ["will ", "aagum", "expect", "target", "forecast", "guidance", "%"];
    const hasNumber = isNumeric || /\d/.test(flat);

    const viewerInstruction =
      IMPERATIVE.some((w) => low.includes(w)) &&
      !FUTURE_VALUE.some((w) => low.includes(w)) &&
      !hasNumber;
    const narratorHedgedReading =
      HEDGE.some((w) => low.includes(w)) &&
      SCOPE.some((w) => low.includes(w)) &&
      !THIRD_PARTY.some((w) => low.includes(w));

    if (
      status === "NEEDS_QUALIFICATION" &&
      severity === "Blocking" &&
      !precheckAgrees &&
      (viewerInstruction || narratorHedgedReading)
    ) {
      severity = "Warning";
      issue = `${issue ?? "The auditor asked for qualification."} (Advisory: ${
        viewerInstruction
          ? "this is a viewer instruction, not a company, analyst or forecast claim."
          : "this is the narrator's own reading, already hedged and scoped to the packet evidence, with no third party to attribute it to."
      })`;
    }

    if (status !== "SUPPORTED" && !recommended) {
      recommended = a?.recommended_wording ?? null;
    }

    return {
      statement: st,
      sectionId: sectionIdByKey.get(st.section_key) ?? null,
      status,
      severity,
      matchedClaimId,
      matchedSourceId,
      matchedMetricKey,
      researchValue: a?.research_value ?? null,
      scriptValue: a?.script_value ?? st.quoted_value ?? null,
      issue,
      recommendedWording: recommended,
    };
  });

  const tally = (s: AuditStatementStatus) => assessed.filter((a) => a.status === s).length;
  const blocking = assessed.filter((a) => a.severity === "Blocking");
  const warnings = assessed.filter((a) => a.severity === "Warning");
  const numericFailures =
    assessed.filter(
      (a) =>
        (a.statement.is_numeric || NUMERIC_STATEMENT_TYPES.includes(a.statement.statement_type)) &&
        ["UNSUPPORTED", "CONFLICTING", "NEEDS_QUALIFICATION"].includes(a.status),
    ).length + precheck.blocking;

  // ---- Stage 3: word budget + readiness gate.
  const bodyText = spoken.map((s) => s.spoken_text).join(" ");
  const wordCount = countWords(bodyText);
  const budget = await wordBudgetFor(db, script);
  const withinBudget = budget ? wordCount >= budget.low && wordCount <= budget.high : true;

  const totalBlocking = blocking.length + precheck.blocking;
  const auditStatus = totalBlocking > 0 ? "FAIL" : warnings.length > 0 ? "WARN" : "PASS";

  // Deterministic de-duplication: the pre-check and the model auditor routinely
  // report the SAME numeric problem on the same sentence. Detector provenance is
  // preserved on every statement row; the gate counts each sentence once.
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const precheckConflictSentences = new Set(
    precheck.findings
      .filter((f) => f.severity === "Blocking" && f.status !== "NO_MATCH")
      .map((f) => norm(f.sentence)),
  );
  const modelConflictSentences = assessed
    .filter((a) => a.status === "CONFLICTING" && a.severity === "Blocking")
    .map((a) => norm(a.statement.statement_text));
  const conflictSpans = new Set(precheckConflictSentences);
  for (const s of modelConflictSentences) {
    const duplicate = [...precheckConflictSentences].some((p) => p.includes(s) || s.includes(p));
    if (!duplicate) conflictSpans.add(s);
  }

  const gate = {
    unsupported_numbers:
      assessed.filter(
        (a) =>
          a.status === "UNSUPPORTED" &&
          (a.statement.is_numeric || NUMERIC_STATEMENT_TYPES.includes(a.statement.statement_type)),
      ).length +
      precheck.findings.filter((f) => f.severity === "Blocking" && f.status === "NO_MATCH").length,
    numeric_conflicts: conflictSpans.size,

    attribution_gaps: assessed.filter(
      (a) => ATTRIBUTION_TYPES.includes(a.statement.statement_type) && a.severity === "Blocking",
    ).length,
    forecast_errors: assessed.filter(
      (a) => a.statement.statement_type === "FORECAST / SCENARIO" && a.severity === "Blocking",
    ).length,
    word_budget_ok: withinBudget,
    word_count: wordCount,
    word_budget: budget ? `${budget.low}-${budget.high}` : null,
  };
  const readyForReview =
    gate.unsupported_numbers === 0 &&
    gate.numeric_conflicts === 0 &&
    gate.attribution_gaps === 0 &&
    gate.forecast_errors === 0;

  const blockingReasons = [
    ...blocking.slice(0, 25).map((b) => ({
      origin: "ai",
      status: b.status,
      type: b.statement.statement_type,
      statement: b.statement.statement_text.slice(0, 240),
      issue: b.issue,
    })),
    ...precheck.findings
      .filter((f) => f.severity === "Blocking")
      .slice(0, 25)
      .map((f) => ({
        origin: "precheck",
        status: f.status,
        type: f.metric,
        statement: f.sentence.slice(0, 240),
        issue: f.issue,
      })),
  ];

  const totalUsage = {
    inputTokens: extraction.usage.inputTokens + res.usage.inputTokens,
    outputTokens: extraction.usage.outputTokens + res.usage.outputTokens,
    estimatedCostUsd: extraction.usage.estimatedCostUsd + res.usage.estimatedCostUsd,
  };

  const { data: audit, error: auditError } = await db
    .from("script_audits")
    .insert({
      script_id: script.id,
      packet_id: ctx.packet.id,
      packet_version: ctx.packet.version,
      body_hash: contentHash(bodyText),
      status: auditStatus,
      audit_pass: (args.pass ?? 1) >= 2 ? "final" : args.repairId ? "final" : "initial",
      repair_id: args.repairId ?? null,
      statements_total: assessed.length,
      supported: tally("SUPPORTED"),
      supported_with_attribution: tally("SUPPORTED_WITH_ATTRIBUTION"),
      needs_qualification: tally("NEEDS_QUALIFICATION"),
      conflicting: tally("CONFLICTING"),
      unsupported: tally("UNSUPPORTED"),
      numeric_failures: numericFailures,
      numeric_precheck: {
        total: precheck.total,
        counts: precheck.counts,
        currentPriceAllowed: precheck.currentPriceAllowed,
        currentPriceReason: precheck.currentPriceReason,
        findings: precheck.findings.slice(0, 60),
      } as never,
      numeric_precheck_blocking: precheck.blocking,
      readiness_gate: gate as never,
      ready_for_review: readyForReview,
      word_count: wordCount,
      within_word_budget: withinBudget,
      blocking_reasons: blockingReasons as never,
      warnings: warnings.slice(0, 25).map((w) => w.statement.statement_text.slice(0, 200)) as never,
      summary: res.data.summary,
      model,
      estimated_cost_usd: totalUsage.estimatedCostUsd,
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (auditError || !audit) throw new Error(auditError?.message ?? "Could not save the audit");

  await db.from("script_statements").insert([
    ...assessed.map((a) => ({
      audit_id: audit.id,
      script_id: script.id,
      section_id: a.sectionId,
      section_key: a.statement.section_key,
      statement_text: a.statement.statement_text,
      statement_type: a.statement.statement_type,
      is_numeric: a.statement.is_numeric,
      status: a.status,
      severity: a.severity,
      origin: "ai",
      matched_claim_id: a.matchedClaimId,
      matched_source_id: a.matchedSourceId,
      matched_metric_key: a.matchedMetricKey,
      research_value: a.researchValue,
      script_value: a.scriptValue,
      issue: a.issue,
      recommended_wording: a.recommendedWording,
      created_by: args.userId,
    })),
    ...precheck.findings.map((f) => ({
      audit_id: audit.id,
      script_id: script.id,
      section_id: f.sectionKey ? (sectionIdByKey.get(f.sectionKey) ?? null) : null,
      section_key: f.sectionKey,
      statement_text: f.sentence,
      statement_type: "DATA POINT" as StatementType,
      is_numeric: true,
      status:
        f.status === "NO_MATCH"
          ? ("UNSUPPORTED" as AuditStatementStatus)
          : ("CONFLICTING" as AuditStatementStatus),
      severity: f.severity,
      origin: "precheck",
      precheck_kind: f.status,
      matched_claim_id: null,
      matched_source_id: null,
      matched_metric_key: f.matchedMetricKey,
      research_value: f.matchedValue === null ? null : String(f.matchedValue),
      script_value: f.raw,
      issue: f.issue,
      recommended_wording: null,
      created_by: args.userId,
    })),
  ]);

  // ---- Stage 4: advisory style quality check — never blocking.
  const style = runStyleQuality(bodyText, script.language);
  await db.from("script_style_checks").insert({
    script_id: script.id,
    style_profile_id: script.style_profile_id,
    style_profile_version: script.style_profile_version,
    status: style.status,
    warnings_total: style.warningsTotal,
    findings: style.findings as never,
    metrics: style.metrics as never,
    summary: style.summary,
    created_by: args.userId,
  });

  // A human owns Approved and Published — the auditor never touches those.
  const locked = ["Approved", "Published"].includes(script.status);
  if (!locked) {
    await db
      .from("scripts")
      .update({
        audit_status: auditStatus,
        status: readyForReview ? "Ready for Review" : "Needs Fact Check",
        ready_for_review: readyForReview,
        style_quality_status: style.status,
        audited_body_hash: contentHash(script.body ?? bodyText),
        last_audit_id: audit.id,
      })
      .eq("id", script.id);
  }

  return {
    ok: true as const,
    auditId: audit.id,
    scriptId: script.id,
    pass: args.pass ?? 1,
    packetVersion: ctx.packet.version,
    status: auditStatus,
    readyForReview,
    readinessGate: gate,
    wordCount,
    wordBudget: budget,
    withinWordBudget: withinBudget,
    precheck: {
      total: precheck.total,
      blocking: precheck.blocking,
      warnings: precheck.warnings,
      counts: precheck.counts,
      currentPriceAllowed: precheck.currentPriceAllowed,
      currentPriceReason: precheck.currentPriceReason,
      findings: precheck.findings,
    },
    styleQuality: style,
    scriptStatus: locked ? script.status : readyForReview ? "Ready for Review" : "Needs Fact Check",
    statementsTotal: assessed.length,
    supported: tally("SUPPORTED"),
    supportedWithAttribution: tally("SUPPORTED_WITH_ATTRIBUTION"),
    needsQualification: tally("NEEDS_QUALIFICATION"),
    conflicting: tally("CONFLICTING"),
    unsupported: tally("UNSUPPORTED"),
    numericFailures,
    blocking: totalBlocking,
    warnings: warnings.length,
    blockingReasons,
    summary: res.data.summary,
    model,
    extractionModel: extraction.model,
    usage: totalUsage,
    latencyMs: extraction.latencyMs + res.latencyMs,
  };
}
