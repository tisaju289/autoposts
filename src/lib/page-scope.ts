type SchedulablePost = { id: string; status: string; scheduled_at: string | null };

export type ReviewSlot = { d: string; t: string };

export function reviewIntervalSlots(list: SchedulablePost[], start: ReviewSlot, minutes: number, days: number) {
  const input = `${start.d}T${start.t}`;
  const base = new Date(`${input}:00+06:00`).getTime();
  if (!Number.isFinite(base) || dhakaInput(new Date(base).toISOString()) !== input) {
    throw new Error("সঠিক শুরুর তারিখ ও সময় দিন");
  }
  if (!Number.isSafeInteger(minutes) || !Number.isSafeInteger(days) || minutes < 0 || days < 0 || minutes + days === 0) {
    throw new Error("সময় বা দিনের ব্যবধান 0-এর বেশি দিন");
  }
  const gap = minutes * 60_000 + days * 86400_000;
  const slots: Record<string, ReviewSlot> = {};
  list.filter((post) => post.status === "draft").forEach((post, index) => {
    const time = base + index * gap;
    if (!Number.isFinite(time) || Math.abs(time) > 8640000000000000) throw new Error("ব্যবধানটি অনেক বড়");
    const local = dhakaInput(new Date(time).toISOString());
    slots[post.id] = { d: local.slice(0, 10), t: local.slice(11, 16) };
  });
  return slots;
}

export function dhakaInput(iso: string | null) {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 6 * 3600_000).toISOString().slice(0, 16);
}

export function defaultPageSlots(list: SchedulablePost[], now = new Date()) {
  const times = list.map((p) => p.scheduled_at).filter((v): v is string => Boolean(v)).sort();
  const last = times.at(-1);
  const date = dhakaInput(last ?? now.toISOString()).slice(0, 10);
  const base = new Date(`${date}T06:00:00+06:00`).getTime() + (last ? 86400_000 : 0);
  const slots: Record<string, { d: string; t: string }> = {};
  let index = 0;
  for (const post of list) {
    if (post.status !== "draft" || post.scheduled_at) continue;
    const local = dhakaInput(new Date(base + index++ * 2 * 3600_000).toISOString());
    slots[post.id] = { d: local.slice(0, 10), t: local.slice(11, 16) };
  }
  return slots;
}

// Newest additions first: the list a user reviews must start with what they just added.
export function recentFirst<T extends { id: string; created_at: string }>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    a.created_at === b.created_at ? b.id.localeCompare(a.id) : b.created_at.localeCompare(a.created_at),
  );
}
