// Server-only helpers: AI captions, Google Sheets sync, Facebook publishing.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;
const BUCKET = "post-images";

export async function signedUrl(db: DB, path: string, seconds = 3600) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data) throw new Error(`Image link failed: ${error?.message}`);
  return data.signedUrl;
}

export const VIDEO_RE = /\.(mp4|mov|m4v|webm)$/i;
export const isVideoPath = (p: string) => VIDEO_RE.test(p);

export const TONES: Record<string, string> = {
  engaging: "আকর্ষণীয় ও প্রাণবন্ত",
  professional: "প্রফেশনাল ও মার্জিত",
  casual: "ক্যাজুয়াল ও বন্ধুসুলভ",
  offer: "অফার/ডিসকাউন্ট কেন্দ্রিক — জরুরি ভাব, কল-টু-অ্যাকশন সহ",
  story: "গল্প বলার ধরনে (Storytelling)",
};

const GEM = "https://generativelanguage.googleapis.com";

/** Uploads a video to Gemini's Files API (streamed, not buffered) and waits until it is ready. */
async function geminiUploadVideo(videoUrl: string) {
  const key = process.env["GEMINI_API_KEY"]!;
  const src = await fetch(videoUrl);
  if (!src.ok || !src.body) throw new Error(`ভিডিও পড়া যায়নি [${src.status}]`);
  const size = src.headers.get("content-length");
  const mime = (src.headers.get("content-type") || "video/mp4").split(";")[0]!;
  if (!size) throw new Error("ভিডিওর সাইজ পাওয়া যায়নি");
  const start = await fetch(`${GEM}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": size,
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "post-video" } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) throw new Error(`Gemini ভিডিও আপলোড শুরু হয়নি [${start.status}]: ${(await start.text()).slice(0, 200)}`);
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Length": size, "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: src.body,
    // @ts-expect-error duplex is required for streaming bodies
    duplex: "half",
  });
  if (!up.ok) throw new Error(`Gemini ভিডিও আপলোড হয়নি [${up.status}]: ${(await up.text()).slice(0, 200)}`);
  let file = ((await up.json()) as { file: { name: string; uri: string; state?: string; mimeType?: string } }).file;
  for (let i = 0; i < 60 && file.state === "PROCESSING"; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const g = await fetch(`${GEM}/v1beta/${file.name}`, { headers: { "x-goog-api-key": key } });
    if (g.ok) file = (await g.json()) as typeof file;
  }
  if (file.state && file.state !== "ACTIVE") throw new Error(`Gemini ভিডিও প্রসেস হয়নি (${file.state})`);
  return { name: file.name, uri: file.uri, mime: file.mimeType || mime };
}

/** Uses the user's own Gemini key: fallback for images, primary path for videos (it can watch them). */
async function geminiCaption(system: string, userText: string, imageUrl: string | null, videoUrl?: string | null) {
  const parts: Record<string, unknown>[] = [{ text: userText }];
  let uploaded: { name: string } | null = null;
  if (videoUrl) {
    const v = await geminiUploadVideo(videoUrl);
    uploaded = v;
    parts.unshift({ file_data: { mime_type: v.mime, file_uri: v.uri } });
  } else if (imageUrl) {
    const img = await fetch(imageUrl);
    if (img.ok) {
      const buf = new Uint8Array(await img.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      parts.push({ inline_data: { mime_type: img.headers.get("content-type") || "image/jpeg", data: btoa(bin) } });
    }
  }
  try {
    return await geminiGenerate(system, parts);
  } finally {
    if (uploaded) fetch(`${GEM}/v1beta/${uploaded.name}`, { method: "DELETE", headers: { "x-goog-api-key": process.env["GEMINI_API_KEY"]! } }).catch(() => {});
  }
}

async function geminiGenerate(system: string, parts: Record<string, unknown>[]) {
  const body = JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts }] });
  // Google often returns 503 "high demand" or retires model names; try several models in turn.
  const models = ["gemini-3.8-flash", "gemini-3-flash-preview", "gemini-flash-latest", "gemini-flash-lite-latest"];
  let lastErr = "";
  for (let round = 0; round < 2; round++) {
    for (const m of models) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": process.env["GEMINI_API_KEY"]!, "Content-Type": "application/json" },
        body,
      });
      if (res.ok) {
        const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
        const text = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
        if (text) return text;
        lastErr = "Gemini কোনো ক্যাপশন দেয়নি।";
        continue;
      }
      const t = (await res.text()).slice(0, 200);
      if (res.status === 400 || res.status === 401 || (res.status === 403 && !/model/i.test(t))) {
        throw new Error(`Gemini key সমস্যা [${res.status}]: ${t}`);
      }
      lastErr = `Gemini [${res.status}] ${m}`;
    }
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1000));
  }
  throw new Error(`Gemini এখন ব্যস্ত, একটু পরে আবার চেষ্টা করুন। (${lastErr})`);
}

export async function generateBanglaCaption(imageUrl: string | null, hint?: string, style?: { tone?: string | null | undefined; brandVoice?: string | null | undefined }) {
  const extra = `\nটোন: ${TONES[style?.tone ?? ""] ?? TONES["engaging"]}।${style?.brandVoice?.trim() ? `\nপেজের ব্র্যান্ড নির্দেশনা (অবশ্যই মানবে): ${style.brandVoice.trim()}` : ""}`;
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured");
  const payload = {
      model: "openai/gpt-6-astra",
      reasoning: { effort: "low" },
      instructions:
        "তুমি একজন দক্ষ বাংলা সোশ্যাল মিডিয়া কপিরাইটার। ছবির ডিজাইন দেখে একটি আকর্ষণীয় ফেসবুক পেজ পোস্ট ক্যাপশন লেখো — মূল লেখা শুধু বাংলায়। গঠন (আবশ্যক): প্রথমে ২-৪ লাইনের মূল লেখা, তারপর একটি ফাঁকা লাইন, তারপর ৩-৫টি হ্যাশট্যাগ একসাথে আলাদা লাইনে। মূল লেখার মধ্যে হলে দুই-তিন ছোট অনুচ্ছেদ বা লাইন ভাগ করবে — প্রতিটি ভাব আলাদা লাইনে, ফাঁকা লাইন দিয়ে আলাদা করবে যাতে ক্যাপশন পরিষ্কার ও গোছানো দেখায়। প্রাসঙ্গিক ইমোজি ব্যবহার করবে। গুরুত্বপূর্ণ নিয়ম: সব সংখ্যা/নম্বর সবসময় ইংরেজি অঙ্কে লিখবে (যেমন ১২৫০ নয়, 1250) এবং সব হ্যাশট্যাগ সবসময় ইংরেজিতে হবে (যেমন #Fashion #NewArrival), বাংলা হ্যাশট্যাগ নয়। ছবিতে লেখা থাকলে তার মর্ম ধরে লেখো। শুধু ক্যাপশনটি দাও, অন্য কিছু নয়।" + extra,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: hint ? `অতিরিক্ত নির্দেশনা: ${hint}` : "এই পোস্টের জন্য ক্যাপশন লেখো।" },
            ...(imageUrl ? [{ type: "input_image", image_url: imageUrl, detail: "low" }] : [{ type: "input_text", text: "এটি একটি ভিডিও পোস্ট — ছবি নেই। পেজের জন্য একটি সাধারণ আকর্ষণীয় ভিডিও ক্যাপশন লেখো।" }]),
          ],
        },
      ],
  };
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    // Built-in AI unavailable (credits, limits, busy, outage) → use the user's own Gemini key.
    if ((res.status === 402 || res.status === 403 || res.status === 429 || res.status >= 500) && process.env["GEMINI_API_KEY"]) {
      const texts = payload.input[0]!.content.filter((c) => c.type === "input_text").map((c) => ("text" in c ? c.text : ""));
      return geminiCaption(payload.instructions, texts.join("\n"), imageUrl);
    }
    if (res.status === 429) throw new Error("AI এখন ব্যস্ত, একটু পরে আবার চেষ্টা করুন।");
    if (res.status === 402) throw new Error("AI ক্রেডিট শেষ। Workspace এ ক্রেডিট যোগ করুন।");
    throw new Error(`AI error [${res.status}]: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    output?: { type: string; content?: { type: string; text?: string }[] }[];
  };
  const text = (data.output ?? [])
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("AI কোনো ক্যাপশন দেয়নি।");
  return text;
}

