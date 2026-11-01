/* Skymark posttool: editor. */

import { TEMPLATES, FORMATS, COLORS, getTemplate, templatesFor } from './templates.js';
import { loadFonts, loadAssets, renderSlide, sizeOf, mediaBoxes, mediaRect, paletteOf, prepareSlide } from './engine.js';
import { exportImage, exportVideo, exportSequence, sequenceTimeline, composite, TRANSITIONS, makeZip, download, fileBase, slideHasVideo, clipDuration, videoSupported, MAX_SECONDS } from './exporter.js';

const API = '/api/posts';
const SECRET = 'girxy6-nidzyn-wUknir';
const LS_POST = 'skymark_posts_current';
const LS_AUTHOR = 'skymark_posts_author';

const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const fmtSec = s => s.toFixed(1).replace('.', ',') + ' s';

/* ---------- staat ---------- */

let photos = [];
let post = null;
let current = 0;
let playing = false;
let playStart = 0;
let lastReport = { overflow: [] };
let dirty = false;

function newSlide(templateId, keep) {
  const tpl = getTemplate(templateId);
  const s = { id: uid(), template: tpl.id, palette: tpl.palettes[0].id, texts: {}, media: {}, animate: true, animateOut: true, duration: 6 };
  for (const f of tpl.fields) s.texts[f.key] = f.def;
  if (keep) applyTemplate(s, templateId, keep);
  return s;
}

function newPost(format = 'feed') {
  const first = templatesFor(format)[0].id;
  return { id: uid(), name: 'Naamloze post', format, mode: 'static', videoExport: 'los', transition: { type: 'fade', dur: 0.7 }, slides: [newSlide(first)] };
}

/* Zet een andere template op een slide. Aangepaste teksten en beelden blijven
   staan als het nieuwe template een veld met dezelfde naam heeft. */
function applyTemplate(slide, templateId, from) {
  const src = from || slide;
  const oldTpl = getTemplate(src.template);
  const tpl = getTemplate(templateId);
  const texts = {};
  for (const f of tpl.fields) {
    const old = src.texts[f.key];
    const oldDef = (oldTpl.fields.find(x => x.key === f.key) || {}).def;
    texts[f.key] = old != null && old !== oldDef ? old : f.def;
  }
  const media = {};
  for (const m of tpl.media) if (src.media[m.key]) media[m.key] = src.media[m.key];
  slide.template = tpl.id;
  slide.texts = texts;
  slide.media = media;
  if (!tpl.palettes.find(p => p.id === src.palette)) slide.palette = tpl.palettes[0].id;
  else slide.palette = src.palette;
}

const slide = () => post.slides[current];

/* ---------- media ---------- */

const mediaCache = new Map();

function mediaEl(slot, m) {
  if (!m || !m.src) return null;
  let e = mediaCache.get(m.src);
  if (e) return e;
  if (m.kind === 'video') {
    e = document.createElement('video');
    e.muted = true;
    e.playsInline = true;
    e.preload = 'auto';
    e.loop = false;
    e.addEventListener('loadedmetadata', () => {
      for (const s of post.slides) for (const mm of Object.values(s.media)) {
        if (mm.src === m.src && mm.out == null) mm.out = Math.min(e.duration, MAX_SECONDS + (mm.in || 0));
      }
      e.currentTime = m.in || 0;
      renderInspector();
    });
    e.addEventListener('seeked', () => { if (!playing) draw(); });
    e.addEventListener('loadeddata', () => draw());
    e.src = m.src;
  } else {
    e = new Image();
    e.decoding = 'async';
    e.onload = () => { draw(); updateThumbs(); refreshTemplateThumbs(); };
    e.src = m.src;
  }
  mediaCache.set(m.src, e);
  return e;
}

function getMedia(slot, m) {
  const e = mediaEl(slot, m);
  if (!e) return null;
  if (e instanceof HTMLImageElement && !e.complete) return null;
  if (e instanceof HTMLVideoElement && e.readyState < 2) return null;
  return e;
}

function photoSrc(p) { return '/fotoselectie/' + p.soft; }

/* ---------- canvas en stage ---------- */

const cv = $('#cv');
const ctx = cv.getContext('2d');

function fitStage() {
  if (!post) return;
  const size = sizeOf(post.format);
  if (cv.width !== size.w || cv.height !== size.h) { cv.width = size.w; cv.height = size.h; }
  const wrap = $('#stage-wrap');
  const availW = wrap.clientWidth - 52, availH = wrap.clientHeight - 52;
  const scale = Math.min(availW / size.w, availH / size.h, 1);
  const st = $('#stage');
  st.style.width = Math.floor(size.w * scale) + 'px';
  st.style.height = Math.floor(size.h * scale) + 'px';
  $('#safe-toggle-wrap').style.display = post.format === 'story' ? '' : 'none';
  $('#safe').classList.toggle('show', post.format === 'story' && $('#safe-toggle').checked);
}

function currentDuration() {
  return clipDuration(slide(), (slot, m) => mediaEl(slot, m));
}

function draw(t = null) {
  const s = slide();
  const dur = currentDuration();
  lastReport = renderSlide(ctx, s, post.format, { t, duration: dur, getMedia, onAssetLoad: () => draw() });
  for (const f of getTemplate(s.template).fields) {
    const w = document.querySelector(`[data-warn="${f.key}"]`);
    if (w) w.classList.toggle('show', lastReport.overflow.includes(f.key));
  }
  const tt = t == null ? dur : t;
  $('#time').textContent = fmtSec(t == null ? 0 : tt) + ' / ' + fmtSec(dur);
  $('#tl').style.width = (t == null ? 0 : Math.min(100, tt / dur * 100)) + '%';
}

/* ---------- afspelen ---------- */

const ICON_PLAY = '<svg viewBox="0 0 12 12"><path d="M2 1l9 5-9 5z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 12 12"><path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor"/></svg>';

function videoOf(s) {
  for (const [slot, m] of Object.entries(s.media)) if (m && m.kind === 'video' && m.src) return { m, e: mediaEl(slot, m) };
  return null;
}

