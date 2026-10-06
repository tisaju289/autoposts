import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { facebookStatus, generateCaption, importDriveLinks, publishNow, saveFacebookCreds, syncSheet } from "@/lib/posts.functions";
import { Eye, EyeOff, LayoutDashboard, ImagePlus, CalendarClock, Settings, LogOut, Menu, X } from "lucide-react";
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

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function Dashboard() {
  const { user } = Route.useRouteContext();
  const router = useRouter();
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

  const scheduledCount = (counts["scheduled"] ?? 0) + (counts["posting"] ?? 0);
  const stats = [
    { k: "draft", label: "Review বাকি", n: counts["draft"] ?? 0 },
    { k: "scheduled", label: "Scheduled", n: scheduledCount },
    { k: "posted", label: "Posted", n: counts["posted"] ?? 0 },
    { k: "failed", label: "Failed", n: counts["failed"] ?? 0 },
  ];

  const [active, setActive] = useState("top");
  const [menuOpen, setMenuOpen] = useState(false);
  const navCounts = { draft: counts["draft"] ?? 0, scheduled: scheduledCount, posted: counts["posted"] ?? 0, failed: counts["failed"] ?? 0 };

  const go = (k: string) => {
    setActive(k);
    setMenuOpen(false);
    if (k === "top") window.scrollTo({ top: 0, behavior: "smooth" });
    else document.getElementById(k)?.scrollIntoView({ behavior: "smooth" });
  };
  const signOut = async () => {
    setMenuOpen(false);
    await supabase.auth.signOut();
    router.navigate({ to: "/auth" });
  };

  return (
    <div className="flex min-h-screen w-full">
      <SidebarContent email={user.email} counts={navCounts} active={active} onNav={go} onSignOut={signOut} className="sticky top-0 hidden h-screen shrink-0 lg:flex lg:w-64" />

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setMenuOpen(false)} />
          <SidebarContent email={user.email} counts={navCounts} active={active} onNav={go} onSignOut={signOut} className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw]" onClose={() => setMenuOpen(false)} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b bg-card/90 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted lg:hidden" aria-label="মেনু" onClick={() => setMenuOpen(true)}>
              <Menu className="h-5 w-5" />
            </button>
            <span className="font-display truncate text-xl font-extrabold lg:hidden">
              Auto <span className="text-primary">Posts</span>
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden max-w-[220px] truncate text-sm text-muted-foreground sm:inline">{user.email}</span>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
              {(user.email ?? "?")[0]?.toUpperCase() ?? "?"}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
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
            <Uploader userId={user.id} onDone={async () => { refresh(); await syncQuiet(); }} />
            <DriveImport userId={user.id} onDone={async () => { refresh(); await syncQuiet(); }} />
          </div>
        </section>

        <section id="posts" className="scroll-mt-24 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <h2 className="text-lg font-bold">২. রিভিউ ও শিডিউল</h2>
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

          {posts.isLoading ? (
            <p className="text-muted-foreground">লোড হচ্ছে…</p>
          ) : shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">এখানে কোনো পোস্ট নেই।</div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((p) => (
                <PostCard key={p.id} post={p} img={posts.data?.urls[p.image_path]} onChange={async () => { refresh(); await syncQuiet(); }} />
              ))}
            </div>
          )}
        </section>

        <section id="settings" className="scroll-mt-24 space-y-3">
          <h2 className="text-lg font-bold">৩. সেটিংস</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <FacebookSettings />
            <SheetSettings userId={user.id} onSaved={syncQuiet} />
          </div>
        </section>
      </main>
      </div>
    </div>
  );
}

function SidebarContent({
  email,
  counts,
  active,
  onNav,
  onSignOut,
  className = "",
  onClose,
}: {
  email?: string | undefined;
  counts: { draft: number; scheduled: number; posted: number; failed: number };
  active: string;
  onNav: (k: string) => void;
  onSignOut: () => void;
  className?: string;
  onClose?: () => void;
}) {
  const items = [
    { k: "top", label: "ড্যাশবোর্ড", icon: LayoutDashboard },
    { k: "add-design", label: "ডিজাইন যোগ করুন", icon: ImagePlus },
    { k: "posts", label: "রিভিউ ও শিডিউল", icon: CalendarClock, badge: counts.draft },
    { k: "settings", label: "সেটিংস", icon: Settings },
  ];
  const stats = [
    { label: "Scheduled", n: counts.scheduled },
    { label: "Posted", n: counts.posted },
    { label: "Failed", n: counts.failed, danger: counts.failed > 0 },
  ];

  return (
    <aside className={`z-50 flex-col border-r bg-card ${className}`}>
      <div className="flex items-start justify-between gap-2 p-6 pb-4">
        <div className="min-w-0">
          <div className="font-display text-2xl font-extrabold tracking-tight">
            <span className="text-primary">Auto</span>
            <span className="text-foreground">Posts</span>
          </div>
          <p className="mt-1 ml-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">By Ti Saju</p>
        </div>
        {onClose && (
          <button className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted" aria-label="বন্ধ করুন" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1.5 overflow-y-auto px-4 py-4">
        {items.map((it) => (
          <button
            key={it.k}
            onClick={() => onNav(it.k)}
            className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
              active === it.k ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <span className="flex items-center gap-3">
              <it.icon className="h-5 w-5 shrink-0" />
              <span className="truncate">{it.label}</span>
            </span>
            {!!it.badge && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-secondary-foreground">{it.badge}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="border-t p-4">
        <div className="mb-4 flex flex-col gap-1 text-[11px] text-muted-foreground">
          {stats.map((s) => (
            <div key={s.label} className="flex justify-between">
              <span>{s.label}:</span>
              <span className={`font-semibold ${s.danger ? "text-destructive" : "text-foreground"}`}>{s.n}</span>
            </div>
          ))}
        </div>
        <button
          onClick={onSignOut}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/20 px-3 py-2 text-sm text-primary transition-colors hover:bg-primary/5"
        >
          <LogOut className="h-4 w-4" />
          <span>লগ আউট</span>
        </button>
        {email && <p className="mt-2 truncate text-center text-[10px] text-muted-foreground">{email}</p>}
      </div>
    </aside>
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
      <div className="mt-4 rounded-xl border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">Instagram</span>
          {q.isLoading ? (
            <Badge variant="secondary">চেক হচ্ছে…</Badge>
          ) : q.data?.instagram?.connected ? (
            <Badge className="bg-green-600 text-white hover:bg-green-600">
              ✓ Connected{q.data.instagram.username ? ` (@${q.data.instagram.username})` : ""}
            </Badge>
          ) : (
            <Badge variant="destructive">Connected নয়</Badge>
          )}
        </div>
        {!q.isLoading && !q.data?.instagram?.connected && (
          <p className="mt-2 text-xs text-muted-foreground">
            Instagram অ্যাকাউন্টকে Professional করে Page-এর সাথে জুড়ুন, তারপর instagram_basic ও instagram_content_publish permission সহ নতুন Token সেভ করুন।
          </p>
        )}
      </div>
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
            <div className="mt-auto space-y-2">
              {post.status === "scheduled" ? (
                <Button size="sm" variant="outline" className="w-full" disabled={!!busy} onClick={unschedule}>Unschedule</Button>
              ) : (
                <Button size="sm" className="w-full" disabled={!!busy || locked} onClick={schedule}>{busy === "schedule" ? "…" : "Approve & Schedule"}</Button>
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
