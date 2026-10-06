import type { Database, Json } from "@/integrations/supabase/types";
export type TableName = keyof Database["public"]["Tables"];
export type Row<T extends TableName> = Database["public"]["Tables"][T]["Row"];
export type JsonObject = { [key: string]: Json | undefined };

/** Narrow JSON metadata without trusting primitives or arrays as objects. */
export function jsonObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export function jsonArray(value: unknown): import("@/integrations/supabase/types").Json[] {
  return Array.isArray(value) ? value : [];
}
export function requireValue<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`${label} not found`);
  return value;
}
