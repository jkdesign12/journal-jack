/* Making a photo small enough to send.
 *
 * A serverless host refuses a request body over 4.5 MB, and phone photos sail
 * past that. Rather than lean on the direct-to-storage path for every holiday
 * snap, an image that big is re-encoded until it fits: quality first, then
 * dimensions. A tile is a few hundred pixels wide, so the loss is invisible
 * where it matters and the file becomes something every host accepts.
 */

export const UPLOAD_LIMIT = 4.2 * 1024 * 1024; // headroom under the 4.5 MB cap

/**
 * WebP makes the smallest files, but a canvas asked for a format it cannot
 * write quietly hands back a PNG instead — and a PNG of a phone photo is bigger
 * than the original, so every attempt to shrink it fails and the file is
 * declared impossible. Older Safari does exactly this. So ask once what the
 * browser can really write, and fall back to JPEG, which all of them can.
 */
let encoderChoice: string | null = null;

export async function encoderType(): Promise<string> {
  if (encoderChoice) return encoderChoice;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.8));
  encoderChoice = blob && blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  return encoderChoice;
}

export const extensionFor = (type: string) => (type === 'image/webp' ? '.webp' : '.jpg');

/** Why a file could not be made smaller, kept beside the file itself. */
export const shrinkFailures = new WeakMap<Blob, string>();

interface Drawable {
  width: number;
  height: number;
  source?: CanvasImageSource;
  close?: () => void;
}

/**
 * Decode anything the browser can actually display. createImageBitmap handles
 * the common formats but refuses others — notably HEIC from an iPhone, which
 * Safari can still render through an <img>. Trying both is the difference
 * between shrinking a photo and giving up on it.
 */
export async function decodeImage(file: Blob): Promise<Drawable> {
  try {
    return await createImageBitmap(file);
  } catch {
    /* try the slow path */
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('cannot decode'));
      img.src = url;
      setTimeout(() => reject(new Error('decode timed out')), 15000);
    });
    if (!img.naturalWidth) throw new Error('cannot decode');
    return { width: img.naturalWidth, height: img.naturalHeight, source: img, close() {} };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

/**
 * Wait for whichever of these comes first, and carry on regardless when none
 * does. Phone browsers skip events other browsers always fire, so waiting for
 * one particular event is how this used to hang until it gave up on the file.
 */
function firstEvent(target: EventTarget, names: string[], ms: number): Promise<string | null> {
  return new Promise((resolve) => {
    const stop = (why: string | null) => {
      names.forEach((n) => target.removeEventListener(n, hit));
      clearTimeout(timer);
      resolve(why);
    };
    const hit = (e: Event) => stop(e.type);
    names.forEach((n) => target.addEventListener(n, hit, { once: true }));
    const timer = setTimeout(() => stop(null), ms);
  });
}

/**
 * A frame drawn before the video really has one is a flat black rectangle.
 * Saving that would look like success and leave a black tile, so it is checked
 * and the grab retried further into the clip.
 */
export function frameIsBlank(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const step = Math.max(1, Math.floor(Math.min(w, h) / 24));
  let lit = 0;
  let seen = 0;
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        seen++;
        if (d[i + 3] > 8 && (d[i] > 12 || d[i + 1] > 12 || d[i + 2] > 12)) lit++;
      }
    }
  } catch {
    return false; // unreadable pixels: assume it is fine
  }
  return seen > 0 && lit / seen < 0.02;
}

/**
 * A Live Photo arrives from an iPhone as a short video, and video cannot be
 * re-encoded in a browser — which is why one would sit there refusing to upload
 * no matter how hard the image path tried. Pulling a frame out turns it into an
 * ordinary picture that fits anywhere.
 */
