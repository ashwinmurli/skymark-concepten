/* Skymark posttool: editor. */

import { TEMPLATES, FORMATS, COLORS, getTemplate, templatesFor } from './templates.js';
import { loadFonts, loadAssets, renderSlide, sizeOf, mediaBoxes, mediaRect, paletteOf, prepareSlide } from './engine.js';
import { initReview, refreshReview, statusPill, STATUS } from './review.js';
import { exportImage, exportVideo, exportSequence, sequenceTimeline, composite, TRANSITIONS, makeZip, download, fileBase, slideHasVideo, clipDuration, videoSupported, MAX_SECONDS } from './exporter.js';

const API = '/api/posts';
const PW_VIEW = 'girxy6-nidzyn-wUknir';
let SECRET = PW_VIEW;
let ROLE = 'approver';
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

function photoSrc(p) { return '/fotoselectie/' + (p.after || p.soft || p.before); }

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

/* ---------- thumbnails ---------- */

const thumbCache = new Map();
const MAX_SLIDES = 20;

function renderThumb(canvas, s, fmt) {
  const size = sizeOf(fmt);
  let off = thumbCache.get(fmt);
  if (!off) { off = document.createElement('canvas'); thumbCache.set(fmt, off); }
  off.width = size.w; off.height = size.h;
  renderSlide(off.getContext('2d'), s, fmt, { t: null, getMedia, placeholders: true });
  const c = canvas.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.drawImage(off, 0, 0, canvas.width, canvas.height);
}

/* ---------- templatekiezer (nieuwe slide of template wisselen) ---------- */

let pickerMode = 'add';
let pickerFilter = 'Alle';

function sampleMedia() {
  return photos[0] ? { kind: 'image', src: photoSrc(photos[0]), ref: { type: 'foto', id: photos[0].id }, zoom: 1, pos: { x: 0, y: 0 } } : null;
}

function openPicker(mode) {
  pickerMode = mode;
  pickerFilter = 'Alle';
  $('#tpl-title').textContent = mode === 'add' ? 'Nieuwe slide: kies een template' : 'Template wisselen';
  renderPicker();
  $('#m-tpl').classList.add('show');
}

function renderPicker() {
  const list = templatesFor(post.format);
  const groups = ['Alle', ...new Set(list.map(t => t.group))];
  const f = $('#tpl-filters');
  f.innerHTML = '';
  for (const g of groups) f.append(el('button', { class: 'chip' + (g === pickerFilter ? ' on' : ''), onclick: () => { pickerFilter = g; renderPicker(); } }, g));
  const grid = $('#tpl-grid');
  grid.innerHTML = '';
  const size = sizeOf(post.format);
  const sample = sampleMedia();
  for (const t of list.filter(x => pickerFilter === 'Alle' || x.group === pickerFilter)) {
    const c = el('canvas', { width: 320, height: Math.round(320 * size.h / size.w) });
    grid.append(el('button', { class: 'tpl' + (pickerMode === 'swap' && t.id === slide().template ? ' on' : ''), onclick: () => pickTemplate(t.id) },
      c, el('span', {}, t.name), el('small', {}, t.group)));
    const demo = newSlide(t.id);
    if (sample) for (const m of t.media) demo.media[m.key] = sample;
    renderThumb(c, demo, post.format);
    prepareSlide(demo, post.format).then(() => renderThumb(c, demo, post.format));
  }
}

function pickTemplate(tid) {
  $('#m-tpl').classList.remove('show');
  if (playing) stop();
  itab = 'design';
  if (pickerMode === 'swap') { applyTemplate(slide(), tid); changed(true); return; }
  if (post.slides.length >= MAX_SLIDES) { toast(`Een carrousel heeft maximaal ${MAX_SLIDES} slides.`); return; }
  const ns = newSlide(tid);
  const near = slide();
  if (near && getTemplate(tid).palettes.find(p => p.id === near.palette)) ns.palette = near.palette;
  post.slides.splice(current + 1, 0, ns);
  current++;
  changed(true);
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

/* ---------- slides links ---------- */

const ICON = {
  grip: '<svg viewBox="0 0 10 16" aria-hidden="true"><circle cx="2.5" cy="2.5" r="1.3"/><circle cx="7.5" cy="2.5" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13.5" r="1.3"/><circle cx="7.5" cy="13.5" r="1.3"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11"/><path d="M5 15V4h11"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>'
};
const svgEl = html => { const t = document.createElement('template'); t.innerHTML = html; return t.content.firstChild; };

function iconBtn(label, icon, fn, disabled) {
  return el('button', { class: 'icon-btn small', title: label, 'aria-label': label, disabled: !!disabled, onclick: e => { e.stopPropagation(); fn(); } }, svgEl(icon));
}

function selectSlide(i) {
  if (playing) stop();
  current = i;
  refreshAll();
}

function duplicateSlide(i) {
  if (post.slides.length >= MAX_SLIDES) return;
  const src = post.slides[i];
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  for (const [k, m] of Object.entries(src.media)) if (m) { copy.media[k].src = m.src; if (m.blob) copy.media[k].blob = m.blob; }
  post.slides.splice(i + 1, 0, copy);
  current = i + 1;
  changed(true);
}

function removeSlide(i) {
  if (post.slides.length < 2) return;
  post.slides.splice(i, 1);
  current = Math.max(0, Math.min(current, post.slides.length - 1));
  changed(true);
  toast('Slide verwijderd. Met ⌘Z zet je hem terug.');
}

function renderSlideList() {
  const list = $('#slide-list');
  list.innerHTML = '';
  const multi = post.format === 'carousel';
  const size = sizeOf(post.format);
  post.slides.forEach((s, i) => {
    const c = el('canvas', { width: 112, height: Math.round(112 * size.h / size.w) });
    const item = el('div', { class: 'slide-item' + (i === current ? ' on' : ''), role: 'button', tabindex: '0', 'data-i': i, draggable: multi ? 'true' : null,
      'aria-label': `Slide ${i + 1}: ${getTemplate(s.template).name}`,
      onclick: () => selectSlide(i),
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSlide(i); } } },
      multi ? el('span', { class: 'grip' }, svgEl(ICON.grip)) : null,
      c,
      el('span', { class: 'txt' },
        el('small', {}, multi ? `Slide ${i + 1}` : `${FORMATS[post.format].name} · ${FORMATS[post.format].ratio}`),
        el('span', {}, getTemplate(s.template).name),
        slideHasVideo(s) ? el('em', {}, 'VIDEO') : null),
      multi ? el('span', { class: 'acts' },
        iconBtn('Dupliceer slide', ICON.copy, () => duplicateSlide(i), post.slides.length >= MAX_SLIDES),
        iconBtn('Verwijder slide', ICON.trash, () => removeSlide(i), post.slides.length < 2)) : null);
    renderThumb(c, s, post.format);
    list.append(item);
  });
  $('#slides-count').textContent = multi ? `${post.slides.length} van max. ${MAX_SLIDES}` : '';
  $('#btn-add-slide').style.display = multi && post.slides.length < MAX_SLIDES ? '' : 'none';
  $('#slides-hint').textContent = multi
    ? (post.slides.length > 1 ? 'Sleep slides om de volgorde te wijzigen.' : 'Voeg slides toe om er een reeks van te maken.')
    : `Een ${FORMATS[post.format].name.toLowerCase()} heeft één beeld. Kies onder Post het formaat Carrousel voor meerdere slides.`;
}