const SHEETS = "https://connector-gateway.lovable.dev/google_sheets/v4";
const DRIVE = "https://connector-gateway.lovable.dev/google_drive/drive/v3";

/** Lists image file IDs inside a Google Drive folder (sorted by name). */
export async function listDriveFolderImages(folderId: string): Promise<string[]> {
  const lk = process.env["LOVABLE_API_KEY"];
  const dk = process.env["GOOGLE_DRIVE_API_KEY"];
  if (!lk || !dk) throw new Error("Google Drive সংযুক্ত নয়।");
  const headers = { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": dk };
  const ids: string[] = [];
  let pageToken = "";
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and mimeType contains 'image/' and trashed = false`);
    const url = `${DRIVE}/files?q=${q}&fields=nextPageToken,files(id)&orderBy=name&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Drive ফোল্ডার পড়া যায়নি [${res.status}]: ${body.slice(0, 200)}`);
    }
    const j = (await res.json()) as { nextPageToken?: string; files?: { id: string }[] };
    ids.push(...(j.files ?? []).map((f) => f.id));
    pageToken = j.nextPageToken ?? "";
  } while (pageToken && ids.length < 200);
  return ids;
}

/** Downloads an image from the user's Google Drive via the connector gateway. */
export async function downloadDriveImage(fileId: string): Promise<{ bytes: Uint8Array; contentType: string; name: string }> {
  const lk = process.env["LOVABLE_API_KEY"];
  const dk = process.env["GOOGLE_DRIVE_API_KEY"];
  if (!lk || !dk) throw new Error("Google Drive সংযুক্ত নয়।");
  const headers = { Authorization: `Bearer ${lk}`, "X-Connection-Api-Key": dk };
  const metaRes = await fetch(`${DRIVE}/files/${fileId}?fields=id,name,mimeType,size`, { headers });
  if (!metaRes.ok) {
    const body = await metaRes.text();
    throw new Error(`Drive ফাইল পাওয়া যায়নি [${metaRes.status}]: ${body.slice(0, 200)}`);
  }
  const meta = (await metaRes.json()) as { name?: string; mimeType?: string; size?: string };
  if (!meta.mimeType?.startsWith("image/")) throw new Error(`"${meta.name ?? fileId}" ছবি নয় (${meta.mimeType ?? "unknown"})।`);
  if (meta.size && Number(meta.size) > 20 * 1024 * 1024) throw new Error(`"${meta.name}" 20MB-এর বেশি — বাদ গেছে।`);
  const dl = await fetch(`${DRIVE}/files/${fileId}?alt=media`, { headers });
  if (!dl.ok) {
    const body = await dl.text();
    throw new Error(`Drive ডাউনলোড ব্যর্থ [${dl.status}]: ${body.slice(0, 200)}`);
  }
  const bytes = new Uint8Array(await dl.arrayBuffer());
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error(`"${meta.name}" 20MB-এর বেশি — বাদ গেছে।`);
  return { bytes, contentType: meta.mimeType, name: meta.name ?? fileId };
}

function sheetHeaders() {
  const lk = process.env["LOVABLE_API_KEY"];
  const sk = process.env["GOOGLE_SHEETS_API_KEY"];
  if (!lk || !sk) throw new Error("Google Sheets is not connected");
  return {
    Authorization: `Bearer ${lk}`,
    "X-Connection-Api-Key": sk,
    "Content-Type": "application/json",
  };
}

const STATUS_BN: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  posting: "Posting",
  posted: "Posted",
  failed: "Failed",
};

/** Rewrites the user's sheet with every post. One-way: app -> sheet. */
export async function syncSheetForUser(db: DB, userId: string) {
  const { data: settings } = await db
    .from("settings")
    .select("spreadsheet_id, sheet_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (!settings?.spreadsheet_id) return { skipped: true };
  const { data: posts, error } = await db
    .from("posts")
    .select("*")
    .eq("user_id", userId)
    .order("scheduled_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);

  const paths = (posts ?? []).map((p) => p.image_path).filter(Boolean);
  const links: Record<string, string> = {};
  if (paths.length) {
    const { data } = await db.storage.from(BUCKET).createSignedUrls(paths, 60 * 60 * 24 * 7);
    data?.forEach((d) => {
      if (d.path && d.signedUrl) links[d.path] = d.signedUrl;
    });
  }
  const rows = [
    ["Post ID", "Image (7-day link)", "Caption", "Schedule (Dhaka)", "Status", "Facebook Post ID", "Instagram Post ID", "Error"],
    ...(posts ?? []).map((p) => [
      p.id,
      links[p.image_path] ?? p.image_path,
      p.caption,
      p.scheduled_at
        ? new Date(p.scheduled_at).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })
        : "",
      STATUS_BN[p.status] ?? p.status,
      p.fb_post_id ?? "",
      p.ig_post_id ?? "",
      p.error ?? "",
    ]),
  ];
  const sheet = `'${settings.sheet_name.replace(/'/g, "''")}'`;
  const id = settings.spreadsheet_id;
  const h = sheetHeaders();
  const clear = await fetch(`${SHEETS}/spreadsheets/${id}/values/${sheet}!A:H:clear`, {
    method: "POST",
    headers: h,
    body: "{}",
  });
  if (!clear.ok) throw new Error(`Sheet error [${clear.status}]: ${(await clear.text()).slice(0, 300)}`);
  const put = await fetch(
    `${SHEETS}/spreadsheets/${id}/values/${sheet}!A1:H${rows.length}?valueInputOption=RAW`,
    { method: "PUT", headers: h, body: JSON.stringify({ values: rows }) },
  );
  if (!put.ok) throw new Error(`Sheet error [${put.status}]: ${(await put.text()).slice(0, 300)}`);
  return { skipped: false, rows: rows.length - 1 };
}

