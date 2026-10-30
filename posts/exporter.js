/* Skymark posttool: export naar afbeelding, MP4 en zip.

   Video: H.264 (High profile) + AAC in MP4 met de index vooraan (fast start),
   30 fps, vaste resolutie 1080 breed. Dat is wat Instagram verwacht, dus het
   bestand wordt bij uploaden zo min mogelijk opnieuw bewerkt. De bitrate is
   afgestemd op scherpte bij een zo klein mogelijk bestand. */

import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer.mjs';
import { zipSync } from './vendor/fflate.mjs';
import { renderSlide, sizeOf, prepareSlide, introLength } from './engine.js';
import { getTemplate } from './templates.js';

export const FPS = 30;
export const MAX_SECONDS = 90;

/* bits per seconde per formaat; Instagram schaalt hoger toch terug */
const BITRATE = { feed: 6_000_000, story: 7_500_000 };

export function slideHasVideo(slide) {
  return Object.values(slide.media || {}).some(m => m && m.kind === 'video' && m.src);
}

export function slideHasPhoto(slide) {
  return Object.values(slide.media || {}).some(m => m && m.src);
}

/* Duur van een slide als video. */
export function clipDuration(slide, getMediaEl) {
  for (const [slot, m] of Object.entries(slide.media || {})) {
    if (m && m.kind === 'video' && m.src) {
      const el = getMediaEl(slot, m);
      const full = el && isFinite(el.duration) ? el.duration : 0;
      const start = m.in || 0;
      const end = m.out != null ? Math.min(m.out, full || m.out) : full;
      return Math.max(0.5, Math.min(MAX_SECONDS, end - start));
    }
  }
  return Math.max(slide.duration || 6, introLength(slide, 'feed') + 1);
}

function canvasFor(formatId) {
  const s = sizeOf(formatId);
  const c = document.createElement('canvas');
  c.width = s.w;
  c.height = s.h;
  return c;
}

/* ---------- afbeelding ---------- */

/* Met foto: JPEG op hoge kwaliteit (Instagram maakt er toch JPEG van).
   Zonder foto: PNG, dan blijven vlakken en letters messcherp. */
export async function exportImage(slide, formatId, getMediaEl) {
  await prepareSlide(slide, formatId);
  const c = canvasFor(formatId);
  renderSlide(c.getContext('2d'), slide, formatId, { t: null, getMedia: getMediaEl, placeholders: false });
  const photo = slideHasPhoto(slide);
  const type = photo ? 'image/jpeg' : 'image/png';
  const blob = await new Promise(res => c.toBlob(res, type, 0.95));
  return { blob, ext: photo ? 'jpg' : 'png' };
}

/* ---------- video ---------- */

export function videoSupported() {
  return typeof window.VideoEncoder === 'function' && typeof window.VideoFrame === 'function';
}

async function pickVideoConfig(w, h, bitrate) {
  /* window.__postsTestCodec: alleen voor geautomatiseerde tests in een browser zonder H.264 */
  const list = window.__postsTestCodec ? [window.__postsTestCodec] : ['avc1.640028', 'avc1.4d0028', 'avc1.42e028'];
  for (const codec of list) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: FPS, bitrateMode: 'variable', latencyMode: 'quality' };
    if (codec.startsWith('avc')) cfg.avc = { format: 'avc' };
    try {
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r.supported) return r.config;
    } catch (e) { /* volgende proberen */ }
  }
  throw new Error('Deze browser kan geen H.264-video maken. Gebruik Chrome, Edge of Safari 17+.');
}

async function pickAudioConfig(sampleRate, channels) {
  if (typeof window.AudioEncoder !== 'function') return null;
  const cfg = { codec: window.__postsTestCodec ? 'opus' : 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: 160_000 };
  try {
    const r = await AudioEncoder.isConfigSupported(cfg);
    return r.supported ? r.config : null;
  } catch (e) { return null; }
}

function seek(video, time) {
  return new Promise(resolve => {
    const target = Math.max(0, Math.min(time, (video.duration || time) - 0.001));
    if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) { resolve(); return; }
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = target;
  });
}

