import { describe, expect, it } from "vitest";
import { defaultPageSlots, dhakaInput, recentFirst } from "@/lib/page-scope";

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
