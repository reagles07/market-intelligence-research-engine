import { useMemo, useState, type ReactNode } from "react";
import { MarketContext, type MarketFilter } from "./market-context-value";

export function MarketProvider({ children }: { children: ReactNode }) {
  const [market, setMarket] = useState<MarketFilter>("All");
  const value = useMemo(() => ({ market, setMarket }), [market]);
  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}
