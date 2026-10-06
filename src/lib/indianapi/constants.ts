/** IndianAPI endpoint and parameter constants (client-safe). */

export const DISCOVERY_ENDPOINTS = [
  "/trending",
  "/NSE_most_active",
  "/BSE_most_active",
  "/price_shockers",
  "/fetch_52_week_high_low_data",
  "/news",
] as const;

export const HISTORICAL_PERIODS = ["1m", "6m", "1yr", "3yr", "5yr", "10yr", "max"] as const;

export const HISTORICAL_FILTERS = [
  "default",
  "price",
  "pe",
  "sm",
  "evebitda",
  "ptb",
  "mcs",
] as const;

export const COMPANY_ENDPOINTS = [
  "/historical_data",
  "/statement",
  "/historical_stats",
  "/corporate_actions",
  "/recent_announcements",
] as const;
