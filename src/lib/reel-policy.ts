export const REEL_DURATION_SECONDS = 15;
export function currentReel(path?: string | null) { return Boolean(path?.includes('/reels-v15/')); }
export function needsReel(post: { status: string; image_path: string; reel_path?: string | null }) {
  return ['draft', 'scheduled', 'failed'].includes(post.status) && Boolean(post.image_path) && !/\.(mp4|mov|m4v|webm)$/i.test(post.image_path) && !currentReel(post.reel_path);
}
