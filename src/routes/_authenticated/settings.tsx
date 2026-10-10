import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { facebookStatus, saveCaptionStyle, saveFacebookCreds, syncSheet } from "@/lib/posts.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { TONE_OPTIONS } from "./dashboard";
import { Eye, EyeOff } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Auto Posts" },
      { name: "description", content: "Connect your Facebook Page, Instagram and Google Sheet." },
      { property: "og:title", content: "Settings — Auto Posts" },
      { property: "og:description", content: "Connect your Facebook Page, Instagram and Google Sheet." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = Route.useRouteContext();
  const sync = useServerFn(syncSheet);

  const syncQuiet = async () => {
    try {
      await sync();
    } catch (e) {
      toast.error("Sheet sync: " + (e instanceof Error ? e.message : "failed"));
    }
  };

  return (
    <AppShell email={user.email} userId={user.id} active="settings">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">সেটিংস</h2>
        <p className="text-sm text-muted-foreground">Facebook Page, Instagram এবং Google Sheet এখানে যুক্ত করুন — একবার সেভ করলেই সব পোস্টে কাজ করবে।</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <FacebookSettings />
        <SheetSettings userId={user.id} onSaved={syncQuiet} />
        <CaptionStyle userId={user.id} />
      </div>
    </AppShell>
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

function CaptionStyle({ userId }: { userId: string }) {
  const save = useServerFn(saveCaptionStyle);
  const [tone, setTone] = useState("engaging");
  const [voice, setVoice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from("settings").select("caption_tone, brand_voice").eq("user_id", userId).maybeSingle().then(({ data }) => {
      if (data) { setTone(data.caption_tone); setVoice(data.brand_voice); }
    });
  }, [userId]);
  return (
    <div className="rounded-2xl border bg-card p-6 shadow-card lg:col-span-2">
      <h3 className="text-lg font-bold">AI ক্যাপশন স্টাইল</h3>
      <p className="mt-1 text-sm text-muted-foreground">সব নতুন ক্যাপশন এই টোন ও নির্দেশনা মেনে লেখা হবে।</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {TONE_OPTIONS.map((o) => (
          <button key={o.v} onClick={() => setTone(o.v)} className={`rounded-full border px-3 py-1.5 text-sm transition ${tone === o.v ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary"}`}>{o.l}</button>
        ))}
      </div>
      <label className="mt-4 block text-sm font-semibold">ব্র্যান্ড ভয়েস / নিজস্ব নির্দেশনা</label>
      <Textarea className="mt-2" rows={4} maxLength={1500} value={voice} onChange={(e) => setVoice(e.target.value)} placeholder={"যেমন: সবসময় দাম ও ফোন নম্বর 01XXXXXXXXX ক্যাপশনের শেষে থাকবে। ক্রেতাকে 'আপনি' বলে সম্বোধন করবে।"} />
      <Button className="mt-3" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await save({ data: { tone, brandVoice: voice } }); toast.success("ক্যাপশন স্টাইল সেভ হয়েছে"); } catch (e) { toast.error(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); }
      }}>{busy ? "সেভ হচ্ছে…" : "সেভ করুন"}</Button>
    </div>
  );
}