const isVideo = () => post.mode === 'video';
const isSequence = () => post.format === 'carousel' && isVideo() && post.videoExport === 'doorlopend' && post.slides.length > 1;

const seqA = document.createElement('canvas');
const seqB = document.createElement('canvas');

function seqTimeline() {
  return sequenceTimeline(post.slides, s => clipDuration(s, (slot, m) => mediaEl(slot, m)), post.transition);
}

/* Toont de hele carrousel als één doorlopende video, met overgangen. */
function tickSeq() {
  if (!playing) return;
  const tl = seqTimeline();
  let t = (performance.now() - playStart) / 1000;
  if (t > tl.total + 0.4) { playStart = performance.now(); t = 0; }
  t = Math.min(t, tl.total - 1 / 60);
  let i = 0;
  while (i < post.slides.length - 1 && t >= tl.starts[i + 1]) i++;
  const inTr = tl.T > 0 && i > 0 && t < tl.starts[i] + tl.T;
  const active = inTr ? [i - 1, i] : [i];
  post.slides.forEach((s, k) => {
    const v = videoOf(s);
    if (!v || !v.e) return;
    if (!active.includes(k)) { if (!v.e.paused) v.e.pause(); return; }
    const target = (v.m.in || 0) + (t - tl.starts[k]);
    if (v.e.paused || Math.abs(v.e.currentTime - target) > 0.3) { v.e.currentTime = target; v.e.play().catch(() => {}); }
  });
  const size = sizeOf(post.format);
  const live = (k, cx) => renderSlide(cx, post.slides[k], post.format, { t: t - tl.starts[k], duration: tl.durs[k], getMedia });
  if (inTr) {
    for (const c of [seqA, seqB]) if (c.width !== size.w || c.height !== size.h) { c.width = size.w; c.height = size.h; }
    live(i - 1, seqA.getContext('2d'));
    live(i, seqB.getContext('2d'));
    composite(ctx, seqA, seqB, post.transition.type, (t - tl.starts[i]) / tl.T, size.w, size.h);
  } else live(i, ctx);
  $('#time').textContent = `Slide ${i + 1} · ` + fmtSec(t) + ' / ' + fmtSec(tl.total);
  $('#tl').style.width = Math.min(100, t / tl.total * 100) + '%';
  requestAnimationFrame(tickSeq);
}

function play() {
  if (!isVideo()) return;
  playing = true;
  $('#play').innerHTML = ICON_PAUSE;
  if (isSequence()) { playStart = performance.now(); requestAnimationFrame(tickSeq); return; }
  const v = videoOf(slide());
  if (v && v.e) { v.e.currentTime = v.m.in || 0; v.e.play().catch(() => {}); }
  playStart = performance.now();
  requestAnimationFrame(tick);
}

function stop() {
  playing = false;
  $('#play').innerHTML = ICON_PLAY;
  for (const e of mediaCache.values()) if (e instanceof HTMLVideoElement) e.pause();
  const v = videoOf(slide());
  if (v && v.e && v.e.readyState) v.e.currentTime = v.m.in || 0;
  draw();
}

function tick() {
  if (!playing) return;
  const dur = currentDuration();
  const v = videoOf(slide());
  let t;
  if (v && v.e) {
    t = v.e.currentTime - (v.m.in || 0);
    if (t >= dur || v.e.ended) { v.e.currentTime = v.m.in || 0; v.e.play().catch(() => {}); t = 0; }
  } else {
    t = (performance.now() - playStart) / 1000;
    if (t > dur + 0.6) { playStart = performance.now(); t = 0; }
  }
  draw(Math.min(t, dur));
  requestAnimationFrame(tick);
}

/* ---------- verschuiven en zoomen met de muis ---------- */

function canvasPoint(ev) {
  const r = cv.getBoundingClientRect();
  return { x: (ev.clientX - r.left) * cv.width / r.width, y: (ev.clientY - r.top) * cv.height / r.height };
}

function hitMedia(p) {
  const boxes = mediaBoxes(slide(), post.format);
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
      const m = slide().media[b.slot];
      const e = m && getMedia(b.slot, m);
      if (e) return { box: b, m, e };
    }
  }
  return null;
}

let drag = null;
cv.addEventListener('pointermove', ev => {
  const p = canvasPoint(ev);
  if (!drag) { $('#stage').classList.toggle('pan', !!hitMedia(p)); return; }
  const { m, rect, start, pos0 } = drag;
  m.pos = {
    x: rect.ox > 0 ? Math.max(-1, Math.min(1, pos0.x - 2 * (p.x - start.x) / rect.ox)) : 0,
    y: rect.oy > 0 ? Math.max(-1, Math.min(1, pos0.y - 2 * (p.y - start.y) / rect.oy)) : 0
  };
  if (!playing) draw();
});
cv.addEventListener('pointerdown', ev => {
  const p = canvasPoint(ev);
  const h = hitMedia(p);
  if (!h) return;
  const nat = h.e instanceof HTMLVideoElement ? [h.e.videoWidth, h.e.videoHeight] : [h.e.naturalWidth, h.e.naturalHeight];
  drag = { m: h.m, rect: mediaRect(h.box, nat[0], nat[1], h.m), start: p, pos0: h.m.pos || { x: 0, y: 0 } };
  cv.setPointerCapture(ev.pointerId);
  $('#stage').classList.add('panning');
});
const endDrag = () => { if (drag) { drag = null; $('#stage').classList.remove('panning'); changed(false); } };
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('wheel', ev => {
  const h = hitMedia(canvasPoint(ev));
  if (!h) return;
  ev.preventDefault();
  h.m.zoom = Math.max(1, Math.min(3, (h.m.zoom || 1) * Math.exp(-ev.deltaY * 0.0015)));
  const z = document.querySelector(`[data-zoom="${h.box.slot}"]`);
  if (z) { z.value = Math.round(h.m.zoom * 100); z.dispatchEvent(new Event('sync')); }
  if (!playing) draw();
  changed(false);
}, { passive: false });

/* ---------- links: formaat en templates ---------- */

const thumbCache = new Map();

