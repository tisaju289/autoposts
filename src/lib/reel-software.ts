import encoderUrl from 'h264-mp4-encoder/embuild/dist/h264-mp4-encoder.web.js?url';
import type * as EncoderModule from 'h264-mp4-encoder';

let loading: Promise<typeof EncoderModule> | undefined;
function loadEncoder(): Promise<typeof EncoderModule> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = encoderUrl;
    script.onload = () => {
      const module = (window as Window & { HME?: typeof EncoderModule }).HME;
      if (module) resolve(module);
      else reject(new Error('Reels ভিডিও এনকোডার লোড হয়নি।'));
    };
    script.onerror = () => { loading = undefined; reject(new Error('Reels ভিডিও এনকোডার লোড হয়নি।')); };
    document.head.append(script);
  });
  return loading;
}

/** Browser WASM fallback; its bundled encoder never runs on the server. */
export async function softwareVideo(canvas: HTMLCanvasElement, duration: number): Promise<Uint8Array> {
  const module = await loadEncoder();
  const encoder = await module.createH264MP4Encoder();
  try {
    encoder.width = canvas.width;
    encoder.height = canvas.height;
    encoder.frameRate = 30;
    encoder.kbps = 4000;
    encoder.speed = 10;
    encoder.initialize();
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Reels ছবি পড়া যায়নি।');
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < duration * 30; i++) {
      encoder.addFrameRgba(rgba);
      if (i % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    encoder.finalize();
    return new Uint8Array(encoder.FS.readFile(encoder.outputFilename));
  } finally { encoder.delete(); }
}