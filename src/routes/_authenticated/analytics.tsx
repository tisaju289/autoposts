import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { FileDown } from "lucide-react";
import { postAnalytics } from "@/lib/posts.functions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/analytics")({
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
  const [month, setMonth] = useState(thisMonth);
  const q = useQuery({ queryKey: ["analytics", month], queryFn: () => fetchStats({ data: { month } }), staleTime: 300_000 });
  const rows = q.data?.rows ?? [];
  const tot = rows.reduce((a, r) => ({ likes: a.likes + r.likes, comments: a.comments + r.comments, shares: a.shares + r.shares, reach: a.reach + r.reach }), { likes: 0, comments: 0, shares: 0, reach: 0 });
  const top = [...rows].sort((a, b) => b.likes + b.comments - (a.likes + a.comments))[0];
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const cards = [
    { l: "মোট পোস্ট", n: rows.length },
    { l: "রিচ", n: tot.reach },
    { l: "লাইক/রিঅ্যাকশন", n: tot.likes },
    { l: "কমেন্ট", n: tot.comments },
    { l: "শেয়ার", n: tot.shares },
  ];

  return (
    <AppShell email={user.email} userId={user.id} active="analytics">
      <div className="print-area space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">অ্যানালিটিক্স ও রিপোর্ট</h2>
            <p className="text-sm text-muted-foreground">Facebook রিপোর্ট — {monthName}</p>
          </div>
          <div className="flex gap-2 print:hidden">
            <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-40" />
            <Button onClick={() => window.print()} disabled={!rows.length}><FileDown className="mr-1.5 h-4 w-4" />PDF রিপোর্ট</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {cards.map((c) => (
            <div key={c.l} className="rounded-2xl border bg-card p-4 shadow-card">
              <div className="text-xs text-muted-foreground">{c.l}</div>
              <div className="mt-1 text-2xl font-extrabold">{c.n.toLocaleString("en-US")}</div>
            </div>
          ))}
        </div>

        {top && (top.likes + top.comments > 0) && (
          <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4 text-sm">
            <b>সেরা পোস্ট:</b> {top.caption.split("\n")[0]?.slice(0, 120)} — {top.likes} লাইক, {top.comments} কমেন্ট
          </div>
        )}

        {q.isLoading ? (
          <p className="text-muted-foreground">Facebook থেকে তথ্য আনা হচ্ছে…</p>
        ) : q.error ? (
          <p className="text-destructive">{q.error.message}</p>
        ) : !rows.length ? (
          <div className="rounded-2xl border border-dashed p-12 text-center text-muted-foreground">এই মাসে কোনো পোস্ট হয়নি।</div>
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
                    <td className="p-3 text-right">{r.reach}</td>
                    <td className="p-3 text-right">{r.likes}</td>
                    <td className="p-3 text-right">{r.comments}</td>
                    <td className="p-3 text-right">{r.shares}</td>
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
