import { createFileRoute } from "@tanstack/react-router";

const BATCH = 10;

export const Route = createFileRoute("/api/public/hooks/publish-due")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
        if (!token) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: valid } = await supabaseAdmin.rpc("verify_cron_token", { _token: token });
        if (!valid) return new Response("Unauthorized", { status: 401 });

        const { publishClaimedPost, syncSheetForUser } = await import("@/lib/integrations.server");

        // Release posts stuck in "posting" for > 15 min (crashed run).
        await supabaseAdmin
          .from("posts")
          .update({ status: "failed", error: "Posting timed out" })
          .eq("status", "posting")
          .lt("scheduled_at", new Date(Date.now() - 15 * 60_000).toISOString());

        const { data: due } = await supabaseAdmin
          .from("posts")
          .select("id")
          .eq("status", "scheduled")
          .lte("scheduled_at", new Date().toISOString())
          .order("scheduled_at")
          .limit(BATCH);

        const users = new Set<string>();
        let posted = 0;
        let failed = 0;
        for (const { id } of due ?? []) {
          const { data: claimed } = await supabaseAdmin
            .from("posts")
            .update({ status: "posting" })
            .eq("id", id)
            .eq("status", "scheduled")
            .select("id, image_path, caption, user_id")
            .maybeSingle();
          if (!claimed) continue;
          users.add(claimed.user_id);
          const r = await publishClaimedPost(supabaseAdmin, claimed);
          if (r.ok) posted++;
          else failed++;
        }
        for (const u of users) {
          try {
            await syncSheetForUser(supabaseAdmin, u);
          } catch (e) {
            console.error("sheet sync failed", e);
          }
        }
        // Free storage: delete images of posts published more than 12 hours ago.
        ...
          .lt("posted_at", new Date(Date.now() - 12 * 3600_000).toISOString())
          .limit(50);
        if (old && old.length) {
          const { error } = await supabaseAdmin.storage.from("post-images").remove(old.map((p) => p.image_path));
          if (!error) {
            await supabaseAdmin.from("posts").update({ image_path: "" }).in("id", old.map((p) => p.id));
            cleaned = old.length;
          } else console.error("cleanup failed", error);
        }
        return Response.json({ posted, failed, cleaned });
      },
    },
  },
});
