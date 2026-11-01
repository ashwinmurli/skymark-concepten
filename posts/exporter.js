/* Skymark posttool: export naar afbeelding, MP4 en zip.

   Video: H.264 (High profile) + AAC in MP4 met de index vooraan (fast start),
   30 fps, vaste resolutie 1080 breed. Dat is wat Instagram verwacht, dus het
   bestand wordt bij uploaden zo min mogelijk opnieuw bewerkt. De bitrate is
   afgestemd op scherpte bij een zo klein mogelijk bestand. */

import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer.mjs';
import { zipSync } from './vendor/fflate.mjs';
import { renderSlide, sizeOf, prepareSlide, introLength, ANIM } from './engine.js';
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
  return Math.max(slide.duration || 6, introLength(slide, 'feed') + ANIM.outDur + 1);
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
    const avail = Math.min(Math.floor(dur * sr), audio.length - from);
    if (avail <= 0) return null;
    /* geluid loopt altijd even lang als het beeld: een korter spoor wordt met stilte aangevuld */
    const len = Math.floor(dur * sr);
    /* altijd stereo: mono-bronnen worden verdubbeld */
    const ch = 2;
    const planes = [];
    for (let c = 0; c < ch; c++) {
      const p = new Float32Array(len);
      p.set(audio.getChannelData(Math.min(c, audio.numberOfChannels - 1)).subarray(from, from + avail));
      planes.push(p);
    }
    /* korte fade in en uit tegen tikken */
    const fade = Math.min(Math.floor(sr * 0.12), Math.floor(avail / 4));
    for (const p of planes) for (let i = 0; i < fade; i++) { const g = i / fade; p[i] *= g; p[avail - 1 - i] *= g; }
    let silent = true;
    outer: for (const p of planes) for (let i = 0; i < avail; i += 64) if (Math.abs(p[i]) > 1e-4) { silent = false; break outer; }
    if (silent) return null;
    return { sr, ch, len, planes };
  } catch (e) {
    return null;
  }
}

/* Schrijft frames en (optioneel) geluid naar een MP4. */
async function createWriter(size, audio) {
  const fmtKey = size.h > 1500 ? 'story' : 'feed';
  let aCfg = null;
  if (audio) { aCfg = await pickAudioConfig(audio.sr, audio.ch); if (!aCfg) audio = null; }
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
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failure = e; } });
  venc.configure(vCfg);
  let i = 0;
  return {
    hasAudio: !!audio,
    codec: vCfg.codec,
    async frame(canvas) {
      if (failure) throw failure;
      const f = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      venc.encode(f, { keyFrame: i % (FPS * 2) === 0 });
      f.close();
      i++;
      while (venc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 4));
    },
    async finish() {
      await venc.flush();
      venc.close();
      if (failure) throw failure;
      if (audio) {
        let aFail = null;
        const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { aFail = e; } });
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
      return new Blob([target.buffer], { type: 'video/mp4' });
    }
  };
}

function videoSlot(slide) {
  for (const [slot, m] of Object.entries(slide.media || {})) if (m && m.kind === 'video' && m.src) return { slot, m };
  return null;
}

/* Maakt een MP4 van één slide. onProgress krijgt 0..1. */
export async function exportVideo(slide, formatId, getMediaEl, onProgress = () => {}) {
  if (!videoSupported()) throw new Error('Video-export werkt in Chrome, Edge of Safari 17+.');
  await prepareSlide(slide, formatId);
  const size = sizeOf(formatId);
  const dur = clipDuration(slide, getMediaEl);
  const frames = Math.round(dur * FPS);
  const vs = videoSlot(slide);
  const vm = vs && vs.m;
  const vel = vs ? getMediaEl(vs.slot, vm) : null;
  const wasPaused = vel ? vel.paused : true;
  if (vel) vel.pause();

  const audio = vm && vm.sound !== false ? await decodeAudio(vm.src, vm.in || 0, dur) : null;
  const w = await createWriter(size, audio);
  const canvas = canvasFor(formatId);
  const ctx = canvas.getContext('2d', { alpha: false });
  for (let i = 0; i < frames; i++) {
    const t = i / FPS;
    if (vel) await seek(vel, (vm.in || 0) + t);
    renderSlide(ctx, slide, formatId, { t, duration: dur, getMedia: getMediaEl, placeholders: false });
    await w.frame(canvas);
    if (i % 3 === 0) onProgress(i / frames * 0.95);
  }
  const blob = await w.finish();
  onProgress(1);
  if (vel) { await seek(vel, vm.in || 0); if (!wasPaused) vel.play().catch(() => {}); }
  return { blob, ext: 'mp4', seconds: dur, audio: w.hasAudio, codec: w.codec };
}

/* ---------- doorlopende video van een hele carrousel ---------- */

export const TRANSITIONS = {
  cut:   { name: 'Harde knip' },
  fade:  { name: 'Overvloeien' },
  slide: { name: 'Doorschuiven' },
  wipe:  { name: 'Onthullen' }
};

