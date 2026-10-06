import { createContext, useContext } from "react";

export type MarketFilter = "All" | "US" | "India";

type Ctx = {
  market: MarketFilter;
  setMarket: (m: MarketFilter) => void;
};

export const MarketContext = createContext<Ctx>({ market: "All", setMarket: () => {} });

export const useMarket = () => useContext(MarketContext);
