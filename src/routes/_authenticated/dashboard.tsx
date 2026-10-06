import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { facebookStatus, generateCaption, importDriveLinks, publishNow, saveFacebookCreds, syncSheet } from "@/lib/posts.functions";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Database } from "@/integrations/supabase/types";

type Post = Database["public"]["Tables"]["posts"]["Row"];

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — PostPilot" },
      { name: "description", content: "Review captions and schedule your Facebook Page posts." },
      { property: "og:title", content: "Dashboard — PostPilot" },
      { property: "og:description", content: "Review captions and schedule your Facebook Page posts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

const STATUS_LABEL: Record<string, string> = {
  draft: "Review বাকি",
  scheduled: "Scheduled",
  posting: "Posting…",
  posted: "Posted",
  failed: "Failed",
};

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function Dashboard() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const sync = useServerFn(syncSheet);
  const [tab, setTab] = useState("draft");

  const posts = useQuery({
    queryKey: ["posts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("posts")
        .select("*")
        .order("scheduled_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      const list = data ?? [];
      const urls: Record<string, string> = {};
      if (list.length) {
        const { data: s } = await supabase.storage
          .from("post-images")
          .createSignedUrls(list.map((p) => p.image_path), 3600);
        s?.forEach((x) => x.path && x.signedUrl && (urls[x.path] = x.signedUrl));
      }
      return { list, urls };
    },
    refetchInterval: 60_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["posts"] });
  const syncQuiet = async () => {
    try {
      await sync();
    } catch (e) {
      toast.error("Sheet sync: " + (e instanceof Error ? e.message : "failed"));
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    posts.data?.list.forEach((p) => (c[p.status] = (c[p.status] ?? 0) + 1));
    return c;
  }, [posts.data]);

  const shown = (posts.data?.list ?? []).filter((p) =>
    tab === "posted" ? p.status === "posted" : tab === "failed" ? p.status === "failed" : tab === "scheduled" ? p.status === "scheduled" || p.status === "posting" : p.status === "draft",
  );

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <h1 className="text-2xl font-extrabold">
            Post<span className="text-primary">Pilot</span>
          </h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="hidden sm:inline">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            <Uploader userId={user.id} onDone={async () => { refresh(); await syncQuiet(); }} />
            <DriveImport userId={user.id} onDone={async () => { refresh(); await syncQuiet(); }} />
          </div>
          <div className="space-y-6">
            <FacebookSettings />
            <SheetSettings userId={user.id} onSaved={syncQuiet} />
            <DriveSettings userId={user.id} />
          </div>
        </div>

        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                {["draft", "scheduled", "posted", "failed"].map((k) => (
                  <TabsTrigger key={k} value={k}>
                    {STATUS_LABEL[k]} <span className="ml-1.5 text-xs opacity-60">{k === "scheduled" ? (counts["scheduled"] ?? 0) + (counts["posting"] ?? 0) : counts[k] ?? 0}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={async () => { await syncQuiet(); toast.success("Google Sheet আপডেট হয়েছে"); }}>
              Sync to Google Sheet
            </Button>
          </div>

          {posts.isLoading ? (
            <p className="text-muted-foreground">লোড হচ্ছে…</p>
          ) : shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">এখানে কোনো পোস্ট নেই।</div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((p) => (
                <PostCard key={p.id} post={p} img={posts.data?.urls[p.image_path]} onChange={async () => { refresh(); await syncQuiet(); }} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// Upload the original file untouched — no resizing or quality change (limit: 20MB).

function Uploader({ userId, onDone }: { userId: string; onDone: () => void }) {
  const gen = useServerFn(generateCaption);
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [drag, setDrag] = useState(false);

  async function handle(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    setProgress({ done: 0, total: list.length });
    const ids: string[] = [];
    for (const orig of list) {
      if (orig.size > 20 * 1024 * 1024) {
        toast.error(`${orig.name}: ফাইলটি 20MB-এর বেশি — আপলোড হয়নি`);
        continue;
      }
      const ext = orig.name.includes(".") ? orig.name.split(".").pop()!.toLowerCase() : "jpg";
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("post-images").upload(path, orig, { contentType: orig.type || "image/jpeg" });
      if (up.error) { toast.error(`${orig.name}: ${up.error.message}`); continue; }
      const { data, error } = await supabase.from("posts").insert({ user_id: userId, image_path: path }).select("id").single();
      if (error) { toast.error(error.message); continue; }
      ids.push(data.id);
    }
    onDone();
    // Generate captions two at a time.
    let done = 0;
    const queue = [...ids];
    let stop = false;
    const worker = async () => {
      while (queue.length && !stop) {
        const id = queue.shift()!;
        try {
          await gen({ data: { postId: id } });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Caption failed";
          toast.error(msg);
          if (/ক্রেডিট|credit/i.test(msg)) stop = true;
        }
        done++;
        setProgress({ done, total: ids.length });
      }
    };
    await Promise.all([worker(), worker()]);
    setProgress(null);
    toast.success(`${ids.length} টি পোস্ট তৈরি — ক্যাপশন রিভিউ করে সময় সেট করুন।`);
    onDone();
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files); }}
      className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed bg-card p-10 text-center shadow-card transition-colors ${drag ? "border-primary bg-primary/5" : ""}`}
    >
      <h2 className="text-3xl font-extrabold">ডিজাইন আপলোড করুন</h2>
      <p className="mt-2 max-w-md text-muted-foreground">একসাথে অনেকগুলো ছবি টেনে আনুন। প্রতিটির জন্য AI বাংলা ক্যাপশন লিখে দেবে। ছবির কোয়ালিটি অপরিবর্তিত থাকে (সর্বোচ্চ 20MB)।</p>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && handle(e.target.files)} />
      <Button className="mt-6" size="lg" disabled={!!progress} onClick={() => input.current?.click()}>
        {progress ? `ক্যাপশন তৈরি হচ্ছে ${progress.done}/${progress.total}` : "ছবি বাছাই করুন"}
      </Button>
    </div>
  );
}

function DriveImport({ userId, onDone }: { userId: string; onDone: () => void }) {
  const imp = useServerFn(importDriveLinks);
  const gen = useServerFn(generateCaption);
  const [links, setLinks] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    supabase.from("settings").select("drive_folder_id").eq("user_id", userId).maybeSingle().then(({ data }) => {
      if (data?.drive_folder_id) setLinks((l) => l || `https://drive.google.com/drive/folders/${data.drive_folder_id}`);
    });
  }, [userId]);

  async function run() {
    if (!links.trim()) { toast.error("Drive লিংক পেস্ট করুন"); return; }
    setBusy(true);
    try {
      const r = await imp({ data: { links } });
      r.errors.forEach((e) => toast.error(e));
      if (!r.created.length) { toast.error("কোনো ছবি আনা যায়নি — ফাইলগুলো কি Drive-এ আছে?"); return; }
      toast.success(`${r.created.length} টি ছবি Drive থেকে এসেছে — ক্যাপশন লেখা হচ্ছে…`);
      setLinks("");
      onDone();
      // Generate captions two at a time, like the uploader.
      const queue = [...r.created];
      let done = 0;
      let stop = false;
      setProgress({ done: 0, total: queue.length });
      const worker = async () => {
        while (queue.length && !stop) {
          const id = queue.shift()!;
          try {
            await gen({ data: { postId: id } });
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Caption failed";
            toast.error(msg);
            if (/ক্রেডিট|credit/i.test(msg)) stop = true;
          }
          done++;
          setProgress({ done, total: r.created.length });
        }
      };
      await Promise.all([worker(), worker()]);
      setProgress(null);
      toast.success("ক্যাপশন তৈরি — রিভিউ করে সময় সেট করুন।");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Drive থেকে আনা যায়নি");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-card">
      <h3 className="text-lg font-bold">Google Drive থেকে আনুন</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Drive <b>ফোল্ডারের লিংক</b> দিলে ভেতরের সব ছবি চলে আসবে। চাইলে আলাদা ফাইলের লিংকও দিতে পারেন — প্রতি লাইনে একটি (একবারে সর্বোচ্চ ৫০টি, 20MB পর্যন্ত)।
      </p>
      <Textarea
        className="mt-3"
        rows={4}
        placeholder={"https://drive.google.com/drive/folders/...\nঅথবা https://drive.google.com/file/d/.../view"}
        value={links}
        onChange={(e) => setLinks(e.target.value)}
      />
      <Button className="mt-3 w-full" variant="secondary" disabled={busy} onClick={run}>
        {progress ? `ক্যাপশন তৈরি হচ্ছে ${progress.done}/${progress.total}` : busy ? "Drive থেকে আনা হচ্ছে…" : "Drive থেকে আনুন"}
      </Button>
    </div>
  );
}

function FacebookSettings() {
  const status = useServerFn(facebookStatus);
  const save = useServerFn(saveFacebookCreds);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["fb-status"], queryFn: () => status() });
  const [pageId, setPageId] = useState("");
  const [token, setToken] = useState("");
  const [showId, setShowId] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (q.data?.pageId) setPageId(q.data.pageId);
  }, [q.data?.pageId]);

  async function onSave() {
    if (!pageId.trim() || !token.trim()) {
      toast.error("Page ID আর Token দুটোই দিন");
      return;
    }
    setSaving(true);
    try {
      await save({ data: { pageId: pageId.trim(), token: token.trim() } });
      setToken("");
      toast.success("Facebook Page সেভ হয়েছে");
      qc.invalidateQueries({ queryKey: ["fb-status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "সেভ হয়নি");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-bold">Facebook Page</h3>
        {q.isLoading ? (
          <Badge variant="secondary">চেক হচ্ছে…</Badge>
        ) : q.data?.connected ? (
          <Badge className="bg-green-600 text-white hover:bg-green-600">✓ Connected</Badge>
        ) : (
          <Badge variant="destructive">Connected নয়</Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">এই Page-এ আপনার পোস্টগুলো যাবে।</p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Page ID</label>
          <div className="relative mt-1">
            <Input
              type={showId ? "text" : "password"}
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              placeholder="যেমন: 123456789012345"
              className="pr-10"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowId((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showId ? "লুকান" : "দেখান"}
            >
              {showId ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Page Access Token</label>
          <div className="relative mt-1">
            <Input
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={q.data?.hasToken ? "নতুন Token দিলে আগেরটা বদলে যাবে" : "EAA... দিয়ে শুরু হওয়া Token"}
              className="pr-10"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showToken ? "লুকান" : "দেখান"}
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <Button onClick={onSave} disabled={saving} className="w-full">
          {saving ? "সেভ হচ্ছে…" : "সেভ করুন"}
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Token নিরাপদে সেভ হয় — সেভের পর আর পুরোটা দেখা যায় না।
      </p>
    </div>
  );
}

function SheetSettings({ userId, onSaved }: { userId: string; onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [sheetName, setSheetName] = useState("Sheet1");
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("settings").select("*").eq("user_id", userId).maybeSingle().then(({ data }) => {
      if (data?.spreadsheet_id) {
        setSaved(data.spreadsheet_id);
        setUrl(`https://docs.google.com/spreadsheets/d/${data.spreadsheet_id}/edit`);
        setSheetName(data.sheet_name);
      }
    });
  }, [userId]);

  async function save() {
    const id = url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1] ?? url.trim();
    if (!id) { toast.error("Sheet link দিন"); return; }
    const { error } = await supabase.from("settings").upsert({ user_id: userId, spreadsheet_id: id, sheet_name: sheetName || "Sheet1", updated_at: new Date().toISOString() });
    if (error) { toast.error(error.message); return; }
    setSaved(id);
    toast.success("Sheet সেভ হয়েছে");
    onSaved();
  }

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-card">
      <h3 className="text-lg font-bold">Google Sheet</h3>
      <p className="mt-1 text-sm text-muted-foreground">সব পোস্ট, ক্যাপশন ও সময় এই Sheet এ জমা হবে।</p>
      <div className="mt-4 space-y-2">
        <Input placeholder="https://docs.google.com/spreadsheets/d/..." value={url} onChange={(e) => setUrl(e.target.value)} />
        <Input placeholder="Tab name (Sheet1)" value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
        <Button className="w-full" variant="secondary" onClick={save}>Save</Button>
        {saved && (
          <a className="block text-center text-sm text-primary underline-offset-4 hover:underline" href={`https://docs.google.com/spreadsheets/d/${saved}/edit`} target="_blank" rel="noreferrer">
            Sheet খুলুন ↗
          </a>
        )}
      </div>
    </div>
  );
}

function DriveSettings({ userId }: { userId: string }) {
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("settings").select("drive_folder_id").eq("user_id", userId).maybeSingle().then(({ data }) => {
      if (data?.drive_folder_id) {
        setSaved(data.drive_folder_id);
        setUrl(`https://drive.google.com/drive/folders/${data.drive_folder_id}`);
      }
    });
  }, [userId]);

  async function save() {
    const id = url.match(/\/folders\/([a-zA-Z0-9-_]+)/)?.[1] ?? url.trim();
    if (!id) { toast.error("Drive ফোল্ডারের লিংক দিন"); return; }
    const { error } = await supabase.from("settings").upsert({ user_id: userId, drive_folder_id: id, updated_at: new Date().toISOString() });
    if (error) { toast.error(error.message); return; }
    setSaved(id);
    toast.success("Drive ফোল্ডার সেভ হয়েছে");
  }

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-card">
      <h3 className="text-lg font-bold">Google Drive ফোল্ডার</h3>
      <p className="mt-1 text-sm text-muted-foreground">আপনার ডিজাইনের ফোল্ডারের লিংক সেভ করে রাখুন — পরে এক ক্লিকে ছবি আনা সহজ হবে।</p>
      <div className="mt-4 space-y-2">
        <Input placeholder="https://drive.google.com/drive/folders/..." value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button className="w-full" variant="secondary" onClick={save}>Save</Button>
        {saved && (
          <a className="block text-center text-sm text-primary underline-offset-4 hover:underline" href={`https://drive.google.com/drive/folders/${saved}`} target="_blank" rel="noreferrer">
            ফোল্ডার খুলুন ↗
          </a>
        )}
      </div>
    </div>
  );
}

