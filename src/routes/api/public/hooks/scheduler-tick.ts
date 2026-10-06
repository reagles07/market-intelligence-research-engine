/**
 * Phase 2D-1 scheduler tick endpoint.
 *
 * Called by the database scheduler every 15 minutes. The endpoint itself does
 * NOT decide business logic: it asks the controller which market executions
 * are due in market-local time. Nothing runs while automation is off.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/scheduler-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = request.headers.get("apikey");
        const expected = process.env["SUPABASE_PUBLISHABLE_KEY"];
        if (!expected || key !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runSchedulerTick } = await import("@/lib/schedule/scheduler.server");

        // Scheduled work is attributed to the workspace owner (oldest profile).
        const { data: owner } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (!owner) {
          return new Response(JSON.stringify({ error: "No workspace user" }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const result = await runSchedulerTick({
            db: supabaseAdmin as never,
            userId: owner.id,
          });
          return Response.json(result);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error("scheduler-tick failed:", message);
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