/* slepen om de volgorde te wijzigen */
const DT_SLIDE = 'text/x-skymark-slide';

function bindListDrop() {
  const list = $('#slide-list');
  let from = null;
  const clear = () => list.querySelectorAll('.drop-before,.drop-after,.dragging').forEach(n => n.classList.remove('drop-before', 'drop-after', 'dragging'));
  const targetOf = e => {
    const items = [...list.querySelectorAll('.slide-item')];
    for (let k = 0; k < items.length; k++) {
      const r = items[k].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return { index: k, node: items[k], before: true };
    }
    return { index: items.length, node: items[items.length - 1], before: false };
  };
  list.addEventListener('dragstart', e => {
    const it = e.target.closest('.slide-item');
    if (!it) return;
    from = +it.dataset.i;
    e.dataTransfer.setData(DT_SLIDE, String(from));
    e.dataTransfer.effectAllowed = 'move';
    it.classList.add('dragging');
  });
  list.addEventListener('dragover', e => {
    if (from == null) return;
    e.preventDefault();
    const t = targetOf(e);
    list.querySelectorAll('.drop-before,.drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    if (t.node) t.node.classList.add(t.before ? 'drop-before' : 'drop-after');
  });
  list.addEventListener('dragend', () => { clear(); from = null; });
  list.addEventListener('drop', e => {
    e.preventDefault();
    if (from == null) return;
    const t = targetOf(e);
    clear();
    const f = from;
    from = null;
    let to = t.index;
    if (to > f) to--;
    if (to === f) return;
    if (playing) stop();
    const [s] = post.slides.splice(f, 1);
    post.slides.splice(to, 0, s);
    current = to;
    changed(true);
  });
}

let tplTimer = null;
function refreshTemplateThumbs() {
  clearTimeout(tplTimer);
  tplTimer = setTimeout(() => {
    renderSlideList();
    if ($('#m-tpl').classList.contains('show')) renderPicker();
  }, 150);
}

let thumbTimer = null;
function updateThumbs() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    const c = document.querySelector('.slide-item.on canvas');
    if (c) renderThumb(c, slide(), post.format);
  }, 250);
}

/* ---------- rechts: inspector met de tabs Design en Post ---------- */

let itab = 'design';

function renderInspector() {
  document.querySelectorAll('.itabs button').forEach(b => {
    b.classList.toggle('on', b.dataset.t === itab);
    b.setAttribute('aria-selected', b.dataset.t === itab ? 'true' : 'false');
  });
  const box = $('#inspector');
  box.innerHTML = '';
  if (itab === 'post') renderPostTab(box);
  else renderDesignTab(box);
}

const luminance = hex => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