function renderThumb(canvas, s, fmt) {
  const size = sizeOf(fmt);
  const key = fmt;
  let off = thumbCache.get(key);
  if (!off) { off = document.createElement('canvas'); thumbCache.set(key, off); }
  off.width = size.w; off.height = size.h;
  renderSlide(off.getContext('2d'), s, fmt, { t: null, getMedia, placeholders: true });
  const c = canvas.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.drawImage(off, 0, 0, canvas.width, canvas.height);
}

function renderTemplates() {
  const wrap = $('#tpl-groups');
  wrap.innerHTML = '';
  const list = templatesFor(post.format);
  const size = sizeOf(post.format);
  const groups = [...new Set(list.map(t => t.group))];
  const sample = photos[0] ? { kind: 'image', src: photoSrc(photos[0]), ref: { type: 'foto', id: photos[0].id }, zoom: 1, pos: { x: 0, y: 0 } } : null;
  for (const g of groups) {
    wrap.append(el('p', { class: 'eyebrow group-title' }, g));
    const grid = el('div', { class: 'tpl-grid' });
    for (const t of list.filter(x => x.group === g)) {
      const c = el('canvas', { width: 216, height: Math.round(216 * size.h / size.w) });
      const b = el('button', { class: 'tpl' + (t.id === slide().template ? ' on' : ''), title: post.format === 'carousel' ? 'Klik: op deze slide. Sleep naar de slidebalk: nieuwe slide.' : (t.note || t.name), draggable: post.format === 'carousel' ? 'true' : null,
        ondragstart: e => { e.dataTransfer.setData(DT_TPL, t.id); e.dataTransfer.effectAllowed = 'copy'; $('#strip').classList.add('dragging'); },
        ondragend: () => clearDrop(), onclick: () => {
        applyTemplate(slide(), t.id);
        changed(true);
      } }, c, el('span', {}, t.name));
      const demo = newSlide(t.id);
      if (sample) for (const m of t.media) demo.media[m.key] = sample;
      renderThumb(c, demo, post.format);
      prepareSlide(demo, post.format).then(() => renderThumb(c, demo, post.format));
      grid.append(b);
    }
    wrap.append(grid);
  }
}

function setFormat(f) {
  if (f === post.format) return;
  if (f !== 'carousel' && post.slides.length > 1) {
    if (!confirm('Een ' + FORMATS[f].name.toLowerCase() + ' heeft één beeld. Alleen de huidige slide blijft over. Doorgaan?')) return;
    post.slides = [slide()];
    current = 0;
  }
  post.format = f;
  for (const s of post.slides) {
    const ok = templatesFor(f).find(t => t.id === s.template);
    if (!ok) applyTemplate(s, templatesFor(f)[0].id);
  }
  changed(true);
}

/* ---------- carrousel ---------- */

function renderStrip() {
  const strip = $('#strip');
  strip.classList.toggle('show', post.format === 'carousel');
  if (post.format !== 'carousel') return;
  strip.innerHTML = '';
  post.slides.forEach((s, i) => {
    const c = el('canvas', { width: 152, height: 190 });
    const b = el('button', { class: 'slide-th' + (i === current ? ' on' : ''), draggable: 'true', 'data-i': i,
      ondragstart: e => { e.dataTransfer.setData(DT_SLIDE, String(i)); e.dataTransfer.effectAllowed = 'move'; $('#strip').classList.add('dragging'); },
      ondragend: () => clearDrop(),
      onclick: () => { if (playing) stop(); current = i; refreshAll(); } },
      c, el('b', {}, String(i + 1)), slideHasVideo(s) ? el('em', {}, 'VIDEO') : null);
    renderThumb(c, s, post.format);
    strip.append(b);
  });
  if (post.slides.length < 20) {
    strip.append(el('button', { class: 'add-slide', title: 'Slide toevoegen', onclick: () => {
      const s = slide();
      const ns = newSlide(s.template);
      ns.palette = s.palette;
      post.slides.splice(current + 1, 0, ns);
      current++;
      changed(true);
    } }, '+'));
  }
  const tools = el('div', { class: 'strip-tools' },
    el('button', { class: 'icon-btn', title: 'Naar links', disabled: current === 0, onclick: () => move(-1) }, '‹'),
    el('button', { class: 'icon-btn', title: 'Naar rechts', disabled: current === post.slides.length - 1, onclick: () => move(1) }, '›'),
    el('button', { class: 'icon-btn', title: 'Dupliceer slide', disabled: post.slides.length >= 20, onclick: () => {
      const copy = JSON.parse(JSON.stringify(slide()));
      copy.id = uid();
      for (const [k, m] of Object.entries(slide().media)) if (m) copy.media[k].src = m.src;
      post.slides.splice(current + 1, 0, copy);
      current++;
      changed(true);
    } }, '⧉'),
    el('button', { class: 'icon-btn', title: 'Verwijder slide', disabled: post.slides.length < 2, onclick: () => {
      post.slides.splice(current, 1);
      current = Math.max(0, current - 1);
      changed(true);
    } }, '×')
  );
  strip.append(tools);
  if (post.slides.length < 4) strip.append(el('p', { class: 'strip-hint' }, 'Sleep een template uit de zijbalk naar deze balk voor een nieuwe slide, of op een slide om die te vervangen. Slides verslepen verandert de volgorde.'));
  strip.append(el('i', { class: 'drop-line', id: 'drop-line' }));
}

/* ---------- slepen naar de slidebalk ---------- */

const DT_TPL = 'text/x-skymark-template';
const DT_SLIDE = 'text/x-skymark-slide';
let dropTarget = null;

function clearDrop() {
  dropTarget = null;
  $('#strip').classList.remove('dragging');
  document.querySelectorAll('.slide-th.drop-replace').forEach(n => n.classList.remove('drop-replace'));
  const line = $('#drop-line');
  if (line) line.style.display = 'none';
}

