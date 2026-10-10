import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const generateCaption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ postId: z.string().uuid(), hint: z.string().max(500).optional(), tone: z.string().max(30).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { generateBanglaCaption, signedUrl, isVideoPath } = await import("./integrations.server");
    const { data: post, error } = await context.supabase
      .from("posts")
      .select("id, image_path")
      .eq("id", data.postId)
      .single();
    if (error || !post) throw new Error("Post not found");
    const url = isVideoPath(post.image_path) ? null : await signedUrl(context.supabase, post.image_path, 600);
    const { data: st } = await context.supabase.from("settings").select("caption_tone, brand_voice").eq("user_id", context.userId).maybeSingle();
    const caption = await generateBanglaCaption(url, data.hint, { tone: data.tone ?? st?.caption_tone, brandVoice: st?.brand_voice });
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

export const generateCaptionVariations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ postId: z.string().uuid(), tone: z.string().max(30).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { generateBanglaCaption, signedUrl, isVideoPath } = await import("./integrations.server");
    const { data: post } = await context.supabase.from("posts").select("id, image_path").eq("id", data.postId).single();
    if (!post) throw new Error("Post not found");
    const { data: st } = await context.supabase.from("settings").select("caption_tone, brand_voice").eq("user_id", context.userId).maybeSingle();
    const url = isVideoPath(post.image_path) ? null : await signedUrl(context.supabase, post.image_path, 600);
    const style = { tone: data.tone ?? st?.caption_tone, brandVoice: st?.brand_voice };
    const angles = ["প্রথম আইডিয়া: সরাসরি ও ছোট।", "দ্বিতীয় আইডিয়া: আবেগ/অনুভূতি দিয়ে শুরু করো, আগেরটির থেকে সম্পূর্ণ ভিন্ন।", "তৃতীয় আইডিয়া: একটি প্রশ্ন বা হুক দিয়ে শুরু করো, সম্পূর্ণ ভিন্ন কোণ থেকে।"];
    const captions = await Promise.all(angles.map((a) => generateBanglaCaption(url, a, style)));
    return { captions };
  });

export const saveCaptionStyle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tone: z.string().max(30), brandVoice: z.string().max(1500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("settings").upsert({ user_id: context.userId, caption_tone: data.tone, brand_voice: data.brandVoice, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const postAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const { fetchFbPostStats, resolvePageToken } = await import("./integrations.server");
    const [y, m] = data.month.split("-").map(Number) as [number, number];
    const from = new Date(Date.UTC(y, m - 1, 1) - 6 * 3600e3).toISOString();
    const to = new Date(Date.UTC(y, m, 1) - 6 * 3600e3).toISOString();
    const { data: posts } = await context.supabase.from("posts").select("id, caption, posted_at, fb_post_id, ig_post_id").eq("status", "posted").gte("posted_at", from).lt("posted_at", to).order("posted_at", { ascending: true });
    const { data: s } = await context.supabase.from("settings").select("fb_page_id, fb_token").eq("user_id", context.userId).maybeSingle();
    const pageId = s?.fb_page_id || process.env["FACEBOOK_PAGE_ID"];
    const raw = s?.fb_token || process.env["FACEBOOK_PAGE_ACCESS_TOKEN"];
    const token = pageId && raw ? await resolvePageToken(raw, pageId) : null;
    const list = posts ?? [];
    const rows: { id: string; caption: string; posted_at: string | null; fb_post_id: string | null; instagram: boolean; likes: number; comments: number; shares: number; reach: number; error: string | null }[] = [];
    for (let i = 0; i < list.length; i += 10) {
      const chunk = await Promise.all(list.slice(i, i + 10).map(async (p) => {
        const st = p.fb_post_id && token ? await fetchFbPostStats(p.fb_post_id, token) : { likes: 0, comments: 0, shares: 0, reach: 0, error: token ? null : "Facebook যুক্ত নেই" };
        return { id: p.id, caption: p.caption, posted_at: p.posted_at, fb_post_id: p.fb_post_id, instagram: Boolean(p.ig_post_id), ...st };
      }));
      rows.push(...chunk);
    }
    return { rows };
  });