const easeInOut = x => { x = Math.min(1, Math.max(0, x)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

/* Mengt twee slides tijdens een overgang. p loopt van 0 naar 1. */
export function composite(ctx, a, b, type, p, w, h) {
  const e = easeInOut(p);
  ctx.save();
  if (type === 'fade') {
    ctx.drawImage(a, 0, 0);
    ctx.globalAlpha = e;
    ctx.drawImage(b, 0, 0);
  } else if (type === 'slide') {
    ctx.drawImage(a, -w * e, 0);
    ctx.drawImage(b, w * (1 - e), 0);
  } else if (type === 'wipe') {
    ctx.drawImage(a, 0, 0);
    ctx.beginPath();
    ctx.rect(0, h * (1 - e), w, h * e);
    ctx.clip();
    ctx.drawImage(b, 0, h * (1 - e) * 0.25);
  } else {
    ctx.drawImage(p < 0.5 ? a : b, 0, 0);
  }
  ctx.restore();
}

/* Tijdlijn: begin en duur per slide, met overlap voor de overgang. */
export function sequenceTimeline(slides, durOf, transition) {
  const durs = slides.map(durOf);
  const T = transition.type === 'cut' ? 0 : Math.min(transition.dur || 0.7, 0.45 * Math.min(...durs));
  const starts = [];
  let t = 0;
  durs.forEach((d, i) => { starts.push(t); t += d - (i < durs.length - 1 ? T : 0); });
  return { durs, starts, T, total: t };
}

function loadVideoCopy(src) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error('video kon niet geladen worden'));
    v.src = src;
  });
}

export async function exportSequence(slides, formatId, getMediaEl, transition, onProgress = () => {}) {
  if (!videoSupported()) throw new Error('Video-export werkt in Chrome, Edge of Safari 17+.');
  const size = sizeOf(formatId);
  for (const s of slides) await prepareSlide(s, formatId);

  /* elke video-slide krijgt een eigen videospeler, zodat twee slides met
     dezelfde bron tijdens een overgang elk hun eigen moment tonen */
  const copies = await Promise.all(slides.map(async s => {
    const vs = videoSlot(s);
    return vs ? { slot: vs.slot, m: vs.m, el: await loadVideoCopy(vs.m.src) } : null;
  }));
  const getters = slides.map((s, i) => (slot, m) => (copies[i] && copies[i].slot === slot ? copies[i].el : getMediaEl(slot, m)));
  const tl = sequenceTimeline(slides, s => clipDuration(s, getMediaEl), transition);

  /* geluid: alle clips op hun plek in één spoor, met crossfade in de overlap */
  let audio = null;
  const sr = 48000;
  const clips = await Promise.all(slides.map((s, i) => copies[i] && copies[i].m.sound !== false ? decodeAudio(copies[i].m.src, copies[i].m.in || 0, tl.durs[i]) : null));
  if (clips.some(Boolean)) {
    const len = Math.ceil(tl.total * sr);
    const planes = [new Float32Array(len), new Float32Array(len)];
    const Ts = Math.floor(tl.T * sr);
    clips.forEach((c, i) => {
      if (!c) return;
      const off = Math.floor(tl.starts[i] * sr);
      for (let ch = 0; ch < 2; ch++) {
        const src = c.planes[ch], dst = planes[ch];
        for (let k = 0; k < c.len && off + k < len; k++) {
          let g = 1;
          if (i > 0 && Ts && k < Ts) g *= k / Ts;
          if (i < slides.length - 1 && Ts && k > c.len - Ts) g *= (c.len - k) / Ts;
          dst[off + k] += src[k] * g;
        }
      }
    });
    audio = { sr, ch: 2, len, planes };
  }

  const w = await createWriter(size, audio);
  const out = canvasFor(formatId), octx = out.getContext('2d', { alpha: false });
  const ca = canvasFor(formatId), cb = canvasFor(formatId);
  const xa = ca.getContext('2d'), xb = cb.getContext('2d');
  const frames = Math.round(tl.total * FPS);

  const renderAt = async (i, local, cx) => {
    const c = copies[i];
    if (c) await seek(c.el, (c.m.in || 0) + Math.min(local, tl.durs[i] - 1 / FPS));
    renderSlide(cx, slides[i], formatId, { t: local, duration: tl.durs[i], getMedia: getters[i], placeholders: false });
  };

  for (let f = 0; f < frames; f++) {
    const t = f / FPS;
    let i = 0;
    while (i < slides.length - 1 && t >= tl.starts[i + 1]) i++;
    const inTransition = tl.T > 0 && i > 0 && t < tl.starts[i] + tl.T;
    if (inTransition) {
      await renderAt(i - 1, t - tl.starts[i - 1], xa);
      await renderAt(i, t - tl.starts[i], xb);
      composite(octx, ca, cb, transition.type, (t - tl.starts[i]) / tl.T, size.w, size.h);
    } else {
      await renderAt(i, t - tl.starts[i], octx);
    }
    await w.frame(out);
    if (f % 3 === 0) onProgress(f / frames * 0.95);
  }
  const blob = await w.finish();
  onProgress(1);
  for (const c of copies) if (c) { c.el.removeAttribute('src'); c.el.load(); }
  return { blob, ext: 'mp4', seconds: tl.total, audio: w.hasAudio, codec: w.codec };
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