export async function stillFromVideo(file: File | Blob): Promise<File> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');

  /* Safari on a phone ignores `preload` and loads nothing until the clip
     actually plays, so a hidden element with a src on it never produces a
     frame. Muted inline playback needs no tap, so the clip is started, a frame
     taken, and it is stopped again. It also has to be in the page: iOS will not
     decode a video that was never attached. */
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  Object.assign(video.style, {
    position: 'fixed',
    left: '-9999px',
    top: '0',
    width: '2px',
    height: '2px',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.appendChild(video);

  try {
    video.src = url;
    try {
      video.load();
    } catch {
      /* some builds do not need it */
    }

    let refused = false;
    video.addEventListener('error', () => {
      refused = true;
    });
    try {
      await video.play();
    } catch {
      /* autoplay refused: metadata may still arrive */
    }

    if (!video.videoWidth) {
      await firstEvent(video, ['loadeddata', 'canplay', 'timeupdate', 'error'], 25000);
    }
    if (!video.videoWidth) {
      await firstEvent(video, ['loadeddata', 'canplay', 'timeupdate', 'error'], 8000);
    }
    if (!video.videoWidth) {
      throw new Error(
        refused ? 'this browser cannot read that video format' : 'the video never produced a picture',
      );
    }

    const scale = Math.min(1, 2560 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const type = await encoderType();
    const span = video.duration && isFinite(video.duration) ? video.duration : 1;
    const name = 'name' in file ? file.name : 'video';

    /* A Live Photo's first frames are often still exposing and come out dark,
       so the grab starts a fraction in and moves later if it got nothing. */
    for (const at of [Math.min(0.25, span / 3), Math.min(0.6, span / 2), 0, Math.min(1.2, span * 0.8)]) {
      if (Math.abs(video.currentTime - at) > 0.01) {
        try {
          video.pause();
        } catch {
          /* already paused */
        }
        video.currentTime = at;
        await firstEvent(video, ['seeked', 'timeupdate'], 4000);
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (frameIsBlank(ctx, canvas.width, canvas.height)) continue;

      for (const quality of [0.85, 0.7, 0.55, 0.4]) {
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
        if (blob && blob.size <= UPLOAD_LIMIT) {
          const base = name.replace(/\.[^.]+$/, '');
          return new File([blob], base + extensionFor(type), { type });
        }
      }
      throw new Error('the still frame is still too large');
    }
    throw new Error('every frame read out of it was blank');
  } finally {
    try {
      video.pause();
    } catch {
      /* nothing playing */
    }
    video.removeAttribute('src');
    try {
      video.load();
    } catch {
      /* fine */
    }
    video.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

/** Returns a file small enough to send, or the original if nothing helped. */
export async function shrinkImage(file: File): Promise<File> {
  if (file.size <= UPLOAD_LIMIT) return file;

  /* An oversized video becomes a still. A Live Photo is a photo as far as you
     are concerned, and a still that syncs everywhere beats a clip that syncs
     nowhere. */
  if (/^video\//.test(file.type)) {
    try {
      return await stillFromVideo(file);
    } catch (e) {
      shrinkFailures.set(file, (e as Error).message);
      return file;
    }
  }
  if (/gif|svg/.test(file.type)) return file; // animation and vectors do not survive this

  let picture: Drawable;
  try {
    picture = await decodeImage(file);
  } catch {
    return file; // genuinely undecodable
  }

  const drawable = (picture.source ?? picture) as CanvasImageSource;
  const type = await encoderType();
  let scale = Math.min(1, 2560 / Math.max(picture.width, picture.height));

  /* Work down until it fits: fewer pixels each pass, four quality steps within
     each. The last pass is small enough that anything still over the limit was
     never going to make it. */
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.max(1, Math.round(picture.width * scale));
    const h = Math.max(1, Math.round(picture.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(drawable, 0, 0, w, h);

    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
      if (blob && blob.size <= UPLOAD_LIMIT) {
        picture.close?.();
        const base = (file.name || 'image').replace(/\.[^.]+$/, '');
        return new File([blob], base + extensionFor(type), { type });
      }
    }
    canvas.width = canvas.height = 0; // a phone runs out of canvas memory fast
    scale *= 0.7;
  }

  picture.close?.();
  return file; // give up honestly rather than mangle it
}
