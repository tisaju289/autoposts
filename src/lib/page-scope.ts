type SchedulablePost = { id: string; status: string; scheduled_at: string | null };

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