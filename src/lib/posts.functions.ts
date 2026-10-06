import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const generateCaption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ postId: z.string().uuid(), hint: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { generateBanglaCaption, signedUrl } = await import("./integrations.server");
    const { data: post, error } = await context.supabase
      .from("posts")
      .select("id, image_path")
      .eq("id", data.postId)
      .single();
    if (error || !post) throw new Error("Post not found");
    const url = await signedUrl(context.supabase, post.image_path, 600);
    const caption = await generateBanglaCaption(url, data.hint);
    await context.supabase.from("posts").update({ caption }).eq("id", post.id);
    return { caption };
  });

export const syncSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { syncSheetForUser } = await import("./integrations.server");
    return syncSheetForUser(context.supabase, context.userId);
  });

export const publishNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ postId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { publishClaimedPost } = await import("./integrations.server");
    const { data: claimed } = await context.supabase
      .from("posts")
      .update({ status: "posting" })
      .eq("id", data.postId)
      .in("status", ["draft", "scheduled", "failed"])
      .select("id, image_path, caption")
      .maybeSingle();
    if (!claimed) throw new Error("এই পোস্টটি এখন পোস্ট করা যাবে না।");
    if (!claimed.caption.trim()) {
      await context.supabase.from("posts").update({ status: "draft" }).eq("id", claimed.id);
      throw new Error("ক্যাপশন খালি।");
    }
    const r = await publishClaimedPost(context.supabase, claimed);
    if (!r.ok) throw new Error(r.error);
    return { ok: true };
  });