function renderDesignTab(box) {
  const s = slide();
  const tpl = getTemplate(s.template);
  const where = post.format === 'carousel' ? `Slide ${current + 1} van ${post.slides.length}` : `${FORMATS[post.format].name} · ${FORMATS[post.format].ratio}`;

  box.append(el('div', { class: 'sec' }, el('div', { class: 'tpl-head' },
    el('div', {}, el('p', { class: 'eyebrow', style: 'margin:0' }, where + ' · Template'), el('p', { class: 'tpl-title' }, tpl.name)),
    el('button', { class: 'btn', onclick: () => openPicker('swap') }, 'Wissel'))));

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
      el('button', { class: 'btn', onclick: () => openPhotos(slot.key) }, 'Kies uit fotoselectie'),
      el('button', { class: 'btn quiet', onclick: () => pickFile(slot.key) }, 'Eigen foto of video')
    )));

    if (m && m.missing) msec.append(el('p', { class: 'missing' }, `“${m.ref.name}” is niet online bewaard. Kies het bestand opnieuw.`));

    if (m && m.src) {
      const zoom = el('input', { type: 'range', min: 100, max: 300, step: 1, 'data-zoom': slot.key });
      zoom.value = Math.round((m.zoom || 1) * 100);
      const zl = el('span', {}, zoom.value + '%');
      const sync = () => { zl.textContent = zoom.value + '%'; };
      zoom.addEventListener('sync', sync);
      zoom.addEventListener('input', () => { m.zoom = zoom.value / 100; sync(); if (!playing) draw(); changed(false); });
      msec.append(el('div', { class: 'range' }, el('label', {}, el('span', {}, 'Zoom'), zl), zoom));

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
          };
          inp.addEventListener('input', () => { upd(); changed(false); });
          outp.addEventListener('input', () => { upd(); changed(false); });
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
      msec.append(el('p', { class: 'muted', style: 'margin:12px 0 0;display:flex;gap:14px;flex-wrap:wrap' },
        el('span', {}, 'Sleep in het voorbeeld om te verschuiven.'),
        el('button', { class: 'link', onclick: () => { m.zoom = 1; m.pos = { x: 0, y: 0 }; changed(true); } }, 'Centreren'),
        el('button', { class: 'link', onclick: () => { delete s.media[slot.key]; changed(true); } }, 'Beeld verwijderen')));
    }
    box.append(msec);
  }

  /* kleur */
  const onPhoto = tpl.palettes.some(p => p.swatch);
  const csec = el('div', { class: 'sec' }, el('div', { class: 'sec-head' },
    el('h4', { class: 'eyebrow' }, onPhoto ? 'Tekstkleur' : 'Kleur'),
    el('span', { class: 'sw-name' }, paletteOf(tpl, s.palette).name)));
  const swBtn = p => {
    const bg = COLORS[p.swatch ? p.swatch : p.bg].hex;
    const dot = COLORS[p.swatch ? p.swatch : p.head].hex;
    const i = el('i', { style: `background:${p.swatch ? 'repeating-conic-gradient(#3a3f3a 0 25%,#2b2f2b 0 50%) 0 0/14px 14px' : bg}` }, el('u', { style: `background:${p.swatch ? bg : dot}` }));
    return el('button', { class: 'sw' + (paletteOf(tpl, s.palette).id === p.id ? ' on' : ''), title: p.name, 'aria-label': p.name, onclick: () => { s.palette = p.id; changed(true); } }, i);
  };
  if (onPhoto) {
    const g = el('div', { class: 'swatches' });
    tpl.palettes.forEach(p => g.append(swBtn(p)));
    csec.append(g);
  } else {
    for (const [label, dark] of [['Donker', true], ['Licht', false]]) {
      const ps = tpl.palettes.filter(p => (luminance(COLORS[p.bg].hex) < 0.3) === dark);
      if (!ps.length) continue;
      const g = el('div', { class: 'swatches' });
      ps.forEach(p => g.append(swBtn(p)));
      csec.append(el('p', { class: 'sw-group' }, label), g);
    }
  }
  box.append(csec);

  /* beweging, alleen bij video */
  if (!isVideo()) return;
  const anim = el('input', { type: 'checkbox' });
  anim.checked = s.animate !== false;
  anim.addEventListener('change', () => { s.animate = anim.checked; changed(false); });
  const animOut = el('input', { type: 'checkbox' });
  animOut.checked = s.animateOut !== false;
  animOut.addEventListener('change', () => { s.animateOut = animOut.checked; changed(false); });
  const bsec = el('div', { class: 'sec' }, el('h4', { class: 'eyebrow' }, 'Beweging'),
    el('label', { class: 'chk' }, anim, 'Tekst en beeld komen rustig binnen'),
    el('label', { class: 'chk', style: 'margin-top:8px' }, animOut, 'Tekst verdwijnt rustig aan het eind'));
  if (!slideHasVideo(s)) {
    const d = el('input', { type: 'range', min: 3, max: 20, step: 1 });
    d.value = s.duration || 6;
    const dl = el('span', {}, d.value + ' s');
    d.addEventListener('input', () => { s.duration = +d.value; dl.textContent = d.value + ' s'; changed(false); });
    bsec.append(el('div', { class: 'range' }, el('label', {}, el('span', {}, 'Duur'), dl), d));
  }
  box.append(bsec);
}

function renderPostTab(box) {
  /* formaat */
  const seg = el('div', { class: 'seg' });
  for (const f of Object.values(FORMATS)) {
    seg.append(el('button', { class: f.id === post.format ? 'on' : '', onclick: () => setFormat(f.id) },
      el('b', {}, f.name), el('span', {}, f.id === 'carousel' ? '4:5 · reeks' : f.ratio)));
  }
  box.append(el('div', { class: 'sec' }, el('h4', { class: 'eyebrow' }, 'Formaat'), seg));

  if (isVideo() && post.format === 'carousel') box.append(sequenceSection());

  /* instagram */
  const cap = el('textarea', { rows: 6, id: 'f-caption', placeholder: 'De tekst onder de post op Instagram' });
  cap.value = post.caption || '';
  cap.addEventListener('input', () => { post.caption = cap.value; changed(false); });
  const date = el('input', { type: 'date', id: 'f-date' });
  date.value = post.date || '';
  date.addEventListener('change', () => { post.date = date.value; changed(false); renderTopbar(); });
  box.append(el('div', { class: 'sec' }, el('h4', { class: 'eyebrow' }, 'Instagram'),
    el('div', { class: 'field' }, el('label', { for: 'f-caption' }, 'Bijschrift'), cap),
    el('div', { class: 'field', style: 'margin:0' }, el('label', { for: 'f-date' }, 'Geplande datum'), date)));

  box.append(approvalSection());
}

/* Carrousel als video: losse clips voor Instagram, of één doorlopende video met overgangen. */
function sequenceSection() {
  const sec = el('div', { class: 'sec' }, el('h4', { class: 'eyebrow' }, 'Video'));
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
  slide().media[pickSlot] = { kind, src, blob: f, ref: { type: 'upload', name: f.name }, zoom: 1, pos: { x: 0, y: 0 }, in: 0, out: null, sound: true, overlay: 0 };
  if (kind === 'video' && !isVideo()) {
    post.mode = 'video';
    toast('Video toegevoegd: de post staat nu in videomodus. Terugzetten kan bovenin.');
  }
  changed(true);
});

