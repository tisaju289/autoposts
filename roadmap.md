# Review scheduling intervals
- [x] Add date/time start controls and selectable minute/hour/day gaps for current-page review posts without auto-approving them.
- [x] Test concrete intervals and verify the review controls through the signed-in dashboard (5/10 minutes, 2/5 hours, 2 days, individual edits, unchanged draft status; temporary posts cleaned; 20 tests passed).

# Recent posts first
- [x] Show the newest posts on top in the dashboard tabs and the analytics table; verify on screen and with tests.

# Page-scoped dashboard
- [x] Add a dashboard page selector and isolate posts, counts, uploads, Drive imports, and schedule defaults.
- [x] Verify page switching, upload, scheduling and saving through the signed-in dashboard; run regression tests.

# Analytics repair
- [x] Replace rejected reach metric, preserve independent engagement, and use selected Page credentials.
- [x] Verify signed-in analytics results and run regression tests (134 posts, 540 unique viewers, 151 reactions and 3 comments; 9 tests passed).

# Reels with default music
- [x] Complete automatic same-image Reels preparation and publication alongside Feed and Story for this request.
- [x] Create reusable original background tracks.
- [x] Create private MP4 derivatives for uploaded and Drive-imported images; preserve originals.
- [x] Wire derivatives to Facebook and Instagram Reels alongside Feed and Story; retain independent outcomes.
- [x] Clean derivatives after 12 hours and show Reel outcomes.
- [x] Verify real browser conversion (8 seconds, 1080×1920 H264/AAC), mocked publishing requests and regressions (27 tests).
- [ ] Verify authenticated upload → scheduled Facebook/Instagram Reel readback; blocked because no requesting-user account/session is available and no live post was published during testing.