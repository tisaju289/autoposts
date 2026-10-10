import { Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BarChart3, CalendarClock, ImagePlus, LayoutDashboard, LogOut, Menu, Settings, X } from "lucide-react";
import type { ReactNode } from "react";

type NavCounts = { draft: number; scheduled: number; posted: number; failed: number };

export function AppShell({
  email,
  userId,
  counts,
  active,
  onNav,
  children,
}: {
  email?: string | undefined;
  userId: string;
  counts?: NavCounts;
  active: string;
  onNav?: (k: string) => void;
  children: ReactNode;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const fetched = useQuery({
    queryKey: ["nav-counts", userId],
    enabled: !counts,
    queryFn: async (): Promise<NavCounts> => {
      const { data, error } = await supabase.from("posts").select("status");
      if (error) throw error;
      const c: Record<string, number> = {};
      (data ?? []).forEach((p: { status: string }) => (c[p.status] = (c[p.status] ?? 0) + 1));
      return {
        draft: c["draft"] ?? 0,
        scheduled: (c["scheduled"] ?? 0) + (c["posting"] ?? 0),
        posted: c["posted"] ?? 0,
        failed: c["failed"] ?? 0,
      };
    },
    refetchInterval: 60_000,
  });

  const navCounts = counts ?? fetched.data ?? { draft: 0, scheduled: 0, posted: 0, failed: 0 };

  const signOut = async () => {
    setMenuOpen(false);
    await supabase.auth.signOut();
    router.navigate({ to: "/auth" });
  };

  const nav = (k: string) => {
    setMenuOpen(false);
    onNav?.(k);
  };

  return (
    <div className="flex min-h-screen w-full">
      <SidebarContent email={email} counts={navCounts} active={active} onNav={onNav ? nav : undefined} onSignOut={signOut} className="sticky top-0 hidden h-screen shrink-0 lg:flex lg:w-64" />

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setMenuOpen(false)} />
          <SidebarContent email={email} counts={navCounts} active={active} onNav={onNav ? nav : undefined} onSignOut={signOut} className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw]" onClose={() => setMenuOpen(false)} />
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
            <span className="hidden max-w-[220px] truncate text-sm text-muted-foreground sm:inline">{email}</span>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
              {(email ?? "?")[0]?.toUpperCase() ?? "?"}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
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
  counts: NavCounts;
  active: string;
  onNav?: ((k: string) => void) | undefined;
  onSignOut: () => void;
  className?: string;
  onClose?: (() => void) | undefined;
}) {
  const items = [
    { k: "top", label: "ড্যাশবোর্ড", icon: LayoutDashboard },
    { k: "add-design", label: "ডিজাইন যোগ করুন", icon: ImagePlus },
    { k: "posts", label: "রিভিউ ও শিডিউল", icon: CalendarClock, badge: counts.draft },
    { k: "analytics", label: "অ্যানালিটিক্স", icon: BarChart3 },
    { k: "settings", label: "সেটিংস", icon: Settings },
  ];
  const stats = [
    { label: "Scheduled", n: counts.scheduled },
    { label: "Posted", n: counts.posted },
    { label: "Failed", n: counts.failed, danger: counts.failed > 0 },
  ];

  const linkFor = (k: string): { to: "/dashboard" | "/settings" | "/analytics"; hash?: string } =>
    k === "analytics" ? { to: "/analytics" } : k === "settings" ? { to: "/settings" } : k === "add-design" ? { to: "/dashboard", hash: "add-design" } : k === "posts" ? { to: "/dashboard", hash: "posts" } : { to: "/dashboard" };

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
        {items.map((it) => {
          const cls = `flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
            active === it.k ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted"
          }`;
          const inner = (
            <>
              <span className="flex items-center gap-3">
                <it.icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{it.label}</span>
              </span>
              {!!it.badge && (
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-secondary-foreground">{it.badge}</span>
              )}
            </>
          );
          if (onNav) {
            return (
              <button key={it.k} onClick={() => onNav(it.k)} className={cls}>
                {inner}
              </button>
            );
          }
          const l = linkFor(it.k);
          return (
            <Link key={it.k} {...(l.hash ? { hash: l.hash } : {})} to={l.to} onClick={onClose} className={cls}>
              {inner}
            </Link>
          );
        })}
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
