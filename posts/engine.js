/* Skymark posttool: tekenmotor.
   Eén renderer voor voorbeeld én export, zodat wat je ziet exact is wat je
   exporteert. Alles wordt op ware grootte (1080 breed) op een canvas getekend. */

import { COLORS, FORMATS, getTemplate } from './templates.js';

const BASE = new URL('./', import.meta.url).href;

export const FONTS = {
  'talisman-light':      { family: 'SkyTalisman', weight: 300, file: 'talisman-light.woff2', asc: 2160 / 2048, desc: 460 / 2048 },
  'talisman-compressed': { family: 'SkyTalismanCompressed', weight: 500, file: 'talisman-compressed.woff2', asc: 2160 / 2048, desc: 460 / 2048 },
  'mori-book':           { family: 'SkyMori', weight: 400, file: 'mori-book.woff2', asc: 1, desc: 0.3 },
  'mori-semibold':       { family: 'SkyMori', weight: 600, file: 'mori-semibold.woff2', asc: 1, desc: 0.3 }
};

let fontsReady = null;
export function loadFonts() {
  if (fontsReady) return fontsReady;
  fontsReady = Promise.all(Object.values(FONTS).map(async f => {
    const face = new FontFace(f.family, `url(${BASE}assets/${f.file})`, { weight: String(f.weight), style: 'normal' });
    await face.load();
    document.fonts.add(face);
  }));
  return fontsReady;
}

/* ---------- merkvormen ---------- */

const svgSrc = {};
const svgImg = new Map();

export async function loadAssets() {
  await Promise.all(['wordmark', 'kroon', 'kader', 'kroonbogen', 'stippenovaal'].map(async name => {
    const r = await fetch(`${BASE}assets/${name}.svg`);
    svgSrc[name] = await r.text();
  }));
}

function svgImage(name, hex) {
  const key = name + hex;
  if (svgImg.has(key)) return svgImg.get(key);
  const img = new Image();
  const svg = svgSrc[name].replace(/currentColor/g, hex);
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const entry = { img, ready: img.decode().then(() => true, () => false) };
  svgImg.set(key, entry);
  return entry;
}

/* Wacht tot alle merkvormen van een slide klaarstaan (voor export). */
export async function prepareSlide(slide, formatId) {
  const { layers, roles } = resolve(slide, formatId);
  await Promise.all(layers.filter(l => l.t === 'svg').map(l => svgImage(l.asset, roles[l.color]).ready));
}

/* ---------- helpers ---------- */

export function sizeOf(formatId) {
  const f = FORMATS[formatId];
  return FORMATS[f.slidesOf || formatId];
}

export function paletteOf(tpl, id) {
  return tpl.palettes.find(p => p.id === id) || tpl.palettes[0];
}