/** Exchanges a user (profile) token for the Page's own token when possible. */
async function resolvePageToken(rawToken: string, pageId: string) {
  try {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}?fields=access_token&access_token=${encodeURIComponent(rawToken)}`,
    );
    const j = (await r.json().catch(() => ({}))) as { access_token?: string };
    if (j.access_token) return j.access_token;
  } catch {
    /* keep raw token */
  }
  return rawToken;
}

/** Posts a photo to the Facebook Page. Returns the Facebook post id. */
export async function publishToFacebook(
  imageUrl: string,
  caption: string,
  creds?: { pageId?: string | null; token?: string | null; video?: boolean },
) {
  const pageId = creds?.pageId || process.env["FACEBOOK_PAGE_ID"];
  const rawToken = creds?.token || process.env["FACEBOOK_PAGE_ACCESS_TOKEN"];
  if (!pageId || !rawToken) throw new Error("Facebook Page যুক্ত করা হয়নি (Page ID / Token নেই)।");
  const token = await resolvePageToken(rawToken, pageId);
  if (creds && (creds as { video?: boolean }).video) {
    const vr = await fetch(`https://graph-video.facebook.com/v21.0/${pageId}/videos`, {
      method: "POST",
      body: new URLSearchParams({ file_url: imageUrl, description: caption, access_token: token }),
    });
    const vj = (await vr.json().catch(() => ({}))) as { id?: string; error?: { message?: string; error_user_msg?: string } };
    if (!vr.ok || vj.error) throw new Error(`Facebook video [${vr.status}]: ${vj.error?.message ?? "unknown error"}${vj.error?.error_user_msg ? ` — ${vj.error.error_user_msg}` : ""}`);
    return vj.id ?? "";
  }
  // Upload the image bytes directly — more reliable than letting Facebook fetch a signed URL.
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`ছবি পড়া যায়নি [${imgRes.status}]`);
  const blob = await imgRes.blob();
  const body = new FormData();
  body.append("source", blob, "image.jpg");
  body.append("message", caption);
  body.append("published", "true");
  body.append("access_token", token);
  const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
    method: "POST",
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    post_id?: string;
    error?: { message?: string; error_user_msg?: string; error_user_title?: string };
  };
  if (!res.ok || json.error) {
    const detail = json.error?.error_user_msg || json.error?.error_user_title || "";
    throw new Error(
      `Facebook [${res.status}]: ${json.error?.message ?? "unknown error"}${detail ? ` — ${detail}` : ""}`,
    );
  }
  return json.post_id ?? json.id ?? "";
}

