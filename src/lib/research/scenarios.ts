/**
 * Phase 2B — scenario freshness (pure, client-safe).
 *
 * Scenarios belong to the research packet version they were generated from.
 * Historical scenarios attached to an older packet never count as fresh for a
 * newer one, and a story-level scenario count is never proof of freshness.
 */
export type ScenarioRow = { packet_id?: string | null; scenario_type?: string | null };

export function isScenarioFresh(args: {
  packetId: string | null;
  scenarios: ScenarioRow[];
  requiredTypes?: number;
}): { fresh: boolean; reason: string } {
  if (!args.packetId) return { fresh: false, reason: "no current packet to attach scenarios to" };
  const forPacket = args.scenarios.filter((s) => String(s.packet_id ?? "") === args.packetId);
  const distinct = new Set(
    forPacket.map((s) => String(s.scenario_type ?? "").toLowerCase()).filter(Boolean),
  );
  const needed = args.requiredTypes ?? 3;
  const count = distinct.size || forPacket.length;
  if (count >= needed)
    return { fresh: true, reason: `${count} scenarios already belong to the current packet` };
  return {
    fresh: false,
    reason: forPacket.length
      ? `only ${count} scenario(s) belong to the current packet`
      : "the current packet has no scenarios — older packet scenarios are historical",
  };
}
