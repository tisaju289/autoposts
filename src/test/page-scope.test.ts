import { describe, expect, it } from "vitest";
import { defaultPageSlots, dhakaInput, recentFirst, reviewIntervalSlots } from "@/lib/page-scope";

describe("Review post intervals", () => {
  const drafts = ["a", "b", "c"].map((id) => ({ id, status: "draft", scheduled_at: null }));
  const start = { d: "2026-10-26", t: "06:00" };
  it.each([[5, "06:05", "06:10"], [10, "06:10", "06:20"], [120, "08:00", "10:00"], [300, "11:00", "16:00"]])("spaces drafts by %i minutes", (minutes, second, third) => {
    expect(reviewIntervalSlots(drafts, start, minutes, 0)).toEqual({
      a: start, b: { d: "2026-10-26", t: second }, c: { d: "2026-10-26", t: third },
    });
  });
  it("spaces dates by 2 days at the same time", () => {
    expect(reviewIntervalSlots(drafts, start, 0, 2).c).toEqual({ d: "2026-10-30", t: "06:00" });
  });
  it("adds day gaps to time gaps", () => {
    expect(reviewIntervalSlots(drafts, start, 10, 1).b).toEqual({ d: "2026-10-27", t: "06:10" });
  });
  it("rolls over midnight in Dhaka", () => {
    expect(reviewIntervalSlots(drafts, { d: "2026-10-26", t: "23:55" }, 10, 0).b).toEqual({ d: "2026-10-27", t: "00:05" });
  });
  it("supports a custom 17 minute gap", () => {
    expect(reviewIntervalSlots(drafts, start, 17, 0).b.t).toBe("06:17");
  });
  it("only arranges drafts, including previously saved review times, without changing statuses", () => {
    const list = [{ id: "posted", status: "posted", scheduled_at: null }, { id: "saved", status: "draft", scheduled_at: "2026-10-25T00:00:00Z" }, ...drafts];
    expect(Object.keys(reviewIntervalSlots(list, start, 5, 0))).toEqual(["saved", "a", "b", "c"]);
    expect(list.map((p) => p.status)).toEqual(["posted", "draft", "draft", "draft", "draft"]);
  });
  it.each([[0, 0], [-5, 0], [5, -1], [1.5, 0]])("rejects invalid intervals %i / %i", (minutes, days) => {
    expect(() => reviewIntervalSlots(drafts, start, minutes, days)).toThrow();
  });
  it("rejects an invalid start date", () => {
    expect(() => reviewIntervalSlots(drafts, { d: "2026-02-30", t: "06:00" }, 5, 0)).toThrow();
  });
});

describe("Page schedule defaults", () => {
  it("uses Dhaka time regardless of browser timezone", () => {
    expect(dhakaInput("2026-10-08T22:00:00Z")).toBe("2026-10-09T04:00");
  });

  it("starts on the day after this page's latest schedule at 06:00", () => {
    const slots = defaultPageSlots([
      { id: "scheduled", status: "scheduled", scheduled_at: "2026-10-08T12:00:00Z" },
      { id: "a", status: "draft", scheduled_at: null },
      { id: "b", status: "draft", scheduled_at: null },
    ]);
    expect(slots).toEqual({ a: { d: "2026-10-09", t: "06:00" }, b: { d: "2026-10-09", t: "08:00" } });
  });

  it("rolls two-hour intervals past midnight onto the next day", () => {
    const slots = defaultPageSlots(Array.from({ length: 10 }, (_, i) => ({ id: String(i), status: "draft", scheduled_at: null })), new Date("2026-10-09T00:00:00Z"));
    expect(slots["9"]).toEqual({ d: "2026-10-10", t: "00:00" });
  });

  it("does not replace existing draft times", () => {
    expect(defaultPageSlots([{ id: "a", status: "draft", scheduled_at: "2026-10-08T00:00:00Z" }])).toEqual({});
  });
});

describe("Recent posts first", () => {
  it("puts the newest post on top", () => {
    const list = [
      { id: "old", created_at: "2026-10-01T10:00:00Z" },
      { id: "new", created_at: "2026-10-08T09:00:00Z" },
      { id: "mid", created_at: "2026-10-05T08:00:00Z" },
    ];
    expect(recentFirst(list).map((p) => p.id)).toEqual(["new", "mid", "old"]);
  });

  it("leaves the source list in its own order", () => {
    const list = [
      { id: "a", created_at: "2026-10-01T10:00:00Z" },
      { id: "b", created_at: "2026-10-02T10:00:00Z" },
    ];
    recentFirst(list);
    expect(list.map((p) => p.id)).toEqual(["a", "b"]);
  });
});