/** Posts the same image+caption to the Instagram account linked to the Page. */
export async function publishToInstagram(
  pageId: string,
  rawToken: string,
  imageUrl: string,
  caption: string,
  knownIgId?: string | null,
  video = false,
): Promise<{ igUserId: string; postId: string }> {
  const token = await resolvePageToken(rawToken, pageId);
  let igId = knownIgId ?? "";
  if (!igId) {
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(token)}`,
    );
    const j = (await r.json().catch(() => ({}))) as {
      instagram_business_account?: { id?: string; username?: string };
      error?: { message?: string };
    };
    igId = j.instagram_business_account?.id ?? "";
    if (!igId) {
      throw new Error(
        j.error?.message ?? "এই Facebook Page-এ কোনো Instagram Professional অ্যাকাউন্ট জুড়া নেই।",
      );
    }
  }
  const cRes = await fetch(`https://graph.facebook.com/v21.0/${igId}/media`, {
    method: "POST",
    body: new URLSearchParams({
      ...(video ? { media_type: "REELS", video_url: imageUrl } : { image_url: imageUrl }),
      caption: caption.slice(0, 2200),
      access_token: token,
    }),
  });
  const cJson = (await cRes.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!cRes.ok || cJson.error) {
    throw new Error(`Instagram [${cRes.status}]: ${cJson.error?.message ?? "unknown error"}`);
  }
  const containerId = cJson.id!;
  let finished = false;
  for (let i = 0; i < (video ? 60 : 10); i++) {
    await new Promise((r) => setTimeout(r, video ? 4000 : 1500));
    const sRes = await fetch(
      `https://graph.facebook.com/v21.0/${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
    );
    const sJson = (await sRes.json().catch(() => ({}))) as {
      status_code?: string;
      error?: { message?: string };
    };
    if (sJson.error) throw new Error(`Instagram [${sRes.status}]: ${sJson.error.message}`);
    if (sJson.status_code === "FINISHED") {
      finished = true;
      break;
    }
    if (sJson.status_code === "ERROR" || sJson.status_code === "EXPIRED") {
      throw new Error("Instagram: ছবিটি প্রসেস করা যায়নি।");
    }
  }
  if (!finished) throw new Error("Instagram: ছবি প্রসেস হতে বেশি সময় নিচ্ছে।");
  const pRes = await fetch(`https://graph.facebook.com/v21.0/${igId}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({ creation_id: containerId, access_token: token }),
  });
  const pJson = (await pRes.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!pRes.ok || pJson.error) {
    throw new Error(`Instagram [${pRes.status}]: ${pJson.error?.message ?? "unknown error"}`);
  }
  return { igUserId: igId, postId: pJson.id ?? "" };
}

