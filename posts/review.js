/* Skymark posttool: goedkeuring.
   Approvers (Esmée, Camille) zien alleen deze weergave. Makers (Ash, Celine)
   wisselen ertussen en het editor-scherm. Wat hier getoond wordt zijn de
   previews van de aangeboden versie, niet de live concepten. */

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

export const STATUS = {
  concept: { label: 'Concept', cls: 'st-concept' },
  review: { label: 'Wacht op goedkeuring', cls: 'st-review' },
  changes: { label: 'Feedback: aanpassen', cls: 'st-changes' },
  approved: { label: 'Goedgekeurd', cls: 'st-approved' }
};
const FORMAT = { feed: 'Feed 4:5', story: 'Story 9:16', carousel: 'Carrousel 4:5' };

const when = ts => new Date(ts).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const day = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'long' }) : '';

export function statusPill(status) {
  const s = STATUS[status] || STATUS.concept;
  return el('span', { class: 'pill ' + s.cls }, s.label);
}

let ctx = null;
let drafts = [];
let tab = null;
const mediaCache = new Map();

/* ctx: { role, api, apiBlob, me, askName, toast, openInEditor, backToEditor } */
export function initReview(c) {
  ctx = c;
  document.querySelectorAll('#m-rv [data-close], #m-rv').forEach(n => n.addEventListener('click', e => {
    if (e.target === n) closeDetail();
  }));
  document.addEventListener('keydown', e => {
    if (!$('#m-rv').classList.contains('show')) return;
    if (e.key === 'Escape') closeDetail();
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
}

function tabsFor(role) {
  const t = [
    { id: 'review', label: role === 'maker' ? 'Ter goedkeuring' : 'Te beoordelen', test: d => d.status === 'review' },
    { id: 'changes', label: role === 'maker' ? 'Feedback verwerken' : 'Feedback gegeven', test: d => d.status === 'changes' },
    { id: 'approved', label: 'Goedgekeurd', test: d => d.status === 'approved' }
  ];
  if (role === 'maker') t.unshift({ id: 'concept', label: 'Concepten', test: d => d.status === 'concept' });
  return t;
}

export async function refreshReview() {
  const grid = $('#rv-grid');
  grid.innerHTML = '';
  grid.append(el('p', { class: 'muted' }, 'Laden...'));
  renderWho();
  try {
    const r = await ctx.api({ action: 'list' });
    drafts = r.drafts;
  } catch (e) {
    grid.innerHTML = '';
    grid.append(el('p', { class: 'muted' }, 'Laden lukte niet: ' + e.message));
    return;
  }
  const tabs = tabsFor(ctx.role);
  if (!tab || !tabs.find(t => t.id === tab)) {
    const pref = ctx.role === 'maker' ? ['changes', 'review', 'concept'] : ['review', 'changes', 'approved'];
    tab = pref.find(id => drafts.some(tabs.find(t => t.id === id).test)) || pref[0];
  }
  renderTabs(tabs);
  renderGrid(tabs.find(t => t.id === tab));
  /* link uit een mail: #post=<id> opent die post direct */
  const m = location.hash.match(/post=([\w-]+)/);
  if (m && !$('#m-rv').classList.contains('show')) {
    history.replaceState(null, '', location.pathname);
    openDetail(m[1]);
  }
}

function renderWho() {
  const who = $('#rv-who');
  who.innerHTML = '';
  const me = ctx.me();
  if (ctx.role === 'maker') {
    who.append(
      el('a', { href: '#', onclick: async e => {
        e.preventDefault();
        try {
          const r = await ctx.api({ action: 'mailtest' });
          ctx.toast(r.ok ? 'Testmail verstuurd naar ash@connectingthepolkadots.com.' : 'Testmail lukte niet: ' + r.mail);
        } catch (err) { ctx.toast('Testmail lukte niet: ' + err.message); }
      } }, 'Testmail sturen'),
      el('button', { class: 'btn', style: 'margin-left:10px', onclick: ctx.backToEditor }, 'Naar maken')
    );
  } else {
    who.append(
      el('span', { class: 'muted' }, me ? `Je reageert als ${me} · ` : ''),
      el('a', { href: '#', onclick: e => { e.preventDefault(); ctx.askName(true).then(renderWho); } }, me ? 'wijzig naam' : 'Vul je naam in'),
      el('span', { class: 'muted' }, ' · '),
      el('a', { href: '#', onclick: e => { e.preventDefault(); ctx.makerLogin(); } }, 'Inloggen als maker')
    );
  }
}

function renderTabs(tabs) {
  const box = $('#rv-tabs');
  box.innerHTML = '';
  for (const t of tabs) {
    const n = drafts.filter(t.test).length;
    box.append(el('button', { class: t.id === tab ? 'on' : '', onclick: () => { tab = t.id; renderTabs(tabs); renderGrid(t); } }, t.label, el('b', {}, String(n))));
  }
}

function renderGrid(t) {
  const grid = $('#rv-grid');
  grid.innerHTML = '';
  const list = drafts.filter(t.test);
  if (!list.length) {
    const empty = {
      review: ctx.role === 'maker' ? 'Er staat niets ter goedkeuring.' : 'Er wacht niets op je goedkeuring. Fijn.',
      changes: ctx.role === 'maker' ? 'Geen openstaande feedback.' : 'Nog geen posts met feedback.',
      approved: 'Nog geen goedgekeurde posts.',
      concept: 'Geen concepten.'
    };
    grid.append(el('p', { class: 'muted rv-empty' }, empty[t.id]));
    return;
  }
  for (const d of list) {
    const img = el('div', { class: 'rv-thumb' + (d.format === 'story' ? ' story' : '') });
    if (d.thumb) mediaURL(d.thumb).then(u => { img.style.backgroundImage = `url("${u}")`; }).catch(() => {});
    else if (d.firstSlide && ctx.renderLocal) liveThumb(d).then(u => { img.style.backgroundImage = `url("${u}")`; }).catch(() => {});
    else img.append(el('span', {}, 'Nog niet aangeboden'));
    if (d.count > 1) img.append(el('em', {}, d.count + ' slides'));
    const meta = [FORMAT[d.format], d.mode === 'video' ? 'video' : null, d.date ? 'gepland ' + day(d.date) : null].filter(Boolean).join(' · ');
    const card = el('button', { class: 'rv-card', onclick: () => openDetail(d.id) },
      img,
      el('div', { class: 'rv-card-body' },
        statusPill(d.status),
        el('b', {}, d.name),
        el('small', {}, meta),
        el('small', {}, d.version ? `Versie ${d.version}` + (d.approvals.length ? ` · goedgekeurd door ${d.approvals.map(a => a.by).join(' en ')}` : '') : `Laatst bewaard ${when(d.updated)} door ${d.author || 'onbekend'}`),
        d.openFeedback ? el('small', { class: 'rv-open' }, `${d.openFeedback} open ${d.openFeedback === 1 ? 'punt' : 'punten'}`) : null,
        ctx.role === 'maker' && d.editedSinceSubmit ? el('small', { class: 'rv-open' }, 'Aangepast sinds aanbieden') : null
      ));
    grid.append(card);
  }
}

/* ---------- media ---------- */

/* Concepten zonder previews tekenen we live, met dezelfde motor als de editor. */
const thumbCache = new Map();
function liveThumb(d) {
  const key = d.id + ':' + d.updated;
  if (!thumbCache.has(key)) thumbCache.set(key, ctx.renderLocal({ format: d.format, slides: [d.firstSlide] }, { thumb: true }).then(u => u[0]));
  return thumbCache.get(key);
}

export function mediaURL(file) {
  if (!file) return Promise.reject(new Error('geen bestand'));
  if (mediaCache.has(file.path)) return mediaCache.get(file.path);
  const p = (async () => {
    const parts = [];
    const n = file.parts || 1;
    for (let i = 0; i < n; i++) parts.push(await ctx.apiBlob({ action: 'media', path: n > 1 ? `${file.path}.p${i}` : file.path }));
    const type = /\.mp4/.test(file.path) ? 'video/mp4' : 'image/jpeg';
    return URL.createObjectURL(new Blob(parts, { type }));
  })();
  mediaCache.set(file.path, p);
  p.catch(() => mediaCache.delete(file.path));
  return p;
}

/* ---------- detail ---------- */

let cur = null;
let idx = 0;
let local = null;

async function openDetail(id) {
  $('#m-rv').classList.add('show');
  $('#rv-title').textContent = 'Laden...';
  $('#rv-media').innerHTML = '';
  $('#rv-side').innerHTML = '';
  try {
    const { draft } = await ctx.api({ action: 'get', id });
    cur = draft;
    idx = 0;
    local = null;
    renderDetail();
    if (!draft.submitted && ctx.renderLocal) {
      local = await ctx.renderLocal(draft);
      if (cur === draft) renderDetail();
    }
  } catch (e) {
    $('#rv-title').textContent = 'Openen lukte niet';
    $('#rv-side').append(el('p', { class: 'muted' }, e.message));
  }
}

function closeDetail() {
  $('#m-rv').classList.remove('show');
  $('#rv-media').querySelectorAll('video').forEach(v => v.pause());
  cur = null;
}

function frames() {
  const s = cur.submitted;
  if (!s) return (local || []).map((u, i, a) => ({ localUrl: u, label: a.length > 1 ? `Slide ${i + 1}` : '' }));
  if (s.sequence) return [{ video: s.sequence, still: s.previews[0] && s.previews[0].still, label: 'Doorlopende video' }];
  return s.previews.map((p, i) => ({ ...p, label: s.previews.length > 1 ? `Slide ${i + 1}` : '' }));
}

function step(d) {
  const f = frames();
  if (f.length < 2) return;
  idx = (idx + d + f.length) % f.length;
  renderMedia();
}

function renderMedia() {
  const box = $('#rv-media');
  box.querySelectorAll('video').forEach(v => v.pause());
  box.innerHTML = '';
  const f = frames();
  const fr = f[idx];
  box.classList.toggle('story', cur.format === 'story');
  if (!fr) { box.append(el('p', { class: 'muted' }, cur.submitted ? '' : 'Voorbeeld maken...')); return; }
  if (fr.localUrl) {
    box.append(el('img', { src: fr.localUrl, alt: fr.label || cur.name }));
  } else if (fr.video) {
    const v = el('video', { controls: true, playsinline: true, loop: true, muted: true, autoplay: true, preload: 'auto' });
    v.muted = true;
    if (fr.still) mediaURL(fr.still).then(u => { v.poster = u; }).catch(() => {});
    mediaURL(fr.video).then(u => { v.src = u; v.play().catch(() => {}); }).catch(() => box.append(el('p', { class: 'muted' }, 'Video laden lukte niet.')));
    box.append(v);
  } else {
    const img = el('img', { alt: fr.label || cur.name });
    mediaURL(fr.still).then(u => { img.src = u; }).catch(() => {});
    box.append(img);
  }
  $('#rv-count').textContent = f.length > 1 ? `${idx + 1} / ${f.length}` : (fr.video ? 'Video' : '');
  $('#rv-prev').style.visibility = f.length > 1 ? '' : 'hidden';
  $('#rv-next').style.visibility = f.length > 1 ? '' : 'hidden';
  const slideCheck = $('#rv-slide-label');
  if (slideCheck) slideCheck.textContent = `Gaat over slide ${idx + 1}`;
}

function renderDetail() {
  const d = cur;
  const s = d.submitted;
  $('#rv-title').textContent = d.name;
  const st = $('#rv-status');
  st.innerHTML = '';
  st.append(statusPill(d.status));
  $('#rv-prev').onclick = () => step(-1);
  $('#rv-next').onclick = () => step(1);

  const side = $('#rv-side');
  side.innerHTML = '';
  if (!s) {
    /* concept: live voorbeeld, nog niets om op te reageren */
    const n = (d.slides || []).length;
    side.append(el('div', { class: 'rv-sec' },
      el('p', { class: 'muted' }, [FORMAT[d.format], d.mode === 'video' ? 'video' : 'afbeelding', n > 1 ? `${n} slides` : null].filter(Boolean).join(' · ')),
      d.date ? el('p', {}, el('b', {}, 'Gepland: '), day(d.date)) : null,
      el('p', { class: 'muted' }, `Laatst bewaard ${when(d.updated)} door ${d.author || 'onbekend'}`),
      el('p', { class: 'muted', style: 'font-size:12.5px' }, 'Concept, nog niet aangeboden. Dit voorbeeld wordt live getekend. Een eigen foto of video die alleen op een andere computer staat, zie je als leeg vlak.')
    ));
    if (d.caption) side.append(el('div', { class: 'rv-sec' }, el('p', { class: 'eyebrow' }, 'Bijschrift voor Instagram'), el('p', { class: 'rv-caption' }, d.caption)));
    side.append(el('div', { class: 'rv-sec' }, el('div', { class: 'rv-btns' },
      el('button', { class: 'btn gold', onclick: () => { closeDetail(); ctx.openInEditor(d.id); } }, 'Open in editor'))));
    renderMedia();
    return;
  }
  const meta = [FORMAT[d.format], s && s.mode === 'video' ? 'video' : 'afbeelding', s && s.previews.length > 1 && !s.sequence ? `${s.previews.length} slides` : null].filter(Boolean).join(' · ');
  side.append(el('div', { class: 'rv-sec' },
    el('p', { class: 'muted' }, meta),
    (s && s.date) ? el('p', {}, el('b', {}, 'Gepland: '), day(s.date)) : null,
    s ? el('p', { class: 'muted' }, `Versie ${s.version}, aangeboden door ${s.by} op ${when(s.at)}`) : null,
    ctx.role === 'maker' && d.editedSinceSubmit ? el('p', { class: 'rv-open' }, 'Je hebt de post aangepast sinds deze versie. Bied hem opnieuw aan als hij klaar is.') : null
  ));

  if (s && s.caption) side.append(el('div', { class: 'rv-sec' }, el('p', { class: 'eyebrow' }, 'Bijschrift voor Instagram'), el('p', { class: 'rv-caption' }, s.caption)));

  /* gesprek */
  const thread = el('div', { class: 'rv-thread' });
  for (const t of d.thread || []) {
    const isFeedback = t.role === 'approver' && (t.type === 'changes' || t.type === 'comment');
    const head = {
      submit: `${t.by} bood versie ${t.version} aan`,
      approve: `${t.by} keurde versie ${t.version} goed`,
      changes: `${t.by} vraagt om aanpassing`,
      comment: `${t.by}`
    }[t.type] || t.by;
    const item = el('div', { class: 'rv-msg t-' + t.type + (t.role === 'maker' ? ' from-maker' : '') + (t.resolved && isFeedback ? ' resolved' : '') },
      el('div', { class: 'rv-msg-head' }, el('b', {}, head), el('small', {}, when(t.at) + (t.slide != null ? ` · slide ${t.slide + 1}` : '') + (t.version !== d.version ? ` · versie ${t.version}` : ''))),
      t.text ? el('p', {}, t.text) : null
    );
    if (isFeedback) {
      if (ctx.role === 'maker') {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!t.resolved;
        cb.addEventListener('change', () => act(cb.checked ? 'resolve' : 'reopen', { commentId: t.id }));
        item.append(el('label', { class: 'chk rv-resolve' }, cb, t.resolved ? `Verwerkt${t.resolvedBy ? ' door ' + t.resolvedBy : ''}` : 'Verwerkt'));
      } else if (t.resolved) {
        item.append(el('small', { class: 'rv-done' }, `Verwerkt${t.resolvedBy ? ' door ' + t.resolvedBy : ''}`));
      }
    }
    thread.append(item);
  }
  side.append(el('div', { class: 'rv-sec' }, el('p', { class: 'eyebrow' }, 'Gesprek'), (d.thread || []).length ? thread : el('p', { class: 'muted' }, 'Nog geen reacties.')));

  /* acties */
  const ta = el('textarea', { rows: 3, placeholder: ctx.role === 'maker' ? 'Reageer op de feedback' : 'Je feedback of opmerking', id: 'rv-text' });
  const box = el('div', { class: 'rv-sec rv-act' }, ta);
  const multi = frames().length > 1;
  let slideCb = null;
  if (multi && ctx.role !== 'maker') {
    slideCb = el('input', { type: 'checkbox' });
    box.append(el('label', { class: 'chk', style: 'margin-top:8px' }, slideCb, el('span', { id: 'rv-slide-label' }, `Gaat over slide ${idx + 1}`)));
  }
  const slideArg = () => (slideCb && slideCb.checked ? idx : null);
  const row = el('div', { class: 'rv-btns' });
  if (ctx.role === 'maker') {
    row.append(
      el('button', { class: 'btn', onclick: () => act('comment', { text: ta.value }) }, 'Reageer'),
      el('button', { class: 'btn gold', onclick: () => { closeDetail(); ctx.openInEditor(d.id); } }, 'Open in editor')
    );
  } else if (s) {
    row.append(
      el('button', { class: 'btn', onclick: () => { if (!ta.value.trim()) { ta.focus(); ctx.toast('Schrijf eerst wat er anders moet.'); return; } act('changes', { text: ta.value, slide: slideArg() }); } }, 'Feedback geven'),
      d.status === 'approved' && (d.approvals || []).some(a => a.version === d.version && a.by === ctx.me())
        ? el('button', { class: 'btn', onclick: () => act('comment', { text: ta.value, slide: slideArg() }) }, 'Alleen opmerking')
        : el('button', { class: 'btn gold', onclick: () => act('approve', { text: ta.value }) }, 'Goedkeuren')
    );
    box.append(el('p', { class: 'muted', style: 'margin:10px 0 0;font-size:12px' }, 'Bij goedkeuren mag je ook een opmerking meegeven. Feedback zet de post terug naar de makers.'));
  }
  box.append(row);
  side.append(box);
  renderMedia();
}

async function act(kind, extra) {
  let me = ctx.me();
  if (!me) me = await ctx.askName();
  if (!me) return;
  if ((kind === 'comment') && !(extra.text || '').trim()) { $('#rv-text').focus(); return; }
  try {
    const { draft } = await ctx.api(Object.assign({ action: 'review', id: cur.id, kind, by: me }, extra));
    cur = draft;
    const msg = { approve: 'Goedgekeurd. Dank je!', changes: 'Feedback verstuurd naar de makers.', comment: 'Reactie geplaatst.', resolve: 'Gemarkeerd als verwerkt.', reopen: 'Weer open gezet.' }[kind];
    ctx.toast(msg);
    const keep = idx;
    renderDetail();
    idx = keep;
    renderMedia();
    refreshReview();
  } catch (e) {
    ctx.toast('Dat lukte niet: ' + e.message);
  }
}