/* ---------- eigen foto's en video's online bewaren ----------
   Bij Bewaren gaat elk nieuw bestand één keer naar posts/media/<post>/v0/.
   De naam is een hash van de inhoud, dus hetzelfde bestand wordt niet opnieuw geüpload. */

const MAX_SOURCE = 115_000_000;
const MAX_IMAGE = 6_000_000;

async function shrinkImage(file) {
  if (file.size <= MAX_IMAGE) return file;
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 4000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
}

function extOf(blob, kind) {
  const t = blob.type || '';
  if (kind === 'image') return t === 'image/png' ? 'png' : 'jpg';
  return t === 'video/quicktime' ? 'mov' : t === 'video/webm' ? 'webm' : 'mp4';
}

async function storeUploads(onStep) {
  const todo = [];
  for (const s of post.slides) for (const m of Object.values(s.media)) {
    if (m && m.ref && m.ref.type === 'upload' && m.blob && !m.ref.file) {
      if (uploadedBlobs.has(m.blob)) m.ref = Object.assign({}, m.ref, { file: uploadedBlobs.get(m.blob) });
      else todo.push(m);
    }
  }
  let skipped = 0;
  for (let i = 0; i < todo.length; i++) {
    const m = todo[i];
    if (m.ref.file) continue;
    onStep && onStep(i, todo.length);
    const blob = m.kind === 'image' ? await shrinkImage(m.blob) : m.blob;
    if (blob.size > MAX_SOURCE) { skipped++; continue; }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())))
      .slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join('');
    const rel = `${post.id}/v0/u-${hash}.${extOf(blob, m.kind)}`;
    const up = await uploadPreview(rel, blob, m.kind);
    const file = { path: up.path, parts: up.parts, type: m.kind, mime: blob.type || (m.kind === 'image' ? 'image/jpeg' : 'video/mp4') };
    /* hetzelfde bestand kan in meer slides staan */
    uploadedBlobs.set(m.blob, file);
    for (const s of post.slides) for (const mm of Object.values(s.media)) if (mm && mm.blob === m.blob) mm.ref = Object.assign({}, mm.ref, { file });
    remoteCache.set(file.path, Promise.resolve(m.src));
  }
  return { count: todo.length, skipped };
}

const uploadedBlobs = new WeakMap();
const remoteCache = new Map();
function remoteURL(file) {
  if (remoteCache.has(file.path)) return remoteCache.get(file.path);
  const p = (async () => {
    const parts = [];
    for (let i = 0; i < (file.parts || 1); i++) parts.push(await apiBlob({ action: 'media', path: file.parts > 1 ? `${file.path}.p${i}` : file.path }));
    return URL.createObjectURL(new Blob(parts, { type: file.mime || (file.type === 'video' ? 'video/mp4' : 'image/jpeg') }));
  })();
  remoteCache.set(file.path, p);
  p.catch(() => remoteCache.delete(file.path));
  return p;
}

async function resolveRemote(p) {
  const jobs = [];
  for (const s of p.slides) for (const m of Object.values(s.media)) {
    if (!m || !m.remote) continue;
    jobs.push(remoteURL(m.remote).then(u => { m.src = u; delete m.remote; }).catch(() => { m.missing = true; delete m.remote; }));
  }
  await Promise.all(jobs);
}

/* ---------- opslaan ---------- */

function serialize() {
  return {
    id: post.id,
    name: post.name,
    format: post.format,
    mode: post.mode,
    videoExport: post.videoExport,
    transition: post.transition,
    caption: post.caption || '',
    date: post.date || '',
    review: post.review,
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
    caption: data.caption || '',
    date: data.date || '',
    review: reviewOf(data.review && !data.status ? data.review : data),
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
      } else if (m.ref.file) { mm.src = null; mm.remote = m.ref.file; }
      else { mm.src = null; mm.missing = true; }
      ns.media[k] = mm;
    }
    p.slides.push(ns);
  }
  if (!p.slides.length) p.slides.push(newSlide(templatesFor(p.format)[0].id));
  return p;
}

let saveTimer = null;
/* ---------- ongedaan maken ----------
   Elke wijziging loopt via changed(). Snelle reeksen van typen en schuiven
   binnen 0,7 s tellen als één stap; losse handelingen altijd als eigen stap. Beeldbestanden zelf worden niet gekopieerd,
   alleen de verwijzing ernaar. */

const HISTORY_MAX = 50;
const BURST_MS = 700;
let undoStack = [], redoStack = [], stable = null, lastChange = 0;

function cloneState(src, cur) {
  return {
    current: cur,
    post: Object.assign({}, src, {
      transition: src.transition ? Object.assign({}, src.transition) : src.transition,
      slides: src.slides.map(s => Object.assign({}, s, {
        texts: Object.assign({}, s.texts),
        media: Object.fromEntries(Object.entries(s.media).map(([k, m]) => [k, m ? Object.assign({}, m, {
          pos: m.pos ? Object.assign({}, m.pos) : m.pos,
          ref: m.ref ? Object.assign({}, m.ref) : m.ref
        }) : m]))
      }))
    })
  };
}
const snapshot = () => cloneState(post, current);

function resetHistory() {
  undoStack = []; redoStack = []; lastChange = 0;
  stable = snapshot();
  updateUndoUI();
}

function recordHistory(structural) {
  const now = Date.now();
  /* losse handelingen (template, kleur, slide, modus) altijd een eigen stap;
     typen en schuiven binnen 0,7 s samen als één stap */
  if (stable && (structural || now - lastChange > BURST_MS)) {
    undoStack.push(stable);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack = [];
  }
  lastChange = structural ? 0 : now;
  stable = snapshot();
  updateUndoUI();
}

