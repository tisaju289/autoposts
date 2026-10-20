import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPostStats } from "@/lib/facebook-analytics.server";

afterEach(() => vi.unstubAllGlobals());
describe("Facebook analytics", () => {
  it("keeps engagement when Facebook rejects the insight metric", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/insights?")
      ? { error: { code: 100 } }
      : { reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } }, shares: { count: 2 } }))));
    const result = await fetchPostStats("123", "test-token");
    expect(result).toMatchObject({ likes: 12, comments: 3, shares: 2, reach: null });
    expect(result.error).not.toBeNull();
  });
  it("reads unique viewers from the current total-value response", async () => {
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/insights?")
      ? { data: [{ total_value: { value: 450 } }] }
      : { reactions: { summary: { total_count: 7 } } })));
    vi.stubGlobal("fetch", fetcher);
    expect(await fetchPostStats("123", "test-token")).toMatchObject({ likes: 7, reach: 450, error: null });
    expect(fetcher.mock.calls[1]?.[0]).toContain("post_total_media_view_unique");
  });
  it("does not present inaccessible engagement as genuine zeros", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 190 } }))));
    expect(await fetchPostStats("123", "test-token")).toMatchObject({ likes: null, comments: null, shares: null, reach: null });
  });
});