/** Publishes a photo story to the Facebook Page (unpublished photo -> photo_stories). */
async function publishFbStory(pageId: string, token: string, imageUrl: string) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`স্টোরির ছবি পড়া যায়নি [${imgRes.status}]`);
  const blob = await imgRes.blob();
  const up = new FormData();
  up.append("source", blob, "story.jpg");
  up.append("published", "false");
  up.append("access_token", token);
  const upRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, { method: "POST", body: up });
  const upJson = (await upRes.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!upRes.ok || upJson.error || !upJson.id) {
    throw new Error(`Facebook Story [${upRes.status}]: ${upJson.error?.message ?? "ছবি আপলোড ব্যর্থ"}`);
  }
  const stRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photo_stories`, {
    method: "POST",
    body: new URLSearchParams({ photo_id: upJson.id, access_token: token }),
  });
  const stJson = (await stRes.json().catch(() => ({}))) as { success?: boolean; post_id?: string; error?: { message?: string } };
  if (!stRes.ok || stJson.error) {
    throw new Error(`Facebook Story [${stRes.status}]: ${stJson.error?.message ?? "unknown error"}`);
  }
  return stJson.post_id ?? "";
}

/** Publishes a photo story to the Instagram account (media_type STORIES). */
async function publishIgStory(igId: string, token: string, imageUrl: string) {
  const cRes = await fetch(`https://graph.facebook.com/v21.0/${igId}/media`, {
    method: "POST",
    body: new URLSearchParams({ media_type: "STORIES", image_url: imageUrl, access_token: token }),
  });
  const cJson = (await cRes.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!cRes.ok || cJson.error) throw new Error(`Instagram Story [${cRes.status}]: ${cJson.error?.message ?? "unknown error"}`);
  const containerId = cJson.id!;
  let finished = false;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const sRes = await fetch(
      `https://graph.facebook.com/v21.0/${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
    );
    const sJson = (await sRes.json().catch(() => ({}))) as { status_code?: string; error?: { message?: string } };
    if (sJson.error) throw new Error(`Instagram Story [${sRes.status}]: ${sJson.error.message}`);
    if (sJson.status_code === "FINISHED") { finished = true; break; }
    if (sJson.status_code === "ERROR" || sJson.status_code === "EXPIRED") throw new Error("Instagram Story: ছবি প্রসেস করা যায়নি।");
  }
  if (!finished) throw new Error("Instagram Story: ছবি প্রসেস হতে বেশি সময় নিচ্ছে।");
  const pRes = await fetch(`https://graph.facebook.com/v21.0/${igId}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({ creation_id: containerId, access_token: token }),
  });
  const pJson = (await pRes.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!pRes.ok || pJson.error) throw new Error(`Instagram Story [${pRes.status}]: ${pJson.error?.message ?? "unknown error"}`);
  return pJson.id ?? "";
}