function restoreState(snap) {
  if (playing) stop();
  const s = cloneState(snap.post, snap.current);
  post = Object.assign(s.post, { review: post.review });
  current = Math.max(0, Math.min(s.current, post.slides.length - 1));
  stable = snapshot();
  lastChange = 0;
  markDirty(true);
  updateUndoUI();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restoreState(undoStack.pop());
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restoreState(redoStack.pop());
}

function updateUndoUI() {
  const u = $('#btn-undo'), r = $('#btn-redo');
  if (u) u.disabled = !undoStack.length;
  if (r) r.disabled = !redoStack.length;
}

function changed(structural) {
  recordHistory(structural);
  markDirty(structural);
}

function persistLocal() {
  try { localStorage.setItem(LS_POST, JSON.stringify(Object.assign(serialize(), { unsaved: dirty }))); } catch (e) {}
}

/* niet-bewaarde post uit deze browser, voor "Verder waar je was" in het overzicht */
function localUnsaved() {
  if (dirty) return { name: post.name, live: true };
  try {
    const p = JSON.parse(localStorage.getItem(LS_POST));
    if (p && p.unsaved) return { name: p.name, live: false };
  } catch (e) {}
  return null;
}

function resumeLocal() {
  if (!dirty) {
    try {
      const p = JSON.parse(localStorage.getItem(LS_POST));
      if (p) { post = hydrate(p); current = 0; dirty = true; editSeq++; resetHistory(); setSaveState('dirty'); scheduleAutosave(); resolveRemote(post).then(() => refreshAll()); }
    } catch (e) {}
  }
  setView('make');
  refreshAll();
}

function startNew() {
  const m = $('#m-new');
  $('#new-name').value = '';
  $('#new-date').value = '';
  m.classList.add('show');
  setTimeout(() => $('#new-name').focus(), 50);
}

async function createNew() {
  if (dirty && !(await saveNow()) && !confirm('Je vorige post kon niet bewaard worden. Toch een nieuwe beginnen?')) return;
  if (playing) stop();
  const f = $('#new-fmt button.on').dataset.f;
  post = newPost(f);
  const name = $('#new-name').value.trim();
  if (name) post.name = name;
  post.date = $('#new-date').value || '';
  current = 0;
  itab = 'design';
  dirty = true;
  editSeq++;
  persistLocal();
  resetHistory();
  $('#m-new').classList.remove('show');
  setView('make');
  refreshAll();
  saveNow();
}

function markDirty(structural) {
  dirty = true;
  editSeq++;
  setSaveState('dirty');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistLocal, 400);
  scheduleAutosave();
  if (structural) refreshAll();
  else { updateThumbs(); renderTopbar(); }
}

function author() {
  try { return localStorage.getItem(LS_AUTHOR) || ''; } catch (e) { return ''; }
}

function askAuthor() {
  return new Promise(resolve => {
    const m = $('#m-name');
    const inp = $('#name-input');
    const quick = $('#quick-names');
    quick.innerHTML = '';
    for (const n of ROLE === 'maker' ? ['Ash', 'Celine'] : ['Esmée', 'Camille']) {
      quick.append(el('button', { class: 'chip', onclick: () => { inp.value = n; ok(); } }, n));
    }
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

async function apiBlob(body) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ secret: SECRET }, body)) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.blob();
}

async function api(body) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ secret: SECRET }, body)) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}

/* Automatisch bewaren: 2,5 s na de laatste wijziging, of meteen bij ⌘S,
   bij teruggaan naar het overzicht en voor het aanbieden.
   editSeq voorkomt dat een wijziging tijdens het bewaren als bewaard telt. */

const AUTOSAVE_MS = 2500;
let editSeq = 0;
let saving = null;
let autoTimer = null;

function scheduleAutosave() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => { saveNow(); }, AUTOSAVE_MS);
}

function setSaveState(kind, text) {
  const n = $('#save-state');
  n.className = 'save-state' + (kind === 'ok' ? ' ok' : kind === 'error' ? ' err' : '');
  n.innerHTML = '';
  if (kind === 'ok') n.textContent = 'Alles bewaard';
  else if (kind === 'dirty') n.textContent = 'Niet bewaard';
  else if (kind === 'saving') n.textContent = text || 'Bewaren...';
  else if (kind === 'error') n.append('Bewaren lukte niet · ', el('a', { href: '#', onclick: e => { e.preventDefault(); saveNow(); } }, 'opnieuw proberen'));
  else n.textContent = text || '';
}

async function saveNow() {
  clearTimeout(autoTimer);
  if (saving) await saving.catch(() => {});
  if (!dirty) return true;
  const run = (async () => {
    const seq = editSeq;
    const who = author() || await askAuthor();
    setSaveState('saving');
    try {
      const up = await storeUploads((i, n) => setSaveState('saving', `Beeld ${i + 1} van ${n} uploaden...`));
      const res = await api({ action: 'save', draft: Object.assign(serialize(), { author: who }) });
      post.review = reviewOf(res.draft);
      if (editSeq === seq) dirty = false;
      persistLocal();
      setSaveState(dirty ? 'dirty' : 'ok');
      renderTopbar();
      if (dirty) scheduleAutosave();
      if (up.skipped) toast(`${up.skipped === 1 ? 'Eén video was' : up.skipped + ' video’s waren'} te groot om online te bewaren (max. 115 MB); die kies je bij openen opnieuw.`);
      return true;
    } catch (e) {
      setSaveState('error');
      console.warn('Bewaren lukte niet', e);
      return false;
    }
  })();
  saving = run;
  try { return await run; } finally { if (saving === run) saving = null; }
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
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.m === post.mode));
  $('#playbar').classList.toggle('hide', !isVideo());
  if (!isVideo() && playing) stop();
  const multi = post.format === 'carousel' && post.slides.length > 1;
  $('#pager').style.visibility = multi ? '' : 'hidden';
  $('#pager-label').textContent = multi ? `Slide ${current + 1} van ${post.slides.length}` : '';
  toggleExportMenu(false);
  renderTopbar();
  renderSlideList();
  renderInspector();
  fitStage();
  draw();
}

