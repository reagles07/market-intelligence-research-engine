/**
 * Financial calculation utilities.
 * Every function returns `null` when inputs are missing — never a fabricated value.
 * Render `null` as "N/A".
 */

export type Num = number | null | undefined;

const ok = (...v: Num[]): boolean => v.every((x) => typeof x === "number" && Number.isFinite(x));

export function pctChange(current: Num, prior: Num): number | null {
  if (!ok(current, prior) || prior === 0) return null;
  return (((current as number) - (prior as number)) / Math.abs(prior as number)) * 100;
}

export const yoyGrowth = pctChange;
export const qoqGrowth = pctChange;

export function cagr(endValue: Num, startValue: Num, years: number): number | null {
  if (!ok(endValue, startValue) || (startValue as number) <= 0 || years <= 0) return null;
  if ((endValue as number) <= 0) return null;
  return (Math.pow((endValue as number) / (startValue as number), 1 / years) - 1) * 100;
}

export const cagr3y = (end: Num, start: Num) => cagr(end, start, 3);
export const cagr5y = (end: Num, start: Num) => cagr(end, start, 5);

const ratio = (a: Num, b: Num): number | null =>
  ok(a, b) && (b as number) !== 0 ? ((a as number) / (b as number)) * 100 : null;

export const grossMargin = (grossProfit: Num, revenue: Num) => ratio(grossProfit, revenue);
export const operatingMargin = (operatingIncome: Num, revenue: Num) =>
  ratio(operatingIncome, revenue);
export const netMargin = (netIncome: Num, revenue: Num) => ratio(netIncome, revenue);
export const fcfMargin = (fcf: Num, revenue: Num) => ratio(fcf, revenue);

export const roe = (netIncome: Num, equity: Num) => ratio(netIncome, equity);

export function roic(operatingIncome: Num, debt: Num, equity: Num, cash: Num): number | null {
  if (!ok(operatingIncome, debt, equity)) return null;
  const investedCapital =
    (debt as number) + (equity as number) - (typeof cash === "number" ? cash : 0);
  if (investedCapital === 0) return null;
  // NOPAT approximated with a 21% blended tax rate — treat as CALCULATION, not FACT.
  return (((operatingIncome as number) * 0.79) / investedCapital) * 100;
}

export function debtToEquity(debt: Num, equity: Num): number | null {
  if (!ok(debt, equity) || (equity as number) === 0) return null;
  return (debt as number) / (equity as number);
}

export function netDebt(debt: Num, cash: Num): number | null {
  if (!ok(debt, cash)) return null;
  return (debt as number) - (cash as number);
}

export function currentRatio(assets: Num, liabilities: Num): number | null {
  if (!ok(assets, liabilities) || (liabilities as number) === 0) return null;
  return (assets as number) / (liabilities as number);
}

export function interestCoverage(operatingIncome: Num, interestExpense: Num): number | null {
  if (!ok(operatingIncome, interestExpense) || (interestExpense as number) === 0) return null;
  return (operatingIncome as number) / (interestExpense as number);
}

export function freeCashFlow(ocf: Num, capex: Num): number | null {
  if (!ok(ocf, capex)) return null;
  return (ocf as number) - Math.abs(capex as number);
}

export function surprisePct(actual: Num, consensus: Num): number | null {
  return pctChange(actual, consensus);
}

// ------------------------------------------------------------------ format

export const NA = "N/A";

export function fmtNum(v: Num, digits = 2): string {
  if (!ok(v)) return NA;
  return (v as number).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtPct(v: Num, digits = 1): string {
  if (!ok(v)) return NA;
  return `${(v as number) > 0 ? "+" : ""}${(v as number).toFixed(digits)}%`;
}

export function fmtMoney(v: Num, currency = "USD", digits = 2): string {
  if (!ok(v)) return NA;
  const symbol = currency === "INR" ? "₹" : "$";
  return `${symbol}${(v as number).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function fmtMarketCap(v: Num, currency = "USD"): string {
  if (!ok(v)) return NA;
  const n = v as number;
  const symbol = currency === "INR" ? "₹" : "$";
  if (n >= 1e12) return `${symbol}${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${symbol}${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${symbol}${(n / 1e6).toFixed(2)}M`;
  return `${symbol}${n.toLocaleString()}`;
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return NA;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return NA;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return NA;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return NA;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}
