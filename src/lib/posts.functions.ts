import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const generateCaption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ postId: z.string().uuid(), hint: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { generateBanglaCaption, signedUrl, isVideoPath } = await import("./integrations.server");
    const { data: post, error } = await context.supabase
      .from("posts")
      .select("id, image_path")
      .eq("id", data.postId)
      .single();
    if (error || !post) throw new Error("Post not found");
    const url = isVideoPath(post.image_path) ? null : await signedUrl(context.supabase, post.image_path, 600);
    const caption = await generateBanglaCaption(url, data.hint);
    await context.supabase.from("posts").update({ caption }).eq("id", post.id);
    return { caption };
  });

export const importDriveLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ links: z.string().min(1).max(20000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { downloadDriveImage, listDriveFolderImages } = await import("./integrations.server");
    const tokens = data.links.split(/[\s,]+/).filter(Boolean);
    const all: string[] = [];
    for (const s of tokens) {
      const folder = s.match(/\/folders\/([a-zA-Z0-9_-]{10,})/)?.[1];
      if (folder) {
        all.push(...(await listDriveFolderImages(folder)));
        continue;
      }
      const id = s.match(/\/d\/([a-zA-Z0-9_-]{10,})/)?.[1] ?? s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/)?.[1] ?? s.match(/^[a-zA-Z0-9_-]{10,}$/)?.[0];
      if (id) all.push(id);
    }
    const ids = [...new Set(all)].slice(0, 50);
    if (!ids.length) throw new Error("কোনো ছবি পাওয়া যায়নি। ফাইল বা ফোল্ডারের শেয়ার লিংক দিন।");
    const created: string[] = [];
    const errors: string[] = [];
    for (const id of ids) {
      try {
        const img = await downloadDriveImage(id);
        const ext = img.name.includes(".") ? img.name.split(".").pop()!.toLowerCase() : "jpg";
        const path = `${context.userId}/${crypto.randomUUID()}.${ext}`;
        const up = await context.supabase.storage.from("post-images").upload(path, img.bytes, { contentType: img.contentType });
        if (up.error) throw new Error(up.error.message);
        const { data: row, error } = await context.supabase.from("posts").insert({ user_id: context.userId, image_path: path }).select("id").single();
        if (error) throw new Error(error.message);
        created.push(row.id);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    return { created, errors };
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
    const pageId = s?.fb_page_id || process.env["FACEBOOK_PAGE_ID"];
    const token = s?.fb_token || process.env["FACEBOOK_PAGE_ACCESS_TOKEN"];
    let instagram: { connected: boolean; username: string | null } = { connected: false, username: null };
    if (pageId && token) {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(token)}`,
        );
        const j = (await res.json().catch(() => ({}))) as {
          instagram_business_account?: { id?: string; username?: string };
        };
        if (j.instagram_business_account?.id) {
          instagram = { connected: true, username: j.instagram_business_account.username ?? null };
        }
      } catch {
        /* Instagram not reachable with this token */
      }
    }
    return {
      connected: Boolean(pageId && token),
      pageId: s?.fb_page_id ?? null,
      hasToken: Boolean(s?.fb_token),
      instagram,
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