function renderTopbar() {
  const name = $('#post-name');
  if (document.activeElement !== name) name.value = post.name;
  const r = post.review || reviewOf(null);
  const ms = $('#meta-status');
  ms.innerHTML = '';
  ms.append(statusPill(r.status));
  const parts = [FORMATS[post.format].name];
  if (post.format === 'carousel') parts.push(post.slides.length === 1 ? '1 slide' : `${post.slides.length} slides`);
  if (isVideo()) parts.push('video');
  if (post.date) parts.push('gepland ' + new Date(post.date + 'T12:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }));
  $('#meta-info').textContent = parts.join(' · ');
  const btn = $('#btn-submit');
  const fresh = r.version && !r.editedSinceSubmit && !dirty;
  btn.disabled = !!fresh;
  btn.textContent = fresh ? `Versie ${r.version} aangeboden` : r.version ? `Versie ${r.version + 1} aanbieden` : 'Ter goedkeuring aanbieden';
}

function exportItems() {
  const sz = sizeOf(post.format);
  const dims = `${sz.w} × ${sz.h}`;
  if (post.format !== 'carousel') return isVideo()
    ? [['Video', `MP4 · ${dims} · klaar voor Instagram`, () => doExport('video')]]
    : [['Afbeelding', `JPG of PNG · ${dims}`, () => doExport('image')]];
  const n = post.slides.length;
  if (!isVideo()) return [
    ['Deze slide', `Slide ${current + 1} als JPG of PNG`, () => doExport('image')],
    ['Alle slides', `ZIP met ${n} genummerde afbeeldingen`, exportCarousel]];
  return [
    ['Deze slide als video', `Slide ${current + 1} als MP4`, () => doExport('video')],
    isSequence()
      ? ['Hele carrousel als één video', 'MP4 met overgangen, voor een Reel of story', exportReel]
      : ['Alle slides als video', `ZIP met ${n} MP4’s, voor een carrousel`, exportCarousel]];
}

function toggleExportMenu(show) {
  const m = $('#exp-menu');
  const on = show == null ? !m.classList.contains('show') : show;
  m.innerHTML = '';
  if (on) for (const [t, sub, fn] of exportItems()) {
    m.append(el('button', { role: 'menuitem', onclick: () => { toggleExportMenu(false); fn(); } }, el('b', {}, t), el('small', {}, sub)));
  }
  m.classList.toggle('show', on);
  $('#btn-export').setAttribute('aria-expanded', on ? 'true' : 'false');
}

async function goOverview() {
  if (playing) stop();
  if (dirty) { persistLocal(); await saveNow(); }
  setView('review');
}

function setMode(m) {
  if (m === post.mode) return;
  if (playing) stop();
  post.mode = m;
  changed(true);
}

function bind() {
  $('#post-name').addEventListener('input', e => { post.name = e.target.value; changed(false); });
  $('#play').innerHTML = ICON_PLAY;
  $('#play').addEventListener('click', () => (playing ? stop() : play()));
  $('#safe-toggle').addEventListener('change', fitStage);
  $('#btn-overview').addEventListener('click', goOverview);
  document.querySelectorAll('#new-fmt button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#new-fmt button').forEach(x => x.classList.toggle('on', x === b));
  }));
  $('#new-ok').addEventListener('click', createNew);
  $('#new-name').addEventListener('keydown', e => { if (e.key === 'Enter') createNew(); });
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  document.querySelectorAll('#mode button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.m)));
  document.querySelectorAll('.itabs button').forEach(b => b.addEventListener('click', () => { itab = b.dataset.t; renderInspector(); }));
  $('#btn-add-slide').addEventListener('click', () => openPicker('add'));
  $('#btn-prev').addEventListener('click', () => selectSlide((current - 1 + post.slides.length) % post.slides.length));
  $('#btn-next').addEventListener('click', () => selectSlide((current + 1) % post.slides.length));
  $('#btn-export').addEventListener('click', e => {
    e.stopPropagation();
    const items = exportItems();
    if (items.length === 1) { toggleExportMenu(false); items[0][2](); } else toggleExportMenu();
  });
  document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) toggleExportMenu(false); });
  $('#btn-submit').addEventListener('click', openSubmit);
  $('#submit-ok').addEventListener('click', () => { $('#m-submit').classList.remove('show'); submitForApproval($('#submit-note').value); });
  new ResizeObserver(() => fitStage()).observe($('#stage-wrap'));
  bindListDrop();
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.modal').classList.remove('show')));
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m && m.id !== 'm-export' && m.id !== 'm-name') m.classList.remove('show'); }));
  document.addEventListener('keydown', e => {
    const inEditor = !document.body.classList.contains('view-review');
    if (e.key === 'Escape') { toggleExportMenu(false); document.querySelectorAll('.modal.show').forEach(m => { if (m.id !== 'm-export') m.classList.remove('show'); }); }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && inEditor) { e.preventDefault(); saveNow(); return; }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key.toLowerCase() === 'z' || (e.key.toLowerCase() === 'y' && e.ctrlKey))) {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      const elsewhere = !inEditor || document.querySelector('.modal.show');
      if (!typing && !elsewhere) {
        e.preventDefault();
        (e.shiftKey || e.key.toLowerCase() === 'y') ? redo() : undo();
      }
    }
    if (e.key === ' ' && isVideo() && inEditor && !/INPUT|TEXTAREA|BUTTON/.test(document.activeElement.tagName) && !document.activeElement.closest('.slide-item')) { e.preventDefault(); playing ? stop() : play(); }
  });
  window.addEventListener('resize', fitStage);
  window.addEventListener('beforeunload', e => { if (dirty || saving) { persistLocal(); e.preventDefault(); e.returnValue = ''; } });
}

