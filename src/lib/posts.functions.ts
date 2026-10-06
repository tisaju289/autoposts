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

export const facebookStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: s } = await context.supabase
      .from("settings")
      .select("fb_page_id, fb_token")
      .eq("user_id", context.userId)
      .maybeSingle();
    const fromSettings = Boolean(s?.fb_page_id && s?.fb_token);
    const fromEnv = Boolean(process.env["FACEBOOK_PAGE_ID"] && process.env["FACEBOOK_PAGE_ACCESS_TOKEN"]);
    return {
      connected: fromSettings || fromEnv,
      pageId: s?.fb_page_id ?? null,
      hasToken: Boolean(s?.fb_token),
    };
  });

export const saveFacebookCreds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ pageId: z.string().trim().min(1).max(100), token: z.string().trim().min(1).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("settings").upsert({
      user_id: context.userId,
      fb_page_id: data.pageId,
      fb_token: data.token,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
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
      .select("id, image_path, caption, user_id")
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