function dropAt(e) {
  const types = [...e.dataTransfer.types];
  const isTpl = types.includes(DT_TPL);
  const thumbs = [...document.querySelectorAll('.slide-th')];
  const strip = $('#strip');
  const sr = strip.getBoundingClientRect();
  let target = { mode: 'insert', index: thumbs.length };
  for (let k = 0; k < thumbs.length; k++) {
    const r = thumbs[k].getBoundingClientRect();
    if (isTpl && e.clientX > r.left + r.width * 0.25 && e.clientX < r.right - r.width * 0.25) { target = { mode: 'replace', index: k }; break; }
    if (e.clientX < r.left + r.width / 2) { target = { mode: 'insert', index: k }; break; }
  }
  document.querySelectorAll('.slide-th.drop-replace').forEach(n => n.classList.remove('drop-replace'));
  const line = $('#drop-line');
  if (target.mode === 'replace') { thumbs[target.index].classList.add('drop-replace'); line.style.display = 'none'; }
  else {
    const ref = thumbs[target.index] ? thumbs[target.index].getBoundingClientRect().left - 6 : (thumbs.length ? thumbs[thumbs.length - 1].getBoundingClientRect().right + 4 : sr.left + 18);
    line.style.left = (ref - sr.left + strip.scrollLeft) + 'px';
    line.style.display = 'block';
  }
  return target;
}

function bindStripDrop() {
  const strip = $('#strip');
  strip.addEventListener('dragover', e => {
    const types = [...e.dataTransfer.types];
    if (!types.includes(DT_TPL) && !types.includes(DT_SLIDE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = types.includes(DT_TPL) ? 'copy' : 'move';
    dropTarget = dropAt(e);
  });
  strip.addEventListener('dragleave', e => { if (!strip.contains(e.relatedTarget)) { const keep = strip.classList.contains('dragging'); clearDrop(); if (keep) strip.classList.add('dragging'); } });
  strip.addEventListener('drop', e => {
    e.preventDefault();
    const tid = e.dataTransfer.getData(DT_TPL);
    const from = e.dataTransfer.getData(DT_SLIDE);
    const target = dropTarget || dropAt(e);
    clearDrop();
    if (playing) stop();
    if (tid) {
      if (target.mode === 'replace') {
        applyTemplate(post.slides[target.index], tid);
        current = target.index;
      } else {
        if (post.slides.length >= 20) { toast('Een carrousel heeft maximaal 20 slides.'); return; }
        const ns = newSlide(tid);
        const near = post.slides[Math.max(0, target.index - 1)];
        if (near && getTemplate(tid).palettes.find(p => p.id === near.palette)) ns.palette = near.palette;
        post.slides.splice(target.index, 0, ns);
        current = target.index;
      }
      changed(true);
    } else if (from !== '') {
      const f = +from;
      let to = target.index;
      if (to > f) to--;
      if (to === f) return;
      const [s] = post.slides.splice(f, 1);
      post.slides.splice(to, 0, s);
      current = to;
      changed(true);
    }
  });
}

function move(d) {
  const j = current + d;
  if (j < 0 || j >= post.slides.length) return;
  [post.slides[current], post.slides[j]] = [post.slides[j], post.slides[current]];
  current = j;
  changed(true);
}

let tplTimer = null;
function refreshTemplateThumbs() {
  clearTimeout(tplTimer);
  tplTimer = setTimeout(renderTemplates, 120);
}

let thumbTimer = null;
function updateThumbs() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    if (post.format !== 'carousel') return;
    const c = document.querySelector('.slide-th.on canvas');
    if (c) renderThumb(c, slide(), post.format);
  }, 250);
}

/* ---------- rechts: inspector ---------- */