/* ---------- goedkeuring vanuit de editor ---------- */

function reviewOf(d) {
  return {
    status: d && STATUS[d.status] ? d.status : 'concept',
    version: d && d.version || 0,
    thread: d && Array.isArray(d.thread) ? d.thread : [],
    editedSinceSubmit: !!(d && d.editedSinceSubmit),
    submitted: d && d.submitted || null
  };
}

async function openDraft(id) {
  if (dirty && !(await saveNow()) && !confirm('Je huidige post kon niet bewaard worden. Toch deze post openen?')) return false;
  const { draft } = await api({ action: 'get', id });
  if (playing) stop();
  const p = hydrate(draft);
  setSaveState('saving', 'Beelden laden...');
  await resolveRemote(p);
  post = p; current = 0; dirty = false; itab = 'design';
  persistLocal();
  resetHistory();
  setView('make');
  refreshAll();
  setSaveState('ok');
  return true;
}

function setView(v) {
  document.body.classList.toggle('view-review', v === 'review');
  if (v === 'review') { if (playing) stop(); refreshReview(); }
  else fitStage();
}

function approvalSection() {
  const r = post.review || reviewOf(null);
  const sec = el('div', { class: 'sec' }, el('h4', { class: 'eyebrow' }, 'Goedkeuring'));
  const st = el('div', { class: 'post-status' }, statusPill(r.status));
  if (r.version) st.append(el('small', { class: 'muted' }, `Versie ${r.version} aangeboden${r.submitted ? ' door ' + r.submitted.by : ''}`));
  if (r.version && (r.editedSinceSubmit || dirty)) st.append(el('small', { class: 'rv-open' }, 'Aangepast sinds de laatste versie. Bied opnieuw aan als het klaar is.'));

  const open = r.thread.filter(t => t.role === 'approver' && (t.type === 'changes' || t.type === 'comment') && !t.resolved);
  if (open.length) st.append(el('p', { class: 'muted', style: 'margin:8px 0 0' }, 'Open feedback'));
  for (const t of open) {
    const cb = el('input', { type: 'checkbox' });
    cb.addEventListener('change', async () => {
      try {
        const res = await api({ action: 'review', id: post.id, kind: 'resolve', commentId: t.id, by: author() || 'Maker' });
        post.review = reviewOf(res.draft);
        renderInspector();
      } catch (e) { toast('Dat lukte niet: ' + e.message); cb.checked = false; }
    });
    st.append(el('div', { class: 'fb-item' },
      el('small', {}, `${t.by}${t.slide != null ? ' · slide ' + (t.slide + 1) : ''}${t.version !== r.version ? ' · versie ' + t.version : ''}`),
      t.text,
      el('label', { class: 'chk', style: 'margin-top:6px;font-size:12px;color:var(--stone)' }, cb, 'Verwerkt')));
  }
  st.append(el('p', { class: 'muted', style: 'margin:8px 0 0' }, 'Aanbieden doe je met de gouden knop rechtsboven.'));
  if (r.version) st.append(el('a', { href: '#', style: 'color:var(--gold);font-size:12.5px', onclick: e => { e.preventDefault(); goOverview(); } }, 'Bekijk in het overzicht'));
  sec.append(st);
  return sec;
}

function openSubmit() {
  const r = post.review || reviewOf(null);
  $('#submit-title').textContent = r.version ? `Versie ${r.version + 1} aanbieden` : 'Ter goedkeuring aanbieden';
  const missing = post.slides.some(s => Object.values(s.media).some(m => m && m.missing)) || post.slides.some(s => getTemplate(s.template).media.some(m => !s.media[m.key] || !s.media[m.key].src));
  $('#submit-warn').textContent = missing ? 'Let op: niet elk beeldvak is gevuld. Lege vakken worden een effen vlak.' : '';
  $('#submit-note').value = '';
  $('#m-submit').classList.add('show');
  setTimeout(() => $('#submit-note').focus(), 50);
}

function blobToB64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

const PART = 2_900_000;
async function uploadPreview(rel, blob, type) {
  const parts = Math.max(1, Math.ceil(blob.size / PART));
  let path = null;
  for (let i = 0; i < parts; i++) {
    const chunk = blob.slice(i * PART, (i + 1) * PART);
    const r = await api({ action: 'upload', path: parts > 1 ? `${rel}.p${i}` : rel, b64: await blobToB64(chunk) });
    path = r.path.replace(/\.p\d+$/, '');
  }
  return { path, parts, type };
}

