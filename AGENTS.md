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
- Extra Facebook Pages live in `fb_pages`; a post's `page_ref` picks one (null = main page in `settings`); "all pages" duplicates the post row per page — keeps one publish result per row.
- Dashboard scope lives in the validated `page` search parameter; queries and creation use the same page reference, and schedule helpers use Asia/Dhaka — prevents cross-page posts and browser-timezone drift.
- Review interval controls use browser-safe scheduling helpers and page-scoped local date/time overrides in display order; persistence remains on Save or Approve & Schedule — arranging times must not approve captions or publish posts.
- Analytics uses the selected page's credentials and owner-scoped posts; engagement and insights are fetched independently in `facebook-analytics.server.ts`, with unavailable metrics represented as null — a rejected insight must not erase valid engagement.
- Image Reel derivatives are encoded serially in the browser before approval or immediate publishing, stored privately alongside untouched originals, and read by both publisher paths; destination outcomes remain independent so a Reel error never retries a successful Feed post.