/** Publish one post row that has already been claimed (status = posting). */
export async function publishClaimedPost(db: DB, post: { id: string; image_path: string; caption: string; user_id?: string }) {
  try {
    let creds: { pageId?: string | null; token?: string | null; igUserId?: string | null } | undefined;
    if (post.user_id) {
      const { data: s } = await db
        .from("settings")
        .select("fb_page_id, fb_token, ig_user_id")
        .eq("user_id", post.user_id)
        .maybeSingle();
      if (s?.fb_page_id && s?.fb_token) creds = { pageId: s.fb_page_id, token: s.fb_token, igUserId: s.ig_user_id };
    }
    const pageId = creds?.pageId || process.env["FACEBOOK_PAGE_ID"];
    const rawToken = creds?.token || process.env["FACEBOOK_PAGE_ACCESS_TOKEN"];
    const url = await signedUrl(db, post.image_path, 3600);
    const video = isVideoPath(post.image_path);
    const fbId = await publishToFacebook(url, post.caption, { ...(creds ?? {}), video });
    // Facebook succeeded — try Instagram too; its failure does not fail the post.
    let igId: string | null = null;
    let igErr: string | null = null;
    if (pageId && rawToken) {
      try {
        const ig = await publishToInstagram(pageId, rawToken, url, post.caption, creds?.igUserId ?? null, video);
        igId = ig.postId;
        if (ig.igUserId && post.user_id && ig.igUserId !== creds?.igUserId) {
          await db.from("settings").upsert({
            user_id: post.user_id,
            ig_user_id: ig.igUserId,
            updated_at: new Date().toISOString(),
          });
        }
      } catch (e) {
        igErr = e instanceof Error ? e.message : String(e);
      }
      // Stories: photo posts also go to the Facebook + Instagram story (best effort).
      if (!video) {
        try {
          const storyToken = await resolvePageToken(rawToken, pageId);
          await publishFbStory(pageId, storyToken, url);
        } catch (e) {
          igErr = [igErr, `FB Story: ${e instanceof Error ? e.message : String(e)}`].filter(Boolean).join(" | ");
        }
        try {
          let igIdForStory = creds?.igUserId ?? "";
          if (!igIdForStory) {
            const storyToken = await resolvePageToken(rawToken, pageId);
            const r = await fetch(
              `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account{id}&access_token=${encodeURIComponent(storyToken)}`,
            );
            const j = (await r.json().catch(() => ({}))) as { instagram_business_account?: { id?: string } };
            igIdForStory = j.instagram_business_account?.id ?? "";
          }
          if (igIdForStory) {
            const storyToken = await resolvePageToken(rawToken, pageId);
            await publishIgStory(igIdForStory, storyToken, url);
          }
        } catch (e) {
          igErr = [igErr, `IG Story: ${e instanceof Error ? e.message : String(e)}`].filter(Boolean).join(" | ");
        }
      }
    }
    await db
      .from("posts")
      .update({
        status: "posted",
        fb_post_id: fbId,
        ig_post_id: igId,
        ig_error: igErr,
        posted_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", post.id);
    return { ok: true as const, igError: igErr };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("posts").update({ status: "failed", error: msg }).eq("id", post.id);
    return { ok: false as const, error: msg };
  }
}

/** Likes, comments and reach for a Facebook post (best effort). */
export async function fetchFbPostStats(postId: string, token: string) {
  const r = await fetch(
    `https://graph.facebook.com/v21.0/${postId}?fields=reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares,insights.metric(post_impressions_unique)&access_token=${encodeURIComponent(token)}`,
  );
  const j = (await r.json().catch(() => ({}))) as {
    reactions?: { summary?: { total_count?: number } };
    comments?: { summary?: { total_count?: number } };
    shares?: { count?: number };
    insights?: { data?: { values?: { value?: number }[] }[] };
    error?: { message?: string };
  };
  if (j.error) return { likes: 0, comments: 0, shares: 0, reach: 0, error: j.error.message ?? "error" };
  return {
    likes: j.reactions?.summary?.total_count ?? 0,
    comments: j.comments?.summary?.total_count ?? 0,
    shares: j.shares?.count ?? 0,
    reach: j.insights?.data?.[0]?.values?.[0]?.value ?? 0,
    error: null as string | null,
  };
}

export { resolvePageToken };