async function submitForApproval(note) {
  if (playing) stop();
  clearTimeout(autoTimer);
  if (saving) await saving.catch(() => {});
  if (isVideo() && !videoSupported()) { toast('Video-previews maken werkt in Chrome, Edge of Safari 17+.'); return; }
  const who = author() || await askAuthor();
  const ui = exportModal('Ter goedkeuring aanbieden');
  try {
    ui.set('Post bewaren', 0.02);
    await storeUploads((i, n) => ui.set(`Beeld ${i + 1} van ${n} uploaden`, 0.02));
    const saved = await api({ action: 'save', draft: Object.assign(serialize(), { author: who }) });
    post.review = reviewOf(saved.draft);
    dirty = false;
    persistLocal();
    setSaveState('ok');
    const version = post.review.version + 1;
    const base = `${post.id}/v${version}`;
    const n = post.slides.length;
    const previews = [];
    let sequence = null;
    for (let i = 0; i < n; i++) {
      const s = post.slides[i];
      ui.set(`Preview slide ${i + 1} van ${n}`, 0.05 + 0.85 * i / n);
      const img = await exportImage(s, post.format, getMedia, { preview: true });
      const still = await uploadPreview(`${base}/s${i + 1}.jpg`, img.blob, 'image');
      let video = null;
      if (isVideo() && !isSequence()) {
        const v = await exportVideo(s, post.format, getMedia, p => ui.set(`Video slide ${i + 1} van ${n}: ${Math.round(p * 100)}%`, 0.05 + 0.85 * (i + p * 0.9) / n), { preview: true });
        ui.set(`Video slide ${i + 1} uploaden`, null);
        video = await uploadPreview(`${base}/s${i + 1}.mp4`, v.blob, 'video');
      }
      previews.push({ slide: i, still, video });
    }
    if (isSequence()) {
      const v = await exportSequence(post.slides, post.format, getMedia, post.transition, p => ui.set(`Doorlopende video: ${Math.round(p * 100)}%`, 0.5 + 0.4 * p), { preview: true });
      ui.set('Video uploaden', 0.92);
      sequence = await uploadPreview(`${base}/reeks.mp4`, v.blob, 'video');
    }
    ui.set('Aanbieden', 0.97);
    const res = await api({ action: 'submit', id: post.id, version, previews, sequence, by: who, note: (note || '').trim() });
    post.review = reviewOf(res.draft);
    renderInspector();
    renderTopbar();
    toast(`Versie ${version} staat klaar voor Esmée en Camille.`);
  } catch (e) {
    toast('Aanbieden lukte niet: ' + e.message);
  } finally { ui.close(); draw(); }
}

function makerLogin() {
  const m = $('#m-maker');
  const inp = $('#maker-input');
  const err = $('#maker-err');
  inp.value = '';
  err.classList.remove('show');
  m.classList.add('show');
  inp.focus();
  const go = async () => {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: inp.value, action: 'whoami' }) });
      const j = await r.json();
      if (j.role !== 'maker') throw new Error();
      sessionStorage.setItem('skymark_posts_secret', inp.value);
      location.reload();
    } catch (e) { err.textContent = 'Onjuist wachtwoord.'; err.classList.add('show'); inp.value = ''; inp.focus(); }
  };
  $('#maker-ok').onclick = go;
  inp.onkeydown = e => { if (e.key === 'Enter') go(); };
}

/* ---------- live voorbeelden voor de goedkeuringsweergave ---------- */

function waitForMedia(s) {
  return Promise.all(Object.entries(s.media).map(([slot, m]) => new Promise(res => {
    const e = mediaEl(slot, m);
    if (!e) return res();
    setTimeout(res, 8000);
    if (e instanceof HTMLImageElement) {
      if (e.complete && e.naturalWidth) return res();
      e.addEventListener('load', res, { once: true });
      e.addEventListener('error', res, { once: true });
    } else {
      if (e.readyState >= 2) return res();
      e.addEventListener('loadeddata', res, { once: true });
      e.addEventListener('error', res, { once: true });
    }
  })));
}

async function renderLocal(draft, opts = {}) {
  await loadFonts();
  const p = hydrate(draft);
  await resolveRemote(opts.thumb ? { slides: p.slides.slice(0, 1) } : p);
  const size = sizeOf(p.format);
  const urls = [];
  for (const s of opts.thumb ? p.slides.slice(0, 1) : p.slides) {
    await prepareSlide(s, p.format);
    await waitForMedia(s);
    const c = document.createElement('canvas');
    c.width = size.w; c.height = size.h;
    renderSlide(c.getContext('2d'), s, p.format, { t: null, getMedia, placeholders: true });
    let out = c;
    if (opts.thumb) {
      out = document.createElement('canvas');
      out.width = 432; out.height = Math.round(size.h * 432 / size.w);
      const x = out.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(c, 0, 0, out.width, out.height);
    }
    const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.9));
    urls.push(URL.createObjectURL(blob));
  }
  return urls;
}

async function resolveRole() {
  if (!window.__skyAuthed) await new Promise(r => window.addEventListener('skymark-auth', r, { once: true }));
  let s = null;
  try { s = sessionStorage.getItem('skymark_posts_secret'); } catch (e) {}
  if (s) {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: s, action: 'whoami' }) });
      const j = await r.json();
      if (j.role === 'maker') { SECRET = s; ROLE = 'maker'; return; }
    } catch (e) {}
    try { sessionStorage.removeItem('skymark_posts_secret'); } catch (e) {}
  }
  SECRET = PW_VIEW;
  ROLE = 'approver';
}

async function init() {
  await resolveRole();
  initReview({
    role: ROLE, api, apiBlob, toast,
    me: author,
    askName: () => askAuthor(),
    makerLogin,
    openInEditor: id => openDraft(id),
    renderLocal: ROLE === 'maker' ? renderLocal : null,
    newPost: startNew,
    unsaved: localUnsaved,
    resume: resumeLocal
  });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('.modal').classList.remove('show')));
  if (ROLE !== 'maker') {
    /* goedkeurders: alleen de goedkeuringsweergave, geen editor of templates */
    document.body.classList.add('role-approver', 'view-review');
    document.body.classList.remove('booting');
    refreshReview();
    if (!author()) askAuthor().then(refreshReview);
    return;
  }
  document.body.classList.add('role-maker');
  const [, , pj] = await Promise.all([
    loadFonts(),
    loadAssets(),
    fetch('/fotoselectie/pairs.json').then(r => r.json()).catch(() => ({ pairs: [] }))
  ]);
  photos = (pj.pairs || []).filter(p => p.after || p.soft || p.single);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_POST)); } catch (e) {}
  post = saved ? hydrate(saved) : newPost('feed');
  bind();
  resetHistory();
  document.body.classList.remove('booting');
  refreshAll();
  /* makers beginnen in het overzicht */
  setView('review');
  window.__posts = { get post() { return post; }, set post(p) { post = p; resetHistory(); refreshAll(); }, hydrate, refreshAll, getMedia, exportVideo, exportImage, setCurrent: i => { current = i; refreshAll(); } };
}

init();