function renderInspector() {
  const s = slide();
  const tpl = getTemplate(s.template);
  const box = $('#inspector');
  box.innerHTML = '';

  box.append(el('div', { class: 'sec' },
    el('p', { class: 'eyebrow' }, post.format === 'carousel' ? `Slide ${current + 1} van ${post.slides.length}` : FORMATS[post.format].name + ' · ' + FORMATS[post.format].ratio),
    el('p', { class: 'tpl-title' }, tpl.name),
    tpl.note ? el('p', { class: 'muted', style: 'margin:0' }, tpl.note) : null
  ));

  /* tekst */
  const tsec = el('div', { class: 'sec' }, el('h4', { class: 'eyebrow' }, 'Tekst'));
  for (const f of tpl.fields) {
    const input = f.multiline
      ? el('textarea', { rows: 3, id: 'f-' + f.key })
      : el('input', { type: 'text', id: 'f-' + f.key });
    input.value = s.texts[f.key] ?? '';
    input.addEventListener('input', () => { s.texts[f.key] = input.value; if (!playing) draw(); changed(false); });
    tsec.append(el('div', { class: 'field' },
      el('label', { for: 'f-' + f.key }, f.label),
      input,
      el('div', { class: 'warn', 'data-warn': f.key }, 'Deze tekst past niet goed. Hij is al verkleind; maak hem korter.')
    ));
  }
  box.append(tsec);

  /* beeld */
  for (const slot of tpl.media) {
    const m = s.media[slot.key];
    const msec = el('div', { class: 'sec' }, el('h4', { class: 'eyebrow' }, slot.label));
    const thumb = el('div', { class: 'media-thumb' });
    if (m && m.src && m.kind === 'image') thumb.style.backgroundImage = `url("${m.src}")`;
    else if (m && m.src && m.kind === 'video') {
      const v = mediaEl(slot.key, m);
      if (v && v.readyState >= 2) {
        const c = el('canvas', { width: 72, height: 90 });
        const cc = c.getContext('2d');
        const r = mediaRect({ x: 0, y: 0, w: 72, h: 90 }, v.videoWidth, v.videoHeight, { zoom: 1 });
        cc.drawImage(v, r.x, r.y, r.w, r.h);
        thumb.append(c);
      }
      thumb.append(el('em', {}, 'VIDEO'));
    } else thumb.append('Geen beeld');

    msec.append(el('div', { class: 'media-card' }, thumb, el('div', { class: 'media-btns' },
      el('button', { class: 'btn', onclick: () => openPhotos(slot.key) }, 'Uit fotoselectie'),
      el('button', { class: 'btn', onclick: () => pickFile(slot.key) }, 'Eigen foto of video'),
      m ? el('button', { class: 'btn', onclick: () => { delete s.media[slot.key]; changed(true); } }, 'Verwijder') : null
    )));

    if (m && m.missing) msec.append(el('p', { class: 'missing' }, `“${m.ref.name}” stond op een andere computer of is herladen. Kies het bestand opnieuw.`));

    if (m && m.src) {
      const zoom = el('input', { type: 'range', min: 100, max: 300, step: 1, 'data-zoom': slot.key });
      zoom.value = Math.round((m.zoom || 1) * 100);
      const zl = el('span', {}, zoom.value + '%');
      const sync = () => { zl.textContent = zoom.value + '%'; };
      zoom.addEventListener('sync', sync);
      zoom.addEventListener('input', () => { m.zoom = zoom.value / 100; sync(); if (!playing) draw(); changed(false); });
      msec.append(el('div', { class: 'range' }, el('label', {}, el('span', {}, 'Zoom'), zl), zoom));
      msec.append(el('p', { class: 'muted', style: 'margin:8px 0 0' }, 'Sleep in het voorbeeld om de uitsnede te verschuiven. ',
        el('a', { href: '#', style: 'color:var(--gold)', onclick: e => { e.preventDefault(); m.zoom = 1; m.pos = { x: 0, y: 0 }; changed(true); } }, 'Centreren')));

      const ov = el('input', { type: 'range', min: 0, max: 80, step: 1 });
      ov.value = Math.round((m.overlay || 0) * 100);
      const ovl = el('span', {}, ov.value + '%');
      ov.addEventListener('input', () => { m.overlay = ov.value / 100; ovl.textContent = ov.value + '%'; if (!playing) draw(); changed(false); });
      msec.append(el('div', { class: 'range' }, el('label', {}, el('span', {}, 'Overlay Binck Black'), ovl), ov));

      if (m.kind === 'video') {
        const v = mediaEl(slot.key, m);
        const total = v && isFinite(v.duration) ? v.duration : 0;
        if (total) {
          const inp = el('input', { type: 'range', min: 0, max: total, step: 0.1 });
          const outp = el('input', { type: 'range', min: 0, max: total, step: 0.1 });
          inp.value = m.in || 0;
          outp.value = m.out != null ? m.out : total;
          const il = el('span', {}, fmtSec(+inp.value));
          const ol = el('span', {}, fmtSec(+outp.value));
          const dl = el('p', { class: 'muted', style: 'margin:6px 0 0' });
          const upd = () => {
            let a = +inp.value, b = +outp.value;
            if (b - a < 0.5) { if (document.activeElement === inp) a = Math.max(0, b - 0.5); else b = Math.min(total, a + 0.5); }
            if (b - a > MAX_SECONDS) { if (document.activeElement === inp) b = a + MAX_SECONDS; else a = b - MAX_SECONDS; }
            inp.value = a; outp.value = b;
            m.in = a; m.out = b;
            il.textContent = fmtSec(a); ol.textContent = fmtSec(b);
            dl.textContent = 'Lengte clip: ' + fmtSec(b - a) + (post.format === 'story' && b - a > 60 ? ' · stories langer dan 60 s knipt Instagram op' : '');
            if (!playing && v.readyState) v.currentTime = document.activeElement === outp ? b : a;
            changed(false);
          };
          inp.addEventListener('input', upd);
          outp.addEventListener('input', upd);
          inp.addEventListener('change', () => { if (!playing && v.readyState) v.currentTime = m.in; });
          upd();
          const snd = el('input', { type: 'checkbox' });
          snd.checked = m.sound !== false;
          snd.addEventListener('change', () => { m.sound = snd.checked; changed(false); });
          msec.append(
            el('div', { class: 'range' }, el('label', {}, el('span', {}, isVideo() ? 'Begin' : 'Begin (dit beeld wordt de afbeelding)'), il), inp),
            el('div', { class: 'range' }, el('label', {}, el('span', {}, 'Einde'), ol), outp),
            dl,
            el('label', { class: 'chk', style: 'margin-top:10px' }, snd, 'Geluid van de video meenemen')
          );
        }
      }
    }
    box.append(msec);
  }

  /* kleur */
  const csec = el('div', { class: 'sec' }, el('h4', { class: 'eyebrow' }, 'Kleuren'));
  const sw = el('div', { class: 'swatches' });
  for (const p of tpl.palettes) {
    const bg = COLORS[p.swatch ? p.swatch : p.bg].hex;
    const dot = COLORS[p.swatch ? p.swatch : p.head].hex;
    const i = el('i', { style: `background:${p.swatch ? 'repeating-conic-gradient(#3a3f3a 0 25%,#2b2f2b 0 50%) 0 0/14px 14px' : bg}` }, el('u', { style: `background:${p.swatch ? bg : dot}` }));
    sw.append(el('button', { class: 'sw' + (paletteOf(tpl, s.palette).id === p.id ? ' on' : ''), title: p.name, onclick: () => { s.palette = p.id; changed(true); } }, i, p.name));
  }
  csec.append(sw, el('p', { class: 'muted', style: 'margin:12px 0 0' }, 'Alleen combinaties uit het brandbook, zodat alles leesbaar en herkenbaar blijft.'));
  box.append(csec);

  /* export */
  if (!isVideo()) {
    box.append(el('div', { class: 'sec' }, el('h4', { class: 'eyebrow' }, 'Export als afbeelding'),
      el('ul', { class: 'spec' },
        el('li', {}, `${sizeOf(post.format).w}×${sizeOf(post.format).h} pixels`),
        el('li', {}, 'JPG met foto, PNG zonder foto (scherpe vlakken en letters)'),
        post.format === 'carousel' ? el('li', {}, 'Carrousel: zip met genummerde bestanden') : null,
        el('li', {}, 'Wil je beweging? Zet de modus bovenin op Video.')
      )));
    return;
  }
  const hasVideo = slideHasVideo(s);
  const anim = el('input', { type: 'checkbox' });
  anim.checked = s.animate !== false;
  anim.addEventListener('change', () => { s.animate = anim.checked; changed(false); });
  const animOut = el('input', { type: 'checkbox' });
  animOut.checked = s.animateOut !== false;
  animOut.addEventListener('change', () => { s.animateOut = animOut.checked; changed(false); });
  const bsec = el('div', { class: 'sec' }, el('h4', { class: 'eyebrow' }, post.format === 'carousel' ? 'Beweging van deze slide' : 'Beweging'),
    el('label', { class: 'chk' }, anim, 'In: tekst en beeld rustig laten binnenkomen'),
    el('label', { class: 'chk', style: 'margin-top:8px' }, animOut, 'Uit: tekst rustig laten verdwijnen aan het eind'));
  if (!hasVideo) {
    const d = el('input', { type: 'range', min: 3, max: 20, step: 1 });
    d.value = s.duration || 6;
    const dl = el('span', {}, d.value + ' s');
    d.addEventListener('input', () => { s.duration = +d.value; dl.textContent = d.value + ' s'; changed(false); });
    bsec.append(el('div', { class: 'range' }, el('label', {}, el('span', {}, 'Duur van de video'), dl), d));
  }
  bsec.append(el('ul', { class: 'spec', style: 'margin-top:14px' },
    el('li', {}, `MP4, H.264 + AAC, 30 fps, ${sizeOf(post.format).w}×${sizeOf(post.format).h}`),
    el('li', {}, 'Klaar voor Instagram: geen extra omzetting nodig'),
    post.format === 'carousel' && post.videoExport !== 'doorlopend' ? el('li', {}, 'Carrousel: elke slide als MP4 in één zip') : null
  ));
  box.append(bsec);
  if (post.format === 'carousel') box.append(sequenceSection());
}