function PostCard({ post, img, onChange }: { post: Post; img?: string | undefined; onChange: () => void }) {
  const gen = useServerFn(generateCaption);
  const pub = useServerFn(publishNow);
  const [caption, setCaption] = useState(post.caption);
  const [when, setWhen] = useState(toLocalInput(post.scheduled_at));
  const [busy, setBusy] = useState<string | null>(null);
  const locked = post.status === "posted" || post.status === "posting";

  useEffect(() => setCaption(post.caption), [post.caption]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Error"); } finally { setBusy(null); }
  }

  const schedule = () =>
    run("schedule", async () => {
      if (!caption.trim()) throw new Error("ক্যাপশন খালি");
      if (!when) throw new Error("পোস্টের সময় দিন");
      const at = new Date(when);
      if (at.getTime() < Date.now() - 60_000) throw new Error("ভবিষ্যতের সময় দিন");
      const { error } = await supabase.from("posts").update({ caption, scheduled_at: at.toISOString(), status: "scheduled", error: null }).eq("id", post.id);
      if (error) throw error;
      toast.success("Scheduled ✓");
      onChange();
    });

  const saveDraft = () =>
    run("save", async () => {
      const { error } = await supabase.from("posts").update({ caption, scheduled_at: when ? new Date(when).toISOString() : null }).eq("id", post.id);
      if (error) throw error;
      toast.success("সেভ হয়েছে");
      onChange();
    });

  const unschedule = () =>
    run("unschedule", async () => {
      await supabase.from("posts").update({ status: "draft" }).eq("id", post.id);
      onChange();
    });

  const regen = () =>
    run("regen", async () => {
      const r = await gen({ data: { postId: post.id } });
      setCaption(r.caption);
      onChange();
    });

  const postNow = () =>
    run("now", async () => {
      await supabase.from("posts").update({ caption }).eq("id", post.id);
      await pub({ data: { postId: post.id } });
      toast.success("Facebook এ পোস্ট হয়েছে!");
      onChange();
    });

  const remove = () =>
    run("del", async () => {
      if (!confirm("পোস্টটি মুছে ফেলবেন?")) return;
      await supabase.storage.from("post-images").remove([post.image_path]);
      await supabase.from("posts").delete().eq("id", post.id);
      onChange();
    });

  const badgeVariant = post.status === "failed" ? "destructive" : post.status === "posted" ? "default" : "secondary";

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-card">
      <div className="relative aspect-square bg-muted">
        {img && <img src={img} alt="Post design" className="h-full w-full object-cover" loading="lazy" />}
        <Badge variant={badgeVariant} className="absolute left-3 top-3">{STATUS_LABEL[post.status] ?? post.status}</Badge>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Textarea rows={6} value={caption} disabled={locked} onChange={(e) => setCaption(e.target.value)} placeholder={busy === "regen" ? "ক্যাপশন লেখা হচ্ছে…" : "ক্যাপশন তৈরি হচ্ছে…"} />
        {post.error && <p className="text-xs text-destructive">{post.error}</p>}
        {post.status === "posted" ? (
          <p className="text-sm text-muted-foreground">
            পোস্ট হয়েছে: {post.posted_at && new Date(post.posted_at).toLocaleString()}
            {post.fb_post_id && (
              <a className="ml-2 text-primary hover:underline" href={`https://facebook.com/${post.fb_post_id}`} target="_blank" rel="noreferrer">দেখুন ↗</a>
            )}
          </p>
        ) : (
          <>
            <Input type="datetime-local" value={when} disabled={locked} onChange={(e) => setWhen(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              {post.status === "scheduled" ? (
                <Button size="sm" variant="outline" disabled={!!busy} onClick={unschedule}>Unschedule</Button>
              ) : (
                <Button size="sm" disabled={!!busy || locked} onClick={schedule}>{busy === "schedule" ? "…" : "Approve & Schedule"}</Button>
              )}
              <Button size="sm" variant="secondary" disabled={!!busy || locked} onClick={saveDraft}>Save</Button>
              <Button size="sm" variant="ghost" disabled={!!busy || locked} onClick={regen}>{busy === "regen" ? "লিখছে…" : "নতুন ক্যাপশন"}</Button>
              <Button size="sm" variant="ghost" disabled={!!busy || locked} onClick={postNow}>{busy === "now" ? "পোস্ট হচ্ছে…" : "এখনই পোস্ট"}</Button>
              <Button size="sm" variant="ghost" className="text-destructive" disabled={!!busy || locked} onClick={remove}>Delete</Button>
            </div>
          </>
        )}
      </div>
    </article>
  );
}
