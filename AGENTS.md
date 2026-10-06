<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# AGENTS.md
- Server integrations (AI caption, Google Sheets sync, Facebook publish) live in `src/lib/integrations.server.ts`; client calls go through `src/lib/posts.functions.ts` — keeps secrets server-only.
- Auto-publishing runs from pg_cron calling `/api/public/hooks/publish-due`, authenticated by a token in `private.cron_token` checked via `verify_cron_token` — the public route must not be triggerable by visitors.
- Post images live in the private `post-images` bucket under `{userId}/`; Facebook and the Sheet get signed URLs — workspace blocks public buckets.
- Google Sheet sync is one-way (app → sheet, full rewrite) — the app database is the source of truth.