function resolve(slide, formatId) {
  const tpl = getTemplate(slide.template);
  const fmt = FORMATS[formatId].slidesOf || formatId;
  const layers = tpl.layouts[fmt] || tpl.layouts.feed;
  const p = paletteOf(tpl, slide.palette);
  const roles = {};
  for (const r of ['bg', 'head', 'body', 'label', 'mark', 'logo']) roles[r] = COLORS[p[r]].hex;
  return { tpl, layers, roles };
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

const clamp01 = x => Math.min(1, Math.max(0, x));
const easeOut = x => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = x => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

/* Timing van de animaties, in seconden. */
export const ANIM = { inStart: 0.3, inStagger: 0.16, inDur: 0.9, outDur: 0.7, outStagger: 0.08, outEnd: 0.1 };

/* ---------- tekst ---------- */

const hasLS = typeof CanvasRenderingContext2D !== 'undefined' && 'letterSpacing' in CanvasRenderingContext2D.prototype;

function setFont(ctx, spec, size) {
  const f = FONTS[spec.font];
  ctx.font = `${f.weight} ${size}px ${f.family}`;
  if (hasLS) ctx.letterSpacing = `${(spec.ls || 0) * size}px`;
}

function measure(ctx, str, spec, size) {
  if (hasLS) return ctx.measureText(str).width - (str.length ? (spec.ls || 0) * size : 0);
  let w = 0;
  for (const ch of str) w += ctx.measureText(ch).width + (spec.ls || 0) * size;
  return w - (str.length ? (spec.ls || 0) * size : 0);
}

function wrap(ctx, text, spec, size, maxW) {
  const lines = [];
  for (const para of text.split('\n')) {
    if (spec.nowrap) { lines.push(para); continue; }
    const words = para.split(/ +/);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (line && measure(ctx, test, spec, size) > maxW) { lines.push(line); line = w; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}

/* Zet tekst en laat hem krimpen tot hij in het kader past. */
export function layoutText(ctx, spec, raw) {
  let text = spec.upper ? raw.toLocaleUpperCase('nl-NL') : raw;
  text = text.replace(/\r/g, '');
  /* Een kader van één regel hoog breekt niet af maar krimpt in de breedte. */
  const single = !!spec.h && spec.h < spec.size * spec.lh * 1.5;
  if (single) text = text.replace(/\n+/g, ' ');
  const wspec = single ? Object.assign({}, spec, { nowrap: true }) : spec;
  const min = spec.min || (single ? Math.round(spec.size * 0.7) : spec.size);
  let size = spec.size;
  let lines, lineH, widest, fitsH, fitsW;
  for (;;) {
    setFont(ctx, spec, size);
    lines = wrap(ctx, text, wspec, size, spec.w);
    lineH = size * spec.lh;
    widest = Math.max(...lines.map(l => measure(ctx, l, spec, size)));
    fitsH = single || !spec.h || lines.length * lineH <= spec.h + 0.5;
    fitsW = widest <= spec.w + 0.5;
    if ((fitsH && fitsW) || size <= min) break;
    size = Math.max(min, size - Math.max(1, Math.round(size * 0.03)));
  }
  return { size, lines, lineH, overflow: !(fitsH && fitsW) };
}

function drawLine(ctx, str, x, y, spec, size) {
  if (hasLS || !spec.ls) { ctx.fillText(str, x, y); return; }
  for (const ch of str) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + spec.ls * size;
  }
}

function drawText(ctx, spec, raw, color) {
  const lay = layoutText(ctx, spec, raw);
  const f = FONTS[spec.font];
  const blockH = lay.lines.length * lay.lineH;
  let y0 = spec.y;
  if (spec.valign === 'middle') y0 = spec.y + (spec.h - blockH) / 2;
  else if (spec.valign === 'bottom') y0 = spec.y + spec.h - blockH;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  const content = (f.asc + f.desc) * lay.size;
  lay.lines.forEach((line, i) => {
    const w = measure(ctx, line, spec, lay.size);
    let x = spec.x;
    if (spec.align === 'center') x = spec.x + (spec.w - w) / 2;
    else if (spec.align === 'right') x = spec.x + spec.w - w;
    const base = y0 + i * lay.lineH + (lay.lineH - content) / 2 + f.asc * lay.size;
    drawLine(ctx, line, x, base, spec, lay.size);
  });
  return lay;
}

/* ---------- media ---------- */

/* Rekent uit waar het beeld in het kader valt (cover + zoom + verschuiving). */
export function mediaRect(box, natW, natH, m, extraScale = 1) {
  const cover = Math.max(box.w / natW, box.h / natH);
  const s = cover * (m.zoom || 1) * extraScale;
  const dw = natW * s, dh = natH * s;
  const ox = dw - box.w, oy = dh - box.h;
  const px = m.pos ? m.pos.x : 0, py = m.pos ? m.pos.y : 0;
  return { x: box.x - ox * (px + 1) / 2, y: box.y - oy * (py + 1) / 2, w: dw, h: dh, ox, oy };
}

function natSize(el) {
  if (!el) return null;
  if (el instanceof HTMLVideoElement) return el.videoWidth ? [el.videoWidth, el.videoHeight] : null;
  if (el instanceof HTMLImageElement) return el.naturalWidth ? [el.naturalWidth, el.naturalHeight] : null;
  if (el.width) return [el.width, el.height];
  return null;
}

function drawPlaceholder(ctx, box, label) {
  ctx.fillStyle = COLORS['concrete-moss'].hex;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  const spec = { font: 'mori-semibold', size: 20, ls: 0.18 };
  setFont(ctx, spec, 20);
  ctx.fillStyle = COLORS['mist-green'].hex;
  ctx.globalAlpha *= 0.75;
  const s = label.toLocaleUpperCase('nl-NL');
  const w = measure(ctx, s, spec, 20);
  ctx.textBaseline = 'middle';
  drawLine(ctx, s, box.x + (box.w - w) / 2, box.y + box.h / 2, spec, 20);
}

/* ---------- render ---------- */

/* Tekent een slide.
   opts.t: tijd in seconden voor animatie, null = eindstand
   opts.duration: totale duur van de clip (voor de langzame zoom)
   opts.getMedia(slot): geeft het <img>/<video>-element voor een slot
   opts.placeholders: lege kaders tonen (alleen in de editor) */
export function renderSlide(ctx, slide, formatId, opts = {}) {
  const { layers, roles } = resolve(slide, formatId);
  const size = sizeOf(formatId);
  const t = opts.t;
  const animate = slide.animate !== false && t != null;
  const animOut = slide.animateOut !== false && t != null;
  const dur = opts.duration || 6;
  const nAnim = layers.filter(l => !['fill', 'gradient', 'media'].includes(l.t)).length;
  const report = { overflow: [] };

  ctx.save();
  ctx.clearRect(0, 0, size.w, size.h);
  let order = 0;

  for (const L of layers) {
    ctx.save();
    if (L.t === 'fill') {
      ctx.fillStyle = roles[L.color];
      ctx.fillRect(0, 0, size.w, size.h);
    } else if (L.t === 'gradient') {
      const g = ctx.createLinearGradient(0, L.y, 0, L.y + L.h);
      g.addColorStop(0, hexA(roles[L.color], L.from));
      g.addColorStop(1, hexA(roles[L.color], L.to));
      ctx.fillStyle = g;
      ctx.fillRect(L.x, L.y, L.w, L.h);
    } else if (L.t === 'media') {
      const m = (slide.media || {})[L.slot] || {};
      const el = opts.getMedia ? opts.getMedia(L.slot, m) : null;
      const nat = natSize(el);
      ctx.beginPath();
      ctx.rect(L.x, L.y, L.w, L.h);
      ctx.clip();
      if (nat) {
        const zoom = animate ? 1 + 0.06 * (1 - easeOut(t / dur)) : 1;
        const r = mediaRect(L, nat[0], nat[1], m, zoom);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(el, r.x, r.y, r.w, r.h);
        /* overlay in Binck Black, sterkte per beeld instelbaar */
        if (m.overlay > 0) {
          ctx.fillStyle = hexA(COLORS['binck-black'].hex, Math.min(0.85, m.overlay));
          ctx.fillRect(L.x, L.y, L.w, L.h);
        }
      } else if (opts.placeholders !== false) {
        drawPlaceholder(ctx, L, 'Kies een beeld');
      } else {
        ctx.fillStyle = COLORS['concrete-moss'].hex;
        ctx.fillRect(L.x, L.y, L.w, L.h);
      }
    } else {
      if (animate || animOut) {
        let a = 1, dy = 0;
        if (animate) {
          const p = easeOut((t - (ANIM.inStart + order * ANIM.inStagger)) / ANIM.inDur);
          a *= p; dy += (1 - p) * 26;
        }
        if (animOut) {
          /* uitgang: in dezelfde volgorde, de laatste laag is net voor het einde weg */
          const start = dur - ANIM.outEnd - ANIM.outDur - (nAnim - 1 - order) * ANIM.outStagger;
          const q = easeInOut((t - start) / ANIM.outDur);
          a *= 1 - q; dy -= q * 18;
        }
        ctx.globalAlpha = a;
        ctx.translate(0, dy);
      }
      order++;
      if (L.t === 'text') {
        const raw = L.field ? ((slide.texts || {})[L.field] ?? '') : L.text;
        if (raw) {
          const lay = drawText(ctx, L, raw, roles[L.color]);
          if (lay.overflow && L.field) report.overflow.push(L.field);
        }
      } else if (L.t === 'svg') {
        const e = svgImage(L.asset, roles[L.color]);
        if (e.img.complete && e.img.naturalWidth) ctx.drawImage(e.img, L.x, L.y, L.w, L.h);
        else if (opts.onAssetLoad) e.ready.then(opts.onAssetLoad);
      } else if (L.t === 'pill') {
        const raw = (slide.texts || {})[L.field] ?? '';
        if (raw) {
          const s = L.upper ? raw.toLocaleUpperCase('nl-NL') : raw;
          setFont(ctx, L, L.size);
          const w = measure(ctx, s, L, L.size) + L.padX * 2;
          const r = L.h / 2;
          ctx.strokeStyle = roles[L.color];
          ctx.lineWidth = L.stroke;
          ctx.beginPath();
          ctx.roundRect(L.x + L.stroke / 2, L.y + L.stroke / 2, w - L.stroke, L.h - L.stroke, r);
          ctx.stroke();
          ctx.fillStyle = roles[L.color];
          const f = FONTS[L.font];
          const base = L.y + L.h / 2 + (f.asc - f.desc) * L.size / 2 - 1;
          ctx.textBaseline = 'alphabetic';
          drawLine(ctx, s, L.x + L.padX, base, L, L.size);
        }
      }
    }
    ctx.restore();
  }
  ctx.restore();
  return report;
}

/* Kaders van mediavlakken, voor verschuiven met de muis. */
export function mediaBoxes(slide, formatId) {
  const { layers } = resolve(slide, formatId);
  return layers.filter(l => l.t === 'media');
}

/* Langste animatie-eind, zodat stilstaande posts lang genoeg duren. */
export function introLength(slide, formatId) {
  const { layers } = resolve(slide, formatId);
  const n = layers.filter(l => !['fill', 'gradient', 'media'].includes(l.t)).length;
  return ANIM.inStart + Math.max(0, n - 1) * ANIM.inStagger + ANIM.inDur;
}