async function decodeAudio(src, start, dur) {
  try {
    const buf = await (await fetch(src)).arrayBuffer();
    const ac = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    const audio = await ac.decodeAudioData(buf);
    ac.close();
    const sr = audio.sampleRate;
    const from = Math.floor(start * sr);
    const len = Math.min(Math.floor(dur * sr), audio.length - from);
    if (len <= 0) return null;
    /* altijd stereo: mono-bronnen worden verdubbeld */
    const ch = 2;
    const planes = [];
    for (let c = 0; c < ch; c++) planes.push(audio.getChannelData(Math.min(c, audio.numberOfChannels - 1)).slice(from, from + len));
    /* korte fade in en uit tegen tikken */
    const fade = Math.min(Math.floor(sr * 0.12), Math.floor(len / 4));
    for (const p of planes) for (let i = 0; i < fade; i++) { const g = i / fade; p[i] *= g; p[len - 1 - i] *= g; }
    let silent = true;
    outer: for (const p of planes) for (let i = 0; i < len; i += 64) if (Math.abs(p[i]) > 1e-4) { silent = false; break outer; }
    if (silent) return null;
    return { sr, ch, len, planes };
  } catch (e) {
    return null;
  }
}

/* Maakt een MP4 van één slide. onProgress krijgt 0..1. */
export async function exportVideo(slide, formatId, getMediaEl, onProgress = () => {}) {
  if (!videoSupported()) throw new Error('Video-export werkt in Chrome, Edge of Safari 17+.');
  await prepareSlide(slide, formatId);
  const size = sizeOf(formatId);
  const fmtKey = size.h > 1500 ? 'story' : 'feed';
  const dur = clipDuration(slide, getMediaEl);
  const frames = Math.round(dur * FPS);

  /* bronvideo van deze slide */
  let vslot = null, vm = null, vel = null;
  for (const [slot, m] of Object.entries(slide.media || {})) {
    if (m && m.kind === 'video' && m.src) { vslot = slot; vm = m; vel = getMediaEl(slot, m); break; }
  }
  const wasPaused = vel ? vel.paused : true;
  if (vel) vel.pause();

  let audio = null, aCfg = null;
  if (vm && vm.sound !== false) {
    audio = await decodeAudio(vm.src, vm.in || 0, dur);
    if (audio) aCfg = await pickAudioConfig(audio.sr, audio.ch);
    if (!aCfg) audio = null;
  }

  const vCfg = await pickVideoConfig(size.w, size.h, BITRATE[fmtKey]);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: window.__postsTestCodec ? 'vp9' : 'avc', width: size.w, height: size.h, frameRate: FPS },
    audio: audio ? { codec: window.__postsTestCodec ? 'opus' : 'aac', numberOfChannels: audio.ch, sampleRate: audio.sr } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  });

  let failure = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { failure = e; }
  });
  venc.configure(vCfg);

  const canvas = canvasFor(formatId);
  const ctx = canvas.getContext('2d', { alpha: false });

  for (let i = 0; i < frames; i++) {
    if (failure) throw failure;
    const t = i / FPS;
    if (vel) await seek(vel, (vm.in || 0) + t);
    renderSlide(ctx, slide, formatId, { t, duration: dur, getMedia: getMediaEl, placeholders: false });
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 4));
    if (i % 3 === 0) onProgress(audio ? i / frames * 0.92 : i / frames);
  }
  await venc.flush();
  venc.close();
  if (failure) throw failure;

  if (audio) {
    let aFail = null;
    const aenc = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: e => { aFail = e; }
    });
    aenc.configure(aCfg);
    const block = 1024 * 8;
    for (let off = 0; off < audio.len; off += block) {
      const n = Math.min(block, audio.len - off);
      const data = new Float32Array(n * audio.ch);
      for (let c = 0; c < audio.ch; c++) data.set(audio.planes[c].subarray(off, off + n), c * n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: audio.sr, numberOfFrames: n, numberOfChannels: audio.ch, timestamp: Math.round(off / audio.sr * 1e6), data });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
    if (aFail) throw aFail;
  }

  muxer.finalize();
  onProgress(1);
  if (vel) { await seek(vel, vm.in || 0); if (!wasPaused) vel.play().catch(() => {}); }
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), ext: 'mp4', seconds: dur, audio: !!audio, codec: vCfg.codec };
}

/* ---------- zip voor carrousels ---------- */

export async function makeZip(files) {
  const entries = {};
  for (const f of files) entries[f.name] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  return new Blob([zipSync(entries)], { type: 'application/zip' });
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

export function fileBase(post, idx) {
  const slug = (post.name || 'skymark-post').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'skymark-post';
  return idx == null ? slug : `${slug}-${String(idx + 1).padStart(2, '0')}`;
}

export function templateName(slide) {
  return getTemplate(slide.template).name;
}
