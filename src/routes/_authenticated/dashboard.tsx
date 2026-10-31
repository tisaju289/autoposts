import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { defaultPageSlots, dhakaInput, recentFirst, reviewIntervalSlots, type ReviewSlot } from "@/lib/page-scope";
import { ReviewIntervals } from "@/components/review-intervals";
import { Calendar, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateCaption, generateCaptionVariations, importDriveLinks, listPages, publishNow, syncSheet } from "@/lib/posts.functions";
import { TONE_OPTIONS } from "@/lib/tones";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Database } from "@/integrations/supabase/types";

type Post = Database["public"]["Tables"]["posts"]["Row"];

export const Route = createFileRoute("/_authenticated/dashboard")({
  validateSearch: z.object({ page: z.string().uuid().optional() }),
  head: () => ({
    meta: [
      { title: "Dashboard — Auto Posts" },
      { name: "description", content: "Review captions and schedule your Facebook Page posts." },
      { property: "og:title", content: "Dashboard — Auto Posts" },
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

function Dashboard() {
  const { user } = Route.useRouteContext();
  const router = useRouter();
  const qc = useQueryClient();
  const sync = useServerFn(syncSheet);
  const pagesFn = useServerFn(listPages);
  const { page } = Route.useSearch();
  const pageRef = page ?? null;
  const pagesQ = useQuery({ queryKey: ["pages", user.id], queryFn: () => pagesFn() });
  const pages = pagesQ.data ?? [];
  const validPage = !page || pages.some((p) => p.id === page);
  const scopeReady = pagesQ.isSuccess && validPage;
  const pageName = pages.find((p) => p.id === page)?.name ?? "মূল পেজ";
  const selectPage = (value: string) => router.navigate({ to: "/dashboard", search: value ? { page: value } : {} });
  const [tab, setTab] = useState("draft");
  const [reviewTimes, setReviewTimes] = useState<{ pageRef: string | null; slots: Record<string, ReviewSlot> } | null>(null);

  const posts = useQuery({
    queryKey: ["posts", user.id, pageRef],
    enabled: scopeReady,
    queryFn: async () => {
      const query = supabase.from("posts").select("*").eq("user_id", user.id);
      const scoped = pageRef ? query.eq("page_ref", pageRef) : query.is("page_ref", null);
      const { data, error } = await scoped
        .order("scheduled_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      const list = data ?? [];
      const urls: Record<string, string> = {};
      const paths = list.map((p) => p.image_path).filter(Boolean);
      if (paths.length) {
        const { data: s } = await supabase.storage
          .from("post-images")
          .createSignedUrls(paths, 3600);
        s?.forEach((x) => x.path && x.signedUrl && (urls[x.path] = x.signedUrl));
      }
      return { list, urls };
    },
    refetchInterval: 60_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["posts"] });
  const reelAttempts = useRef(new Set<string>());
  useEffect(() => {
    for (const post of posts.data?.list ?? []) {
      if (!['draft', 'scheduled', 'failed'].includes(post.status) || !post.image_path || post.reel_path || /\.(mp4|mov|m4v|webm)$/i.test(post.image_path) || reelAttempts.current.has(post.id)) continue;
      reelAttempts.current.add(post.id);
      void import('@/lib/reel-renderer').then(({ preparePostReel }) => preparePostReel(post.id))
        .catch(() => undefined)
        .finally(() => { void qc.invalidateQueries({ queryKey: ['posts', user.id] }); });
    }
  }, [posts.data, qc, user.id]);
  const syncQuiet = async () => {
    try {
      await sync();
    } catch (e) {
      toast.error("Sheet sync: " + (e instanceof Error ? e.message : "failed"));
    }
  };

  const defaultSlots = useMemo(() => defaultPageSlots(posts.data?.list ?? []), [posts.data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    posts.data?.list.forEach((p) => (c[p.status] = (c[p.status] ?? 0) + 1));
    return c;
  }, [posts.data]);

  const shown = recentFirst(
    (posts.data?.list ?? []).filter((p) =>
      tab === "posted" ? p.status === "posted" : tab === "failed" ? p.status === "failed" : tab === "scheduled" ? p.status === "scheduled" || p.status === "posting" : p.status === "draft",
    ),
  );

  const scheduledCount = (counts["scheduled"] ?? 0) + (counts["posting"] ?? 0);
  const stats = [
    { k: "draft", label: "Review বাকি", n: counts["draft"] ?? 0 },
    { k: "scheduled", label: "Scheduled", n: scheduledCount },
    { k: "posted", label: "Posted", n: counts["posted"] ?? 0 },
    { k: "failed", label: "Failed", n: counts["failed"] ?? 0 },
  ];

  const [active, setActive] = useState("top");
  const navCounts = { draft: counts["draft"] ?? 0, scheduled: scheduledCount, posted: counts["posted"] ?? 0, failed: counts["failed"] ?? 0 };

  const go = (k: string) => {
    setActive(k);
    if (k === "settings" || k === "analytics") {
      if (k === "analytics") router.navigate({ to: "/analytics", search: page ? { page } : {} });
      else router.navigate({ to: "/settings" });
      return;
    }
    if (k === "top") window.scrollTo({ top: 0, behavior: "smooth" });
    else document.getElementById(k)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <AppShell email={user.email} userId={user.id} counts={navCounts} active={active} onNav={go}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <h1 className="text-xl font-bold">ড্যাশবোর্ড</h1>
          <div className="flex w-full min-w-0 items-center gap-3 sm:w-auto">
            <label htmlFor="dashboard-page" className="shrink-0 text-sm font-medium">Facebook পেজ</label>
            <select id="dashboard-page" aria-label="Facebook পেজ বাছাই করুন" value={page ?? ""} disabled={pagesQ.isPending} onChange={(e) => selectPage(e.target.value)} className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm sm:w-64">
              <option value="">মূল পেজ</option>
              {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              {!validPage && <option value={page}>পেজটি আর নেই</option>}
            </select>
          </div>
        </div>
        {pagesQ.isError && <p role="alert" className="text-sm text-destructive">পেজের তালিকা আনা যায়নি। <Button variant="outline" size="sm" onClick={() => pagesQ.refetch()}>আবার চেষ্টা করুন</Button></p>}
        {!validPage && <p role="alert" className="text-sm text-destructive">এই পেজটি সরানো হয়েছে। অন্য একটি পেজ বাছুন।</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <button
              key={s.k}
              onClick={() => { setTab(s.k); document.getElementById("posts")?.scrollIntoView({ behavior: "smooth" }); }}
              className={`rounded-2xl border bg-card p-4 text-left shadow-card transition hover:border-primary ${tab === s.k ? "border-primary ring-1 ring-primary" : ""}`}
            >
              <div className="text-xs text-muted-foreground sm:text-sm">{s.label}</div>
              <div className={`mt-1 text-2xl font-extrabold sm:text-3xl ${s.k === "failed" && s.n > 0 ? "text-destructive" : ""}`}>{s.n}</div>
            </button>
          ))}
        </div>

        <section id="add-design" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-bold">১. ডিজাইন যোগ করুন</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <Uploader key={`upload-${pageRef ?? "main"}`} disabled={!scopeReady} pageRef={pageRef} userId={user.id} onDone={async () => { refresh(); await syncQuiet(); }} />
            <DriveImport key={`drive-${pageRef ?? "main"}`} disabled={!scopeReady} pageRef={pageRef} userId={user.id} onDone={async () => { refresh(); await syncQuiet(); }} />
          </div>
        </section>

        <section id="posts" className="scroll-mt-24 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <h2 className="text-lg font-bold">২. রিভিউ ও শিডিউল <span className="text-sm font-normal text-muted-foreground">— {pageName}</span></h2>
            <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={async () => { await syncQuiet(); toast.success("Google Sheet আপডেট হয়েছে"); }}>
              Sync to Google Sheet
            </Button>
          </div>
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-max">
                {stats.map((s) => (
                  <TabsTrigger key={s.k} value={s.k}>
                    {s.label} <span className="ml-1.5 text-xs opacity-60">{s.n}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {tab === "draft" && scopeReady && shown.length > 0 && (
            <ReviewIntervals
              key={pageRef ?? "main"}
              count={shown.length}
              start={defaultSlots[shown[0]?.id ?? ""] ?? { d: dhakaInput(shown[0]?.scheduled_at ?? new Date().toISOString()).slice(0, 10), t: "06:00" }}
              onApply={(start, minutes, days) => {
                const slots = reviewIntervalSlots(shown, start, minutes, days);
                setReviewTimes({ pageRef, slots });
                toast.success(`${shown.length} পোস্টের সময় সাজানো হয়েছে — অনুমোদন বাকি`);
              }}
            />
          )}

          {posts.isError ? (
            <p role="alert" className="text-destructive">পোস্ট আনা যায়নি। <Button variant="outline" size="sm" onClick={() => posts.refetch()}>আবার চেষ্টা করুন</Button></p>
          ) : posts.isLoading || pagesQ.isPending ? (
            <p className="text-muted-foreground">লোড হচ্ছে…</p>
          ) : shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">এখানে কোনো পোস্ট নেই।</div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((p) => (
                <PostCard key={p.id} post={p} img={posts.data?.urls[p.image_path]} defaultDt={defaultSlots[p.id]} reviewDt={p.status === "draft" && reviewTimes?.pageRef === pageRef ? reviewTimes.slots[p.id] : undefined} onChange={async () => { refresh(); await syncQuiet(); }} />
              ))}
            </div>
          )}
        </section>

    </AppShell>
  );
}

// Upload the original file untouched — no resizing or quality change (limit: 20MB).

function Uploader({ userId, pageRef, disabled, onDone }: { userId: string; pageRef: string | null; disabled: boolean; onDone: () => void }) {
  const gen = useServerFn(generateCaption);
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [drag, setDrag] = useState(false);

  async function handle(files: FileList | File[]) {
    if (disabled || progress) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (!list.length) return;
    setProgress({ done: 0, total: list.length });
    const ids: string[] = [];
    for (const orig of list) {
      const isVid = orig.type.startsWith("video/");
      if (orig.size > (isVid ? 500 : 20) * 1024 * 1024) {
        toast.error(`${orig.name}: ফাইলটি ${isVid ? "500MB" : "20MB"}-এর বেশি — আপলোড হয়নি`);
        continue;
      }
      let ext = orig.name.includes(".") ? (orig.name.split(".").pop() ?? "jpg").toLowerCase() : (isVid ? "mp4" : "jpg");
      if (isVid && !/^(mp4|mov|m4v|webm)$/.test(ext)) ext = "mp4";
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("post-images").upload(path, orig, { contentType: orig.type || "image/jpeg" });
      if (up.error) { toast.error(`${orig.name}: ${up.error.message}`); continue; }
      const { data, error } = await supabase.from("posts").insert({ user_id: userId, image_path: path, page_ref: pageRef }).select("id").single();
      if (error) { toast.error(error.message); continue; }
      ids.push(data.id);
    }
    onDone();
    // Generate captions five at a time.
    let done = 0;
    const queue = [...ids];
    let stop = false;
    const worker = async () => {
      while (queue.length && !stop) {
        const id = queue.shift();
        if (!id) break;
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
    await Promise.all(Array.from({ length: 5 }, worker));
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
      <p className="mt-2 max-w-md text-muted-foreground">একসাথে অনেকগুলো ছবি টেনে আনুন। প্রতিটির জন্য AI বাংলা ক্যাপশন লিখে দেবে। ভিডিও দিলে Facebook ভিডিও ও Instagram Reels হিসেবে যাবে। কোয়ালিটি অপরিবর্তিত থাকে (ছবি সর্বোচ্চ 20MB, ভিডিও 500MB)।</p>
      <input ref={input} type="file" accept="image/*,video/mp4,video/quicktime,video/webm" multiple hidden onChange={(e) => e.target.files && handle(e.target.files)} />
      <Button className="mt-6" size="lg" disabled={disabled || !!progress} onClick={() => input.current?.click()}>
        {progress ? `ক্যাপশন তৈরি হচ্ছে ${progress.done}/${progress.total}` : "ছবি / ভিডিও বাছাই করুন"}
      </Button>
    </div>
  );
}

function DriveImport({ userId, pageRef, disabled, onDone }: { userId: string; pageRef: string | null; disabled: boolean; onDone: () => void }) {
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
    if (disabled || busy) return;
    if (!links.trim()) { toast.error("Drive লিংক পেস্ট করুন"); return; }
    setBusy(true);
    try {
      const r = await imp({ data: { links, pageRef } });
      r.errors.forEach((e) => toast.error(e));
      if (!r.created.length) { toast.error("কোনো ছবি আনা যায়নি — ফাইলগুলো কি Drive-এ আছে?"); return; }
      toast.success(`${r.created.length} টি ছবি Drive থেকে এসেছে — ক্যাপশন লেখা হচ্ছে…`);
      setLinks("");
      onDone();
      // Generate captions five at a time, like the uploader.
      const queue = [...r.created];
      let done = 0;
      let stop = false;
      setProgress({ done: 0, total: queue.length });
      const worker = async () => {
        while (queue.length && !stop) {
          const id = queue.shift();
        if (!id) break;
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
      await Promise.all(Array.from({ length: 5 }, worker));
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
      <Button className="mt-3 w-full" variant="secondary" disabled={disabled || busy} onClick={run}>
        {progress ? `ক্যাপশন তৈরি হচ্ছে ${progress.done}/${progress.total}` : busy ? "Drive থেকে আনা হচ্ছে…" : "Drive থেকে আনুন"}
      </Button>
    </div>
  );
}

function PostCard({ post, img, defaultDt, reviewDt, onChange }: { post: Post; img?: string | undefined; defaultDt?: ReviewSlot | undefined; reviewDt?: ReviewSlot | undefined; onChange: () => void }) {
  const gen = useServerFn(generateCaption);
  const pub = useServerFn(publishNow);
  const vary = useServerFn(generateCaptionVariations);
  const [tone, setTone] = useState("");
  const [ideas, setIdeas] = useState<string[] | null>(null);
  const [caption, setCaption] = useState(post.caption);
  const [dt, setDt] = useState(() => {
    const v = dhakaInput(post.scheduled_at);
    if (v) return { d: v.slice(0, 10), t: v.slice(11, 16) };
    return defaultDt ?? { d: dhakaInput(new Date().toISOString()).slice(0, 10), t: "06:00" };
  });
  const when = dt.d && dt.t ? `${dt.d}T${dt.t}` : "";
  const [busy, setBusy] = useState<string | null>(null);
  const locked = post.status === "posted" || post.status === "posting";

  useEffect(() => setCaption(post.caption), [post.caption]);
  useEffect(() => {
    if (reviewDt) setDt(reviewDt);
  }, [reviewDt]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Error"); } finally { setBusy(null); }
  }

  const schedule = () =>
    run("schedule", async () => {
      if (!caption.trim()) throw new Error("ক্যাপশন খালি");
      if (!when) throw new Error("পোস্টের সময় দিন");
      const at = new Date(`${when}:00+06:00`);
      if (at.getTime() < Date.now() - 60_000) throw new Error("ভবিষ্যতের সময় দিন");
      try {
        const { preparePostReel } = await import('@/lib/reel-renderer');
        await preparePostReel(post.id);
      } catch {
        // Reels preparation must not block Feed scheduling.
      }
      const { error } = await supabase.from("posts").update({ caption, scheduled_at: at.toISOString(), status: "scheduled", error: null }).eq("id", post.id).eq("user_id", post.user_id);
      if (error) throw error;
      toast.success("Scheduled ✓");
      onChange();
    });

  const saveDraft = () =>
    run("save", async () => {
      const { error } = await supabase.from("posts").update({ caption, scheduled_at: when ? new Date(`${when}:00+06:00`).toISOString() : null }).eq("id", post.id).eq("user_id", post.user_id);
      if (error) throw error;
      toast.success("সেভ হয়েছে");
      onChange();
    });

  const unschedule = () =>
    run("unschedule", async () => {
      await supabase.from("posts").update({ status: "draft" }).eq("id", post.id).eq("user_id", post.user_id);
      onChange();
    });

  const regen = () =>
    run("regen", async () => {
      const r = await gen({ data: { postId: post.id, ...(tone ? { tone } : {}) } });
      setCaption(r.caption);
      onChange();
    });

  const threeIdeas = () =>
    run("ideas", async () => {
      const r = await vary({ data: { postId: post.id, ...(tone ? { tone } : {}) } });
      setIdeas(r.captions);
    });

  const pickIdea = (c: string) =>
    run("pick", async () => {
      setCaption(c);
      setIdeas(null);
      await supabase.from("posts").update({ caption: c }).eq("id", post.id);
      onChange();
    });

  const postNow = () =>
    run("now", async () => {
      if (!caption.trim()) throw new Error('ক্যাপশন খালি');
      try {
        const { preparePostReel } = await import('@/lib/reel-renderer');
        await preparePostReel(post.id);
      } catch {
        // Reels preparation must not block Feed publishing.
      }
      const { error } = await supabase.from("posts").update({ caption }).eq("id", post.id).eq("user_id", post.user_id);
      if (error) throw error;
      await pub({ data: { postId: post.id } });
      toast.success("Facebook এ পোস্ট হয়েছে!");
      onChange();
    });

  const remove = () =>
    run("del", async () => {
      if (!confirm("পোস্টটি মুছে ফেলবেন?")) return;
      const { count } = await supabase.from("posts").select("id", { count: "exact", head: true }).eq("image_path", post.image_path).neq("id", post.id);
      if (!count) await supabase.storage.from("post-images").remove([post.image_path]);
      if (post.reel_path) await supabase.storage.from('post-images').remove([post.reel_path]);
      await supabase.from("posts").delete().eq("id", post.id);
      onChange();
    });

  const badgeVariant = post.status === "failed" ? "destructive" : post.status === "posted" ? "default" : "secondary";

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-card">
      <div className="relative aspect-square bg-muted">
        {img && /\.(mp4|mov|m4v|webm)$/i.test(post.image_path) ? <video src={img} controls preload="metadata" className="h-full w-full bg-foreground object-contain" /> : img && <img src={img} alt="Post design" className="h-full w-full object-cover" loading="lazy" />}
        <Badge variant={badgeVariant} className="absolute left-3 top-3">{STATUS_LABEL[post.status] ?? post.status}</Badge>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Textarea rows={8} value={caption} disabled={locked} onChange={(e) => setCaption(e.target.value)} placeholder={busy === "regen" ? "ক্যাপশন লেখা হচ্ছে…" : "ক্যাপশন তৈরি হচ্ছে…"} />
        {!locked && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <select value={tone} onChange={(e) => setTone(e.target.value)} className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm" aria-label="ক্যাপশনের টোন">
              <option value="">টোন: সেটিংস অনুযায়ী</option>
              {TONE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={threeIdeas}>{busy === "ideas" ? "ভাবছে…" : "৩টি আইডিয়া"}</Button>
          </div>
        )}
        {ideas && (
          <div className="space-y-2 rounded-xl border bg-muted/40 p-2">
            <div className="flex items-center justify-between px-1 text-xs font-semibold">পছন্দেরটি বেছে নিন <button className="text-muted-foreground" onClick={() => setIdeas(null)}>বন্ধ</button></div>
            {ideas.map((c, i) => (
              <button key={i} onClick={() => pickIdea(c)} className="block w-full whitespace-pre-line rounded-lg border bg-card p-2 text-left text-xs transition hover:border-primary">
                <span className="mb-1 block font-bold text-primary">আইডিয়া {i + 1}</span>{c}
              </button>
            ))}
          </div>
        )}
        {post.error && <p className="text-xs text-destructive">{post.error}</p>}
        {post.reel_error && <p role="alert" className="break-words text-xs text-destructive">Reels: {post.reel_error}</p>}
        {!/\.(mp4|mov|m4v|webm)$/i.test(post.image_path) && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Facebook Reels: {post.fb_reel_id ? 'প্রকাশিত ✓' : post.status === 'posted' ? 'প্রকাশ হয়নি' : post.reel_path ? 'প্রস্তুত ✓' : post.reel_error ? 'তৈরি হয়নি' : 'তৈরি হচ্ছে…'}</span>
            {post.ig_reel_id && <span>Instagram Reels: প্রকাশিত ✓</span>}
            {!locked && post.reel_error && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('reel', async () => {
              const { preparePostReel } = await import('@/lib/reel-renderer');
              await preparePostReel(post.id);
              onChange();
            })}>Reels আবার তৈরি করুন</Button>}
          </div>
        )}
        {post.status === "posted" ? (
          <p className="text-sm text-muted-foreground">
            পোস্ট হয়েছে: {post.posted_at && new Date(post.posted_at).toLocaleString()}
            {post.fb_post_id && (
              <a className="ml-2 text-primary hover:underline" href={`https://facebook.com/${post.fb_post_id}`} target="_blank" rel="noreferrer">দেখুন ↗</a>
            )}
          </p>
        ) : (
          <>
            <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
              <label className="flex items-center gap-1.5 px-0.5 text-[13px] font-semibold text-foreground">
                <Calendar className="h-4 w-4 text-primary" />
                পোস্টের তারিখ ও সময়
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
                  <Input type="date" className="pl-9" value={dt.d} disabled={locked} onChange={(e) => setDt((v) => ({ ...v, d: e.target.value }))} />
                </div>
                <div className="relative">
                  <Clock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
                  <Input type="time" className="pl-9" value={dt.t} disabled={locked} onChange={(e) => setDt((v) => ({ ...v, t: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="mt-auto space-y-2">
              {post.status === "scheduled" ? (
                <Button size="sm" variant="outline" className="w-full" disabled={!!busy} onClick={unschedule}>Unschedule</Button>
              ) : (
                <Button size="sm" className="w-full" disabled={!!busy || locked} onClick={schedule}>{busy === "schedule" ? "Reels ও শিডিউল প্রস্তুত হচ্ছে…" : "Approve & Schedule"}</Button>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="secondary" disabled={!!busy || locked} onClick={saveDraft}>Save</Button>
                <Button size="sm" variant="secondary" disabled={!!busy || locked} onClick={postNow}>{busy === "now" ? "পোস্ট হচ্ছে…" : "এখনই পোস্ট"}</Button>
                <Button size="sm" variant="ghost" disabled={!!busy || locked} onClick={regen}>{busy === "regen" ? "লিখছে…" : "নতুন ক্যাপশন"}</Button>
                <Button size="sm" variant="ghost" className="text-destructive" disabled={!!busy || locked} onClick={remove}>Delete</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </article>
  );
}
