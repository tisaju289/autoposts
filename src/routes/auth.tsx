import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — PostPilot" },
      { name: "description", content: "Sign in to manage and schedule your Facebook Page posts." },
      { property: "og:title", content: "Sign in — PostPilot" },
      { property: "og:description", content: "Sign in to manage and schedule your Facebook Page posts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  // Google থেকে ফিরে এলে URL-এ code/token থাকে — তখন "লগইন সম্পন্ন হচ্ছে" দেখাই
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    // OAuth-এর ফেরতের URL-এ code/token থাকলে অগ্রগতি দেখাও; এরর থাকলে সেটা দেখাও
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const search = new URLSearchParams(window.location.search);
    if (hash.has("code") || hash.has("access_token") || search.has("code")) setFinishing(true);
    const errDesc = hash.get("error_description") ?? search.get("error_description") ?? hash.get("error") ?? search.get("error");
    if (errDesc) {
      toast.error(errDesc.replace(/\+/g, " "));
      setFinishing(false);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: "/dashboard" });
    });
    // Google থেকে ফিরে আসার পর সেশন একটু দেরিতে সেট হতে পারে —
    // তাই SIGNED_IN ইভেন্টের জন্য অপেক্ষা করি, নাহলে লগইন হয়েও /auth-এ আটকে থাকে।
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") nav({ to: "/dashboard" });
    });
    return () => sub.subscription.unsubscribe();
  }, [nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        nav({ to: "/dashboard" });
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/dashboard" },
        });
        if (error) throw error;
        toast.success("ইমেইলে কনফার্মেশন লিংক পাঠানো হয়েছে।");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setGoogleBusy(true);
    try {
      const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
      if (r.error) { toast.error(r.error.message); return; }
      if (r.redirected) return;
      nav({ to: "/dashboard" });
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-4xl font-extrabold">
          Auto Posts&nbsp;<span className="text-primary">By Ti Saju</span>
        </h1>
        <p className="mt-2 text-muted-foreground">ডিজাইন আপলোড করুন, বাংলা ক্যাপশন পান, অটো পোস্ট করুন।</p>
        <div className="mt-8 rounded-2xl border bg-card p-6 shadow-card">
          {finishing && (
            <p className="mb-4 flex items-center justify-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm text-primary">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              লগইন সম্পন্ন হচ্ছে…
            </p>
          )}
          <Button variant="outline" className="w-full" onClick={google} disabled={googleBusy || finishing}>
            {googleBusy ? "Google-এ নিয়ে যাওয়া হচ্ছে…" : "Continue with Google"}
          </Button>
          <div className="my-4 text-center text-xs text-muted-foreground">অথবা</div>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button className="w-full" disabled={busy}>
              {mode === "in" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <button
            type="button"
            className="mt-4 w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => setMode(mode === "in" ? "up" : "in")}
          >
            {mode === "in" ? "নতুন অ্যাকাউন্ট খুলুন" : "আগে থেকেই অ্যাকাউন্ট আছে? Sign in"}
          </button>
        </div>
      </div>
    </main>
  );
}