/* Carrousel als video: losse clips voor Instagram, of één doorlopende video met overgangen. */
function sequenceSection() {
  const sec = el('div', { class: 'sec' }, el('h4', { class: 'eyebrow' }, 'Carrousel als video'));
  const opt = (val, title, sub) => {
    const r = el('input', { type: 'radio', name: 'vexp', value: val });
    r.checked = (post.videoExport || 'los') === val;
    r.addEventListener('change', () => { post.videoExport = val; if (playing) stop(); changed(true); });
    return el('label', { class: 'radio' }, r, el('span', {}, el('b', {}, title), el('small', {}, sub)));
  };
  sec.append(
    opt('los', 'Losse video’s', 'Voor een Instagram-carrousel. Elke slide een eigen MP4 met in- en uitgang; de kijker swipet zelf.'),
    opt('doorlopend', 'Eén doorlopende video', 'Voor een Reel of story. Alle slides achter elkaar, met een overgang ertussen.')
  );
  if (post.videoExport === 'doorlopend') {
    const tr = post.transition || (post.transition = { type: 'fade', dur: 0.7 });
    const row = el('div', { class: 'chips' });
    for (const [k, v] of Object.entries(TRANSITIONS)) {
      row.append(el('button', { class: 'chip' + (tr.type === k ? ' on' : ''), onclick: () => { tr.type = k; changed(true); } }, v.name));
    }
    sec.append(el('p', { class: 'muted', style: 'margin:14px 0 8px' }, 'Overgang'), row);
    if (tr.type !== 'cut') {
      const d = el('input', { type: 'range', min: 3, max: 15, step: 1 });
      d.value = Math.round((tr.dur || 0.7) * 10);
      const dl = el('span', {}, fmtSec(d.value / 10));
      d.addEventListener('input', () => { tr.dur = d.value / 10; dl.textContent = fmtSec(tr.dur); changed(false); });
      sec.append(el('div', { class: 'range' }, el('label', {}, el('span', {}, 'Duur van de overgang'), dl), d));
    }
    const tl = seqTimeline();
    sec.append(el('p', { class: 'muted', style: 'margin:10px 0 0' }, `Totale lengte: ${fmtSec(tl.total)}. Druk op afspelen om de hele reeks te zien.`));
  }
  return sec;
}

/* ---------- beeld kiezen ---------- */

let pickSlot = null;

function openPhotos(slotKey) {
  pickSlot = slotKey;
  const grid = $('#photo-grid');
  if (!grid.childElementCount) {
    for (const p of photos) {
      grid.append(el('button', { title: p.title, onclick: () => {
        const s = slide();
        const prev = s.media[pickSlot];
        s.media[pickSlot] = { kind: 'image', src: photoSrc(p), ref: { type: 'foto', id: p.id }, zoom: 1, pos: { x: 0, y: 0 } };
        if (prev && prev.kind === 'image') { s.media[pickSlot].zoom = 1; }
        $('#m-photos').classList.remove('show');
        changed(true);
      } }, el('img', { src: '/fotoselectie/' + p.thumb, loading: 'lazy', alt: p.title }), el('span', {}, p.title)));
    }
  }
  $('#m-photos').classList.add('show');
}

function pickFile(slotKey) {
  pickSlot = slotKey;
  const inp = $('#file-input');
  inp.value = '';
  inp.click();
}

$('#file-input').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const kind = f.type.startsWith('video') ? 'video' : 'image';
  const src = URL.createObjectURL(f);
  slide().media[pickSlot] = { kind, src, ref: { type: 'upload', name: f.name }, zoom: 1, pos: { x: 0, y: 0 }, in: 0, out: null, sound: true, overlay: 0 };
  if (kind === 'video' && !isVideo()) {
    post.mode = 'video';
    toast('Video toegevoegd: de post staat nu in videomodus. Terugzetten kan bovenin.');
  }
  changed(true);
});

/* ---------- opslaan ---------- */

function serialize() {
  return {
    id: post.id,
    name: post.name,
    format: post.format,
    mode: post.mode,
    videoExport: post.videoExport,
    transition: post.transition,
    slides: post.slides.map(s => ({
      id: s.id, template: s.template, palette: s.palette, texts: s.texts, animate: s.animate, animateOut: s.animateOut, duration: s.duration,
      media: Object.fromEntries(Object.entries(s.media).filter(([, m]) => m).map(([k, m]) => [k, {
        kind: m.kind, ref: m.ref, zoom: m.zoom || 1, pos: m.pos || { x: 0, y: 0 }, in: m.in || 0, out: m.out ?? null, sound: m.sound !== false, overlay: m.overlay || 0
      }]))
    }))
  };
}

function hydrate(data) {
  const p = { id: data.id || uid(), name: data.name || 'Naamloze post', format: FORMATS[data.format] ? data.format : 'feed', mode: data.mode === 'video' ? 'video' : 'static',
    videoExport: data.videoExport === 'doorlopend' ? 'doorlopend' : 'los',
    transition: { type: data.transition && TRANSITIONS[data.transition.type] ? data.transition.type : 'fade', dur: data.transition && +data.transition.dur > 0 ? Math.min(1.5, +data.transition.dur) : 0.7 },
    slides: [] };
  for (const s of data.slides || []) {
    const tpl = getTemplate(s.template);
    const ns = newSlide(tpl.id);
    ns.id = s.id || uid();
    ns.palette = s.palette || ns.palette;
    ns.animate = s.animate !== false;
    ns.animateOut = s.animateOut !== false;
    ns.duration = s.duration || 6;
    for (const f of tpl.fields) if (s.texts && s.texts[f.key] != null) ns.texts[f.key] = s.texts[f.key];
    for (const [k, m] of Object.entries(s.media || {})) {
      if (!m || !m.ref) continue;
      const mm = Object.assign({}, m);
      if (m.ref.type === 'foto') {
        const ph = photos.find(x => x.id === m.ref.id);
        mm.src = ph ? photoSrc(ph) : null;
        if (!ph) continue;
      } else { mm.src = null; mm.missing = true; }
      ns.media[k] = mm;
    }
    p.slides.push(ns);
  }
  if (!p.slides.length) p.slides.push(newSlide(templatesFor(p.format)[0].id));
  return p;
}

let saveTimer = null;
function changed(structural) {
  dirty = true;
  $('#save-state').textContent = 'Niet bewaard';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(LS_POST, JSON.stringify(serialize())); } catch (e) {} }, 400);
  if (structural) refreshAll();
  else { updateThumbs(); }
}

function author() {
  try { return localStorage.getItem(LS_AUTHOR) || ''; } catch (e) { return ''; }
}

function askAuthor() {
  return new Promise(resolve => {
    const m = $('#m-name');
    const inp = $('#name-input');
    inp.value = author();
    m.classList.add('show');
    inp.focus();
    const ok = () => {
      const v = inp.value.trim();
      if (!v) { inp.focus(); return; }
      try { localStorage.setItem(LS_AUTHOR, v); } catch (e) {}
      m.classList.remove('show');
      $('#name-ok').removeEventListener('click', ok);
      resolve(v);
    };
    $('#name-ok').addEventListener('click', ok);
    inp.onkeydown = e => { if (e.key === 'Enter') ok(); };
  });
}

async function api(body) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ secret: SECRET }, body)) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}

async function saveDraft() {
  const who = author() || await askAuthor();
  const btn = $('#btn-save');
  btn.disabled = true;
  $('#save-state').textContent = 'Bewaren...';
  try {
    await api({ action: 'save', draft: Object.assign(serialize(), { author: who }) });
    dirty = false;
    $('#save-state').textContent = 'Bewaard';
    const uploads = post.slides.some(s => Object.values(s.media).some(m => m && m.ref && m.ref.type === 'upload'));
    toast(uploads ? 'Concept bewaard. Eigen foto’s en video’s gaan niet mee; die kies je bij openen opnieuw.' : 'Concept bewaard. Celine en jij zien het onder Concepten.');
  } catch (e) {
    $('#save-state').textContent = 'Niet bewaard';
    toast('Bewaren lukte niet: ' + e.message);
  } finally { btn.disabled = false; }
}

async function openDrafts() {
  const list = $('#draft-list');
  list.innerHTML = '<li class="muted">Laden...</li>';
  $('#m-drafts').classList.add('show');
  try {
    const { drafts } = await api({ action: 'list' });
    list.innerHTML = '';
    if (!drafts.length) list.append(el('li', { class: 'muted' }, 'Nog geen concepten.'));
    for (const d of drafts) {
      const when = new Date(d.updated).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      list.append(el('li', {},
        el('div', {}, el('b', {}, d.name), el('small', {}, `${FORMATS[d.format].name}${d.count > 1 ? ' · ' + d.count + ' slides' : ''} · ${d.author || 'onbekend'} · ${when}`)),
        el('button', { class: 'btn', onclick: async () => {
          if (dirty && !confirm('Je huidige post is niet bewaard. Toch dit concept openen?')) return;
          const { draft } = await api({ action: 'get', id: d.id });
          if (playing) stop();
          post = hydrate(draft); current = 0; dirty = false;
          $('#m-drafts').classList.remove('show');
          refreshAll();
          $('#save-state').textContent = 'Geopend';
        } }, 'Open'),
        el('button', { class: 'close', title: 'Verwijder', onclick: async () => {
          if (!confirm(`“${d.name}” verwijderen?`)) return;
          await api({ action: 'delete', id: d.id });
          openDrafts();
        } }, '×')
      ));
    }
  } catch (e) {
    list.innerHTML = '';
    list.append(el('li', { class: 'muted' }, 'Concepten laden lukte niet: ' + e.message));
  }
}

/* ---------- exporteren ---------- */

function exportModal(title) {
  $('#exp-title').textContent = title;
  $('#exp-text').textContent = 'Bezig...';
  $('#exp-bar').style.width = '0%';
  $('#m-export').classList.add('show');
  return {
    set(text, p) { if (text) $('#exp-text').textContent = text; if (p != null) $('#exp-bar').style.width = Math.round(p * 100) + '%'; },
    close() { $('#m-export').classList.remove('show'); }
  };
}

function checkMissing(slides) {
  const miss = slides.some(s => getTemplate(s.template).media.some(m => !s.media[m.key] || !s.media[m.key].src));
  if (miss) return confirm('Niet elk beeldvak is gevuld. Lege vakken worden een effen vlak. Toch exporteren?');
  return true;
}

async function exportSlide() {
  return doExport(isVideo() ? 'video' : 'image');
}

async function exportMain() {
  if (isSequence()) return exportReel();
  if (post.format === 'carousel') return exportCarousel();
  return exportSlide();
}

async function doExport(kind) {
  if (playing) stop();
  const s = slide();
  if (!checkMissing([s])) return;
  const idx = post.format === 'carousel' ? current : null;
  const name = fileBase(post, idx);
  if (kind === 'image') {
    const { blob, ext } = await exportImage(s, post.format, getMedia);
    download(blob, `${name}.${ext}`);
    toast(`Afbeelding geëxporteerd (${(blob.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB).`);
    return;
  }
  if (!videoSupported()) { toast('Video exporteren werkt in Chrome, Edge of Safari 17 en nieuwer.'); return; }
  const ui = exportModal('Video maken');
  try {
    const res = await exportVideo(s, post.format, getMedia, p => ui.set(`Beeld voor beeld renderen: ${Math.round(p * 100)}%`, p));
    download(res.blob, `${name}.mp4`);
    toast(`Video klaar: ${fmtSec(res.seconds)}, ${(res.blob.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB${res.audio ? ', met geluid' : ''}.`);
  } catch (e) {
    toast('Video maken lukte niet: ' + e.message);
  } finally { ui.close(); draw(); }
}

async function exportReel() {
  if (playing) stop();
  if (!checkMissing(post.slides)) return;
  if (!videoSupported()) { toast('Video exporteren werkt in Chrome, Edge of Safari 17 en nieuwer.'); return; }
  const ui = exportModal('Doorlopende video maken');
  try {
    const res = await exportSequence(post.slides, post.format, getMedia, post.transition, p => ui.set(`Beeld voor beeld renderen: ${Math.round(p * 100)}%`, p));
    download(res.blob, `${fileBase(post)}.mp4`);
    toast(`Video klaar: ${post.slides.length} slides, ${fmtSec(res.seconds)}, ${(res.blob.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB${res.audio ? ', met geluid' : ''}.`);
  } catch (e) {
    toast('Video maken lukte niet: ' + e.message);
  } finally { ui.close(); draw(); }
}

async function exportCarousel() {
  if (playing) stop();
  if (!checkMissing(post.slides)) return;
  const ui = exportModal('Carrousel exporteren');
  const files = [];
  try {
    for (let i = 0; i < post.slides.length; i++) {
      const s = post.slides[i];
      const base = fileBase(post, i);
      const frac = i / post.slides.length;
      ui.set(`Slide ${i + 1} van ${post.slides.length}`, frac);
      if (isVideo()) {
        if (!videoSupported()) throw new Error('video vraagt Chrome, Edge of Safari 17+');
        const r = await exportVideo(s, post.format, getMedia, p => ui.set(`Slide ${i + 1} van ${post.slides.length}: video ${Math.round(p * 100)}%`, frac + p / post.slides.length));
        files.push({ name: `${base}.mp4`, blob: r.blob });
      } else {
        const r = await exportImage(s, post.format, getMedia);
        files.push({ name: `${base}.${r.ext}`, blob: r.blob });
      }
    }
    ui.set('Zip maken', 1);
    const zip = await makeZip(files);
    download(zip, `${fileBase(post)}.zip`);
    toast(`Carrousel geëxporteerd: ${files.length} bestanden, in de juiste volgorde genummerd.`);
  } catch (e) {
    toast('Exporteren lukte niet: ' + e.message);
  } finally { ui.close(); draw(); }
}

/* ---------- algemeen ---------- */

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4800);
}

function refreshAll() {
  if (current >= post.slides.length) current = post.slides.length - 1;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.f === post.format));
  $('#post-name').value = post.name;
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.m === post.mode));
  $('#btn-slide').style.display = post.format === 'carousel' ? '' : 'none';
  $('#btn-export').textContent = isSequence() ? 'Exporteer als één video' : post.format === 'carousel' ? (isVideo() ? 'Exporteer carrousel (MP4)' : 'Exporteer carrousel') : (isVideo() ? 'Exporteer video' : 'Exporteer afbeelding');
  $('#playbar').classList.toggle('hide', !isVideo());
  if (!isVideo() && playing) stop();
  renderTemplates();
  renderStrip();
  renderInspector();
  fitStage();
  draw();
}

function setMode(m) {
  if (m === post.mode) return;
  if (playing) stop();
  post.mode = m;
  changed(true);
}

function bind() {
  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => setFormat(b.dataset.f)));
  $('#post-name').addEventListener('input', e => { post.name = e.target.value; changed(false); });
  $('#play').innerHTML = ICON_PLAY;
  $('#play').addEventListener('click', () => (playing ? stop() : play()));
  $('#safe-toggle').addEventListener('change', fitStage);
  $('#btn-new').addEventListener('click', () => {
    if (dirty && !confirm('Je huidige post is niet bewaard. Toch een nieuwe beginnen?')) return;
    if (playing) stop();
    post = newPost(post.format); current = 0; dirty = false;
    $('#save-state').textContent = '';
    refreshAll();
  });
  $('#btn-save').addEventListener('click', saveDraft);
  $('#btn-drafts').addEventListener('click', openDrafts);
  document.querySelectorAll('#mode button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.m)));
  $('#btn-slide').addEventListener('click', exportSlide);
  $('#btn-export').addEventListener('click', exportMain);
  new ResizeObserver(() => fitStage()).observe($('#stage-wrap'));
  bindStripDrop();
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.modal').classList.remove('show')));
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m && m.id !== 'm-export' && m.id !== 'm-name') m.classList.remove('show'); }));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal.show').forEach(m => { if (m.id !== 'm-export') m.classList.remove('show'); });
    if (e.key === ' ' && isVideo() && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); playing ? stop() : play(); }
  });
  window.addEventListener('resize', fitStage);
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
}

async function init() {
  const [, , pj] = await Promise.all([
    loadFonts(),
    loadAssets(),
    fetch('/fotoselectie/pairs.json').then(r => r.json()).catch(() => ({ pairs: [] }))
  ]);
  photos = (pj.pairs || []).filter(p => p.soft);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_POST)); } catch (e) {}
  post = saved ? hydrate(saved) : newPost('feed');
  bind();
  refreshAll();
  window.__posts = { get post() { return post; }, set post(p) { post = p; refreshAll(); }, hydrate, refreshAll, getMedia, exportVideo, exportImage, setCurrent: i => { current = i; refreshAll(); } };
}

init();
