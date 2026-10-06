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

export async function generateBanglaCaption(imageUrl: string, hint?: string) {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      reasoning: { effort: "low" },
      instructions:
        "তুমি একজন দক্ষ বাংলা সোশ্যাল মিডিয়া কপিরাইটার। ছবির ডিজাইন দেখে একটি আকর্ষণীয় ফেসবুক পেজ পোস্ট ক্যাপশন লেখো — শুধু বাংলায়। ২-৪ লাইন, প্রাসঙ্গিক ইমোজি, শেষে ৩-৫টি হ্যাশট্যাগ। ছবিতে লেখা থাকলে তার মর্ম ধরে লেখো। শুধু ক্যাপশনটি দাও, অন্য কিছু নয়।",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: hint ? `অতিরিক্ত নির্দেশনা: ${hint}` : "এই পোস্টের জন্য ক্যাপশন লেখো।" },
            { type: "input_image", image_url: imageUrl },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
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

  const paths = (posts ?? []).map((p) => p.image_path);
  const links: Record<string, string> = {};
  if (paths.length) {
    const { data } = await db.storage.from(BUCKET).createSignedUrls(paths, 60 * 60 * 24 * 7);
    data?.forEach((d) => {
      if (d.path && d.signedUrl) links[d.path] = d.signedUrl;
    });
  }
  const rows = [
    ["Post ID", "Image (7-day link)", "Caption", "Schedule (Dhaka)", "Status", "Facebook Post ID", "Error"],
    ...(posts ?? []).map((p) => [
      p.id,
      links[p.image_path] ?? p.image_path,
      p.caption,
      p.scheduled_at
        ? new Date(p.scheduled_at).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })
        : "",
      STATUS_BN[p.status] ?? p.status,
      p.fb_post_id ?? "",
      p.error ?? "",
    ]),
  ];
  const sheet = `'${settings.sheet_name.replace(/'/g, "''")}'`;
  const id = settings.spreadsheet_id;
  const h = sheetHeaders();
  const clear = await fetch(`${SHEETS}/spreadsheets/${id}/values/${sheet}!A:G:clear`, {
    method: "POST",
    headers: h,
    body: "{}",
  });
  if (!clear.ok) throw new Error(`Sheet error [${clear.status}]: ${(await clear.text()).slice(0, 300)}`);
  const put = await fetch(
    `${SHEETS}/spreadsheets/${id}/values/${sheet}!A1:G${rows.length}?valueInputOption=RAW`,
    { method: "PUT", headers: h, body: JSON.stringify({ values: rows }) },
  );
  if (!put.ok) throw new Error(`Sheet error [${put.status}]: ${(await put.text()).slice(0, 300)}`);
  return { skipped: false, rows: rows.length - 1 };
}

/** Posts a photo to the Facebook Page. Returns the Facebook post id. */
export async function publishToFacebook(
  imageUrl: string,
  caption: string,
  creds?: { pageId?: string | null; token?: string | null },
) {
  const pageId = creds?.pageId || process.env["FACEBOOK_PAGE_ID"];
  const token = creds?.token || process.env["FACEBOOK_PAGE_ACCESS_TOKEN"];
  if (!pageId || !token) throw new Error("Facebook Page যুক্ত করা হয়নি (Page ID / Token নেই)।");
  const body = new URLSearchParams({ url: imageUrl, message: caption, access_token: token });
  const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
    method: "POST",
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    post_id?: string;
    error?: { message?: string };
  };
  if (!res.ok || json.error) {
    throw new Error(`Facebook [${res.status}]: ${json.error?.message ?? "unknown error"}`);
  }
  return json.post_id ?? json.id ?? "";
}

/** Publish one post row that has already been claimed (status = posting). */
export async function publishClaimedPost(db: DB, post: { id: string; image_path: string; caption: string; user_id?: string }) {
  try {
    let creds: { pageId?: string | null; token?: string | null } | undefined;
    if (post.user_id) {
      const { data: s } = await db.from("settings").select("fb_page_id, fb_token").eq("user_id", post.user_id).maybeSingle();
      if (s?.fb_page_id && s?.fb_token) creds = { pageId: s.fb_page_id, token: s.fb_token };
    }
    const url = await signedUrl(db, post.image_path, 3600);
    const fbId = await publishToFacebook(url, post.caption, creds);
    await db
      .from("posts")
      .update({ status: "posted", fb_post_id: fbId, posted_at: new Date().toISOString(), error: null })
      .eq("id", post.id);
    return { ok: true as const };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("posts").update({ status: "failed", error: msg }).eq("id", post.id);
    return { ok: false as const, error: msg };
  }
}
