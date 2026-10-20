import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { FileDown, RefreshCw } from "lucide-react";
import { z } from "zod";
import { listPages, postAnalytics } from "@/lib/posts.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/analytics")({
  validateSearch: z.object({ page: z.string().uuid().optional() }),
  head: () => ({
    meta: [
      { title: "Analytics — Auto Posts" },
      { name: "description", content: "Likes, comments and reach of your published posts, with monthly PDF reports." },
      { property: "og:title", content: "Analytics — Auto Posts" },
      { property: "og:description", content: "Likes, comments and reach of your published posts, with monthly PDF reports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnalyticsPage,
});

function thisMonth() {
  return new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 7);
}

function AnalyticsPage() {
  const { user } = Route.useRouteContext();
  const fetchStats = useServerFn(postAnalytics);
  const pagesFn = useServerFn(listPages);
  const router = useRouter();
  const { page } = Route.useSearch();
  const pagesQ = useQuery({ queryKey: ["pages", user.id], queryFn: () => pagesFn() });
  const pages = pagesQ.data ?? [];
  const validPage = !page || pages.some((p) => p.id === page);
  const [month, setMonth] = useState(thisMonth);
  const q = useQuery({ queryKey: ["analytics", user.id, month, page ?? null], queryFn: () => fetchStats({ data: { month, pageRef: page ?? null } }), enabled: pagesQ.isSuccess && validPage, staleTime: 300_000 });
  const rows = q.data?.rows ?? [];
  const tot = rows.reduce((a, r) => ({ likes: a.likes + (r.likes ?? 0), comments: a.comments + (r.comments ?? 0), shares: a.shares + (r.shares ?? 0), reach: a.reach + (r.reach ?? 0) }), { likes: 0, comments: 0, shares: 0, reach: 0 });
  const top = [...rows].sort((a, b) => (b.likes ?? 0) + (b.comments ?? 0) - ((a.likes ?? 0) + (a.comments ?? 0)))[0];
  const displayTotal = (key: "likes" | "comments" | "shares" | "reach") => rows.some((r) => r[key] !== null) ? tot[key] : null;
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const cards = [
    { l: "মোট পোস্ট", n: rows.length },
    { l: "রিচ", n: displayTotal("reach") },
    { l: "লাইক/রিঅ্যাকশন", n: displayTotal("likes") },
    { l: "কমেন্ট", n: displayTotal("comments") },
    { l: "শেয়ার", n: displayTotal("shares") },
  ];

  return (
    <AppShell email={user.email} userId={user.id} active="analytics">
      <div className="print-area space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">অ্যানালিটিক্স ও রিপোর্ট</h2>
            <p className="text-sm text-muted-foreground">Facebook রিপোর্ট — {monthName}</p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Select value={page ?? "main"} disabled={pagesQ.isPending} onValueChange={(value) => router.navigate({ to: "/analytics", search: value === "main" ? {} : { page: value } })}>
              <SelectTrigger aria-label="Facebook পেজ বাছাই করুন" className="w-64 max-w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="main">মূল পেজ</SelectItem>{pages.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            <Input aria-label="রিপোর্টের মাস" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-40" />
            <Button variant="outline" size="icon" aria-label="রিপোর্ট রিফ্রেশ করুন" disabled={q.isFetching || !validPage} onClick={() => q.refetch()}><RefreshCw className={q.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} /></Button>
            <Button onClick={() => window.print()} disabled={!rows.length}><FileDown className="mr-1.5 h-4 w-4" />PDF রিপোর্ট</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {cards.map((c) => (
            <div key={c.l} className="rounded-2xl border bg-card p-4 shadow-card">
              <div className="text-xs text-muted-foreground">{c.l}</div>
              <div className="mt-1 text-2xl font-extrabold">{q.isPending ? "…" : c.n?.toLocaleString("en-US") ?? "—"}</div>
            </div>
          ))}
        </div>

        {rows.some((r) => r.error) && <p role="alert" className="text-sm text-destructive">কিছু পোস্টের তথ্য Facebook দিচ্ছে না। সংশ্লিষ্ট পোস্টের নিচে কারণ দেখুন; পাওয়া তথ্যের যোগফল দেখানো হয়েছে।</p>}
        {pagesQ.isError && <p role="alert" className="text-destructive">পেজের তালিকা আনা যায়নি।</p>}
        {!validPage && <p role="alert" className="text-destructive">পেজটি আর নেই। অন্য পেজ বাছুন।</p>}
        {top && ((top.likes ?? 0) + (top.comments ?? 0) > 0) && (
          <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4 text-sm">
            <b>সেরা পোস্ট:</b> {top.caption.split("\n")[0]?.slice(0, 120)} — {top.likes} লাইক, {top.comments} কমেন্ট
          </div>
        )}

        {q.isPending ? (
          <p className="text-muted-foreground">Facebook থেকে তথ্য আনা হচ্ছে…</p>
        ) : q.error ? (
          <p className="text-destructive">{q.error.message}</p>
        ) : !rows.length ? (
          <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">এই পেজে এই মাসে অ্যাপ থেকে প্রকাশিত কোনো পোস্ট নেই।</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="p-3">তারিখ</th><th className="p-3">ক্যাপশন</th><th className="p-3 text-right">রিচ</th><th className="p-3 text-right">লাইক</th><th className="p-3 text-right">কমেন্ট</th><th className="p-3 text-right">শেয়ার</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="whitespace-nowrap p-3">{r.posted_at && new Date(r.posted_at).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="max-w-xs p-3">
                      <div className="line-clamp-2">{r.caption.split("\n")[0]}</div>
                      {r.error && <div className="text-xs text-destructive print:hidden">{r.error}</div>}
                    </td>
                     <td className="p-3 text-right">{r.reach ?? "—"}</td>
                     <td className="p-3 text-right">{r.likes ?? "—"}</td>
                     <td className="p-3 text-right">{r.comments ?? "—"}</td>
                     <td className="p-3 text-right">{r.shares ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground print:hidden">রিচ দেখাতে Page টোকেনে <b>read_insights</b> পারমিশন লাগে।</p>
      </div>
    </AppShell>
  );
}
