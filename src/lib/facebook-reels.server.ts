/** Official initialize -> hosted upload -> finish flow. No media processing in Workers. */
export async function publishFacebookReel(pageId: string, token: string, videoUrl: string, caption: string): Promise<string> {
  const endpoint = `https://graph.facebook.com/v21.0/${pageId}/video_reels`;
  const start = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ upload_phase: 'start', access_token: token }) });
  const session = await start.json() as { video_id?: string; upload_url?: string; error?: { message?: string } };
  if (!start.ok || session.error || !session.video_id || !session.upload_url) throw new Error(`Facebook Reels: ${session.error?.message ?? 'আপলোড শুরু হয়নি'}`);
  const uploadUrl = new URL(session.upload_url);
  if (uploadUrl.protocol !== 'https:' || !uploadUrl.hostname.endsWith('.facebook.com')) throw new Error('Facebook Reels: আপলোড ঠিকানা সঠিক নয়।');
  const upload = await fetch(uploadUrl, { method: 'POST', headers: { Authorization: `OAuth ${token}`, file_url: videoUrl } });
  const uploaded = await upload.json() as { success?: boolean; error?: { message?: string } };
  if (!upload.ok || uploaded.error || uploaded.success !== true) throw new Error(`Facebook Reels: ${uploaded.error?.message ?? 'ভিডিও আপলোড হয়নি'}`);
  const finish = await fetch(endpoint, { method: 'POST', body: new URLSearchParams({ upload_phase: 'finish', video_id: session.video_id, video_state: 'PUBLISHED', description: caption, access_token: token }) });
  const result = await finish.json() as { success?: boolean; error?: { message?: string } };
  if (!finish.ok || result.error || result.success !== true) throw new Error(`Facebook Reels: ${result.error?.message ?? 'প্রকাশের অনুরোধ গ্রহণ হয়নি'}`);
  return session.video_id;
}