import bright from '@/assets/reel-bright.mp3.asset.json';
import mellow from '@/assets/reel-mellow.mp3.asset.json';
import spark from '@/assets/reel-spark.mp3.asset.json';
import { supabase } from '@/integrations/supabase/client';

const tracks = [bright.url, mellow.url, spark.url];
export function reelTrackIndex(id: string) {
  return [...id].reduce((n, c) => n + c.charCodeAt(0), 0) % tracks.length;
}

/** Browser-only, offline encoding; originals are never overwritten. */
export async function renderImageReel(image: Blob, trackIndex: number): Promise<Blob> {
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource, canEncodeAudio, canEncodeVideo, EncodedVideoPacketSource, Input, BufferSource, ALL_FORMATS, EncodedPacketSink } = await import('mediabunny');
  const nativeVideo = await canEncodeVideo('avc', { width: 1080, height: 1920, bitrate: 4_000_000 });
  if (!(await canEncodeAudio('aac'))) {
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
  }
  const bitmap = await createImageBitmap(image);
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close(); throw new Error('ভিডিও তৈরি করা যায়নি।'); }
  const audioContext = new AudioContext();
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  try {
    const audioResponse = await fetch(tracks[trackIndex % tracks.length] ?? bright.url);
    if (!audioResponse.ok) throw new Error('Reels-এর গান লোড হয়নি।');
    const decoded = await audioContext.decodeAudioData(await audioResponse.arrayBuffer());
    const duration = 8;
    const music = audioContext.createBuffer(decoded.numberOfChannels, duration * decoded.sampleRate, decoded.sampleRate);
    for (let ch = 0; ch < music.numberOfChannels; ch++) {
      const dest = music.getChannelData(ch);
      const source = decoded.getChannelData(ch);
      for (let i = 0; i < dest.length; i++) {
        const time = i / decoded.sampleRate;
        const fade = Math.min(1, time / 0.3, (duration - time) / 0.5);
        dest[i] = (source[i % source.length] ?? 0) * Math.max(0, fade) * 0.7;
      }
    }
    const video = nativeVideo ? new CanvasSource(canvas, { codec: 'avc', bitrate: 4_000_000 }) : new EncodedVideoPacketSource('avc');
    const audio = new AudioBufferSource({ codec: 'aac', bitrate: 128_000 });
    output.addVideoTrack(video, { frameRate: 30 });
    output.addAudioTrack(audio);
    await output.start();
    const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
    ctx.fillStyle = '#000000'; // Media letterboxing, not a UI theme color.
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, (canvas.width - bitmap.width * scale) / 2, (canvas.height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
    const addAudio = audio.add(music).then(() => audio.close());
    if (video instanceof CanvasSource) {
      for (let i = 0; i < duration * 30; i++) await video.add(i / 30, 1 / 30);
    } else {
      const { softwareVideo } = await import('./reel-software');
      const bytes = await softwareVideo(canvas, duration);
      const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error('Reels ভিডিও তৈরি হয়নি।');
        const decoderConfig = await track.getDecoderConfig();
        for await (const packet of new EncodedPacketSink(track).packets()) await video.add(packet, decoderConfig ? { decoderConfig } : undefined);
      } finally { input.dispose(); }
    }
    video.close();
    await addAudio;
    await output.finalize();
    if (!target.buffer) throw new Error('Reels ভিডিও তৈরি হয়নি।');
    return new Blob([target.buffer], { type: 'video/mp4' });
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    bitmap.close();
    await audioContext.close();
  }
}

const inFlight = new Map<string, Promise<void>>();
let renderQueue: Promise<void> = Promise.resolve();
export function preparePostReel(postId: string): Promise<void> {
  const pending = inFlight.get(postId);
  if (pending) return pending;
  const task = renderQueue.then(() => prepare(postId)).finally(() => inFlight.delete(postId));
  renderQueue = task.catch(() => undefined);
  inFlight.set(postId, task);
  return task;
}

async function prepare(postId: string) {
  const { data: post, error } = await supabase.from('posts').select('user_id, image_path, reel_path, status').eq('id', postId).single();
  if (error || !post) throw new Error('পোস্ট পাওয়া যায়নি।');
  if (post.reel_path || !post.image_path || !['draft', 'scheduled', 'failed'].includes(post.status)) return;
  // Uploaded videos already go to Instagram Reels, with their original audio.
  if (/\.(mp4|mov|m4v|webm)$/i.test(post.image_path)) return;
  const { data: original, error: downloadError } = await supabase.storage.from('post-images').download(post.image_path);
  if (downloadError || !original) throw new Error(downloadError?.message ?? 'ছবি পাওয়া যায়নি।');
  let blob: Blob;
  try {
    blob = await renderImageReel(original, reelTrackIndex(postId));
  } catch (error) {
    await supabase.from('posts').update({ reel_error: error instanceof Error ? error.message : 'Reels তৈরি হয়নি।' }).eq('id', postId);
    throw error;
  }
  const path = `${post.user_id}/reels/${postId}.mp4`;
  const { error: uploadError } = await supabase.storage.from('post-images').upload(path, blob, { contentType: 'video/mp4', upsert: true });
  if (uploadError) throw new Error(uploadError.message);
  const { error: saveError } = await supabase.from('posts').update({ reel_path: path, reel_error: null }).eq('id', postId);
  if (saveError) throw new Error(saveError.message);
}