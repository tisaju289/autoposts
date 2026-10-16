import { describe, expect, it } from "vitest";
import { defaultPageSlots, dhakaInput } from "@/lib/page-scope";

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