// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishFacebookReel } from '@/lib/facebook-reels.server';
import { publishClaimedPost } from '@/lib/integrations.server';

afterEach(() => vi.unstubAllGlobals());

describe('same-image Reels', () => {
  it('uses the hosted video upload then publishes the same caption', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ video_id: 'reel-1', upload_url: 'https://rupload.facebook.com/video' }))
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(Response.json({ success: true }));
    vi.stubGlobal('fetch', fetcher);
    expect(await publishFacebookReel('page', 'token', 'https://media.example/reel.mp4', 'বাংলা ক্যাপশন')).toBe('reel-1');
    expect(fetcher.mock.calls[1]?.[1].headers.file_url).toBe('https://media.example/reel.mp4');
    const finish = fetcher.mock.calls[2]?.[1].body as URLSearchParams;
    expect(finish.get('description')).toBe('বাংলা ক্যাপশন');
    expect(finish.get('video_state')).toBe('PUBLISHED');
  });

  it('publishes the original image to Feed and Story and its derivative to Reels; preserves Feed on a Reel failure', async () => {
    const updates: Record<string, unknown>[] = [];
    const builder = (table: string) => {
      const q: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'upsert']) q[method] = () => q;
      q.update = (value: Record<string, unknown>) => { updates.push(value); return q; };
      q.maybeSingle = async () => ({ data: table === 'settings' ? { fb_page_id: 'page', fb_token: 'token' } : null });
      return q;
    };
    const signed = vi.fn(async (path: string) => ({ data: { signedUrl: `https://media.example/${path}` } }));
    const db = { from: builder, storage: { from: () => ({ createSignedUrl: signed }) } };
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://media.example/')) return new Response(new Blob(['image'], { type: 'image/png' }));
      if (url.includes('fields=access_token')) return Response.json({ access_token: 'token' });
      if (url.includes('instagram_business_account')) return Response.json({});
      if (url.endsWith('/photos')) return Response.json({ id: 'photo', post_id: 'feed' });
      if (url.endsWith('/photo_stories')) return Response.json({ success: true, post_id: 'story' });
      if (url.endsWith('/video_reels')) return Response.json({ error: { message: 'reel rejected' } }, { status: 400 });
      throw new Error(`Unexpected request ${url} ${init?.method}`);
    });
    vi.stubGlobal('fetch', fetcher);
    // The small fake only models the database operations used by this publisher.
    const result = await publishClaimedPost(db as unknown as Parameters<typeof publishClaimedPost>[0], { id: 'post', user_id: 'owner', image_path: 'owner/original.png', reel_path: 'owner/reels/post.mp4', caption: 'বাংলা' });
    expect(result.ok).toBe(true);
    expect(signed.mock.calls.map(([path]) => path)).toEqual(['owner/original.png', 'owner/reels/post.mp4']);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/photos'))).toHaveLength(2);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/photo_stories'))).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/video_reels'))).toBe(true);
    const final = updates.at(-1);
    expect(final?.status).toBe('posted');
    expect(final?.fb_post_id).toBe('feed');
    expect(final?.reel_error).toContain('reel rejected');
    expect(final?.error).toBeNull();
  });
});