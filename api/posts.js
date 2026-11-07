export const config = { runtime: 'edge' };

/* Posttool: concepten, goedkeuring en previews.

   Opslag op de branch "feedback" (die deployt niet), met dezelfde GitHub-token
   als api/review.js:
     posts/drafts.json                  alle posts met status en gesprek
     posts/media/<id>/v<n>/<bestand>    previews per aangeboden versie

   Rollen, bepaald door het wachtwoord (alleen als hash in deze code):
     maker      Ash en Celine: maken, bewaren, aanbieden, feedback verwerken
     approver   Esmée en Camille (het gewone portalwachtwoord): alleen
                aangeboden posts zien, goedkeuren en feedback geven

   Altijd POST met { secret, action, ... }:
     whoami                             -> { role }
     list                               -> { drafts: [samenvatting] }
     get { id }                         -> { draft }
     save { draft }          (maker)    -> { ok, draft }
     delete { id }           (maker)    -> { ok }
     upload { path, b64 }    (maker)    -> { ok, path }
     submit { id, version, previews, sequence, by, note }   (maker) -> { ok, draft }
     review { id, kind, text, slide, by, commentId }         -> { ok, draft }
     media { path }                     -> de bytes van een preview */

const REPO = 'ashwinmurli/skymark-concepten';
const BRANCH = 'feedback';
const FILE = 'posts/drafts.json';

const ROLE_BY_HASH = {
  /* portalwachtwoorden (kijken en formats-editor) */
  '5a01578e704b3b7cd4a0dda3232734cf95a1c3adf756c20702de3f67eb743174': 'approver',
  '7b132e77d40b11d72715ae2687f63b7a142a379228e271c69ba849cff13fae03': 'approver',
  /* makerswachtwoord posttool */
  '1b89a93efd9c4119f37c5abbb7bdff935ce567a6496b661b53bfe98557b9b64e': 'maker'
};

const MAX_DRAFTS = 300;
const MAX_BYTES = 120000;
const MAX_UPLOAD = 3_400_000;
const STATUSES = ['concept', 'review', 'changes', 'approved'];

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function ghHeaders(token, extra) {
  return Object.assign({ Authorization: `token ${token}`, 'User-Agent': 'skymark-posts' }, extra || {});
}

async function readRemote(token) {
  const resp = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}?ref=${BRANCH}`, { headers: ghHeaders(token) });
  if (resp.status === 404) return { drafts: {}, sha: null };
  if (!resp.ok) throw new Error(`GitHub GET ${resp.status}`);
  const data = await resp.json();
  let drafts = {};
  let raw = data.content;
  /* bestanden groter dan 1 MB komen zonder inhoud terug: dan los ophalen */
  if (!raw && data.sha) {
    const b = await fetch(`https://api.github.com/repos/${REPO}/git/blobs/${data.sha}`, { headers: ghHeaders(token) });
    raw = (await b.json()).content;
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(String(raw).replace(/\n/g, '')))));
    if (parsed && typeof parsed.drafts === 'object') drafts = parsed.drafts;
  } catch (e) { /* corrupte inhoud: leeg behandelen */ }
  return { drafts, sha: data.sha };
}

async function writeRemote(token, drafts, sha, message) {
  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(JSON.stringify({ drafts, updated: Date.now() })))),
    branch: BRANCH
  };
  if (sha) body.sha = sha;
  return fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
    method: 'PUT',
    headers: ghHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  });
}

/* Lees, wijzig en schrijf drafts.json, met een nieuwe poging bij een gelijktijdige wijziging. */
async function mutate(token, fn) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const remote = await readRemote(token);
    const drafts = { ...remote.drafts };
    const res = fn(drafts);
    if (res && res.error) return res;
    const put = await writeRemote(token, drafts, remote.sha, res.message);
    if (put.ok) return res;
    if (put.status !== 409 && put.status !== 422) return { error: `github ${put.status}`, status: 500 };
  }
  return { error: 'conflict', status: 500 };
}

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* De inhoud die makers aanpassen; status en gesprek beheert de server zelf. */
function cleanContent(draft) {
  if (!draft || typeof draft !== 'object') return null;
  const id = String(draft.id || '');
  if (!/^[\w-]{6,40}$/.test(id)) return null;
  const out = {
    id,
    name: str(draft.name || 'Naamloze post', 120),
    author: str(draft.author, 60),
    updated: Date.now(),
    format: ['feed', 'story', 'carousel'].includes(draft.format) ? draft.format : 'feed',
    mode: draft.mode === 'video' ? 'video' : 'static',
    videoExport: draft.videoExport === 'doorlopend' ? 'doorlopend' : 'los',
    transition: {
      type: draft.transition && ['cut', 'fade', 'slide', 'wipe'].includes(draft.transition.type) ? draft.transition.type : 'fade',
      dur: draft.transition && +draft.transition.dur > 0 ? Math.min(1.5, +draft.transition.dur) : 0.7
    },
    caption: str(draft.caption, 2200),
    date: /^\d{4}-\d{2}-\d{2}$/.test(draft.date || '') ? draft.date : '',
    slides: Array.isArray(draft.slides) ? draft.slides.slice(0, 20) : []
  };
  if (JSON.stringify(out).length > MAX_BYTES) return null;
  return out;
}

function reviewFields(d) {
  return {
    status: STATUSES.includes(d && d.status) ? d.status : 'concept',
    version: d && d.version || 0,
    submitted: d && d.submitted || null,
    thread: d && Array.isArray(d.thread) ? d.thread : [],
    approvals: d && Array.isArray(d.approvals) ? d.approvals : [],
    editedSinceSubmit: !!(d && d.editedSinceSubmit)
  };
}

function summary(d) {
  const r = reviewFields(d);
  const open = r.thread.filter(t => t.role === 'approver' && (t.type === 'changes' || t.type === 'comment') && !t.resolved).length;
  const sub = r.submitted;
  return {
    id: d.id, name: d.name, author: d.author, updated: d.updated, format: d.format, mode: d.mode,
    count: (d.slides || []).length, first: d.slides && d.slides[0] ? d.slides[0].template : null,
    date: d.date || '', status: r.status, version: r.version, editedSinceSubmit: r.editedSinceSubmit,
    openFeedback: open, approvals: r.approvals.filter(a => a.version === r.version),
    thumb: sub && sub.previews && sub.previews[0] ? sub.previews[0].still : null,
    /* voor makers: eerste slide om een concept zonder previews live te tekenen */
    firstSlide: d.slides && d.slides[0] ? d.slides[0] : null,
    submittedAt: sub ? sub.at : null
  };
}

function cleanFile(f) {
  if (!f || typeof f !== 'object') return null;
  const path = String(f.path || '');
  if (!/^posts\/media\/[\w-]{6,40}\/v\d{1,3}\/[\w.-]{1,60}$/.test(path)) return null;
  return { path, parts: Math.max(1, Math.min(40, +f.parts || 1)), type: f.type === 'video' ? 'video' : 'image' };
}


/* ---------- e-mailmeldingen (Resend) ----------
   Bij aanbieden krijgen de goedkeurders een mail; bij goedkeuren, feedback of
   een opmerking krijgen de makers er een. Wie de actie zelf doet, krijgt geen
   mail. Een mislukte mail laat de actie zelf nooit mislukken. */

const SITE = 'https://skymark.connectingthepolkadots.com/posts/';
const PEOPLE = {
  approver: [
    { name: 'Esmée', email: 'etenhove@amvest.nl' },
    { name: 'Camille', email: 'cstijlaart@amvest.nl' }
  ],
  maker: [
    { name: 'Ash', email: 'ash@connectingthepolkadots.com' },
    { name: 'Celine', email: 'celinepoulussen.work@gmail.com' }
  ]
};

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FORMAT_NL = { feed: 'Feed 4:5', story: 'Story 9:16', carousel: 'Carrousel' };

function mailHtml({ eyebrow, title, intro, quote, rows, cta, link }) {
  const rowHtml = (rows || []).filter(r => r && r[1]).map(r =>
    `<tr><td style="padding:3px 16px 3px 0;color:#8B8B7E;font-size:13px;white-space:nowrap;vertical-align:top">${esc(r[0])}</td><td style="padding:3px 0;color:#101310;font-size:13px">${esc(r[1])}</td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#F1F1EB;padding:32px 16px;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #D4D4CF">
<tr><td style="background:#101310;padding:22px 32px;color:#DCEBDA;font-size:13px;letter-spacing:4px;text-transform:uppercase">Skymark</td></tr>
<tr><td style="padding:32px 32px 8px">
<p style="margin:0 0 10px;color:#556655;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">${esc(eyebrow)}</p>
<h1 style="margin:0 0 14px;color:#101310;font-family:Georgia,serif;font-weight:normal;font-size:26px;line-height:1.25">${esc(title)}</h1>
<p style="margin:0 0 18px;color:#101310;font-size:15px;line-height:1.55">${esc(intro)}</p>
${quote ? `<p style="margin:0 0 20px;padding:12px 16px;background:#F1F1EB;border-left:3px solid #556655;color:#101310;font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(quote)}</p>` : ''}
${rowHtml ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px">${rowHtml}</table>` : ''}
<a href="${esc(link)}" style="display:inline-block;background:#556655;color:#DCEBDA;text-decoration:none;font-size:13px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;padding:13px 22px">${esc(cta)}</a>
</td></tr>
<tr><td style="padding:24px 32px 28px;color:#8B8B7E;font-size:12px;line-height:1.5">Je krijgt deze mail via de Skymark-portal van Connecting the Polkadots. Log in met het wachtwoord dat je al hebt.</td></tr>
</table></td></tr></table></body></html>`;
}

function mailText({ title, intro, quote, rows, link }) {
  return [title, '', intro, quote ? '\n"' + quote + '"' : '', '', ...(rows || []).filter(r => r && r[1]).map(r => `${r[0]}: ${r[1]}`), '', link].join('\n');
}

async function sendMail(to, subject, content) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return 'geen RESEND_API_KEY';
  if (!to.length) return 'geen ontvangers';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'Ash van Vugt-Murli <ash@connectingthepolkadots.com>',
      to: to.map(p => p.email),
      subject,
      html: mailHtml(content),
      text: mailText(content)
    })
  });
  return r.ok ? 'verstuurd' : `mislukt (${r.status}): ${(await r.text()).slice(0, 300)}`;
}

function others(role, by) {
  const b = String(by || '').trim().toLowerCase();
  return PEOPLE[role].filter(p => !b || !b.startsWith(p.name.toLowerCase()));
}

function dayNl(d) {
  return d ? new Date(d + 'T12:00:00Z').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
}

async function notify(event, d, extra) {
  try {
    const link = `${SITE}#post=${d.id}`;
    const s = d.submitted || {};
    const rows = [
      ['Format', FORMAT_NL[d.format] + (s.mode === 'video' ? ', video' : '')],
      ['Gepland', dayNl(s.date || d.date)],
      ['Versie', String(d.version || '')]
    ];
    if (event === 'submit') {
      const again = d.version > 1;
      return await sendMail(PEOPLE.approver, `${again ? 'Nieuwe versie' : 'Ter goedkeuring'}: ${d.name}`, {
        eyebrow: again ? `Versie ${d.version} ter goedkeuring` : 'Nieuwe post ter goedkeuring',
        title: d.name,
        intro: again
          ? `${extra.by} heeft de feedback verwerkt en een nieuwe versie klaargezet. Wil je er nog even naar kijken?`
          : `${extra.by} heeft een nieuwe post voor Skymark klaargezet. Je kunt hem bekijken, goedkeuren of er feedback op geven.`,
        quote: extra.note || '',
        rows: rows.concat([['Bijschrift', s.caption ? s.caption.slice(0, 160) + (s.caption.length > 160 ? '…' : '') : '']]),
        cta: 'Bekijk de post',
        link
      });
    }
    if (event === 'approve') {
      return await sendMail(others('maker'), `Goedgekeurd: ${d.name}`, {
        eyebrow: 'Goedgekeurd', title: d.name,
        intro: `${extra.by} heeft versie ${d.version} goedgekeurd.${extra.text ? ' Met deze opmerking:' : ''}`,
        quote: extra.text, rows, cta: 'Open de post', link
      });
    }
    if (event === 'changes' || event === 'comment') {
      const fromApprover = extra.role === 'approver';
      const to = fromApprover ? others('maker', extra.by) : others('approver', extra.by);
      const slide = Number.isInteger(extra.slide) ? ` (slide ${extra.slide + 1})` : '';
      return await sendMail(to, `${event === 'changes' ? 'Feedback' : 'Reactie'} op ${d.name}`, {
        eyebrow: event === 'changes' ? 'Feedback, graag aanpassen' : 'Nieuwe reactie',
        title: d.name,
        intro: `${extra.by} schreef${slide}:`,
        quote: extra.text, rows, cta: fromApprover ? 'Open de post' : 'Bekijk de reactie', link
      });
    }
    return 'geen mail voor deze actie';
  } catch (e) {
    return 'mislukt: ' + String(e && e.message || e);
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let p;
  try { p = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const role = ROLE_BY_HASH[await sha256hex(String(p.secret || ''))];
  if (!role) return json({ error: 'unauthorized' }, 401);
  const token = process.env.GITHUB_TOKEN;
  if (!token) return json({ error: 'not configured' }, 500);
  const maker = role === 'maker';
  const needMaker = () => json({ error: 'alleen voor makers' }, 403);

  try {
    if (p.action === 'whoami') return json({ role });

    if (p.action === 'list') {
      const { drafts } = await readRemote(token);
      let list = Object.values(drafts);
      if (!maker) list = list.filter(d => d.submitted);
      return json({ role, drafts: list.map(summary).sort((a, b) => (b.submittedAt || b.updated) - (a.submittedAt || a.updated)) });
    }

    if (p.action === 'get') {
      const { drafts } = await readRemote(token);
      const d = drafts[String(p.id || '')];
      if (!d || (!maker && !d.submitted)) return json({ error: 'not found' }, 404);
      return json({ draft: d });
    }

    if (p.action === 'media') {
      const path = String(p.path || '');
      if (!/^posts\/media\/[\w-]{6,40}\/v\d{1,3}\/[\w.-]{1,64}$/.test(path)) return json({ error: 'bad path' }, 400);
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`, { headers: ghHeaders(token, { Accept: 'application/vnd.github.raw' }) });
      if (!r.ok) return json({ error: `github ${r.status}` }, r.status === 404 ? 404 : 500);
      const type = /\.mp4/.test(path) ? 'video/mp4' : /\.mov/.test(path) ? 'video/quicktime' : /\.webm/.test(path) ? 'video/webm' : /\.png/.test(path) ? 'image/png' : 'image/jpeg';
      return new Response(r.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' } });
    }

    if (p.action === 'review') {
      const kind = String(p.kind || '');
      const allowed = maker ? ['comment', 'resolve', 'reopen'] : ['approve', 'changes', 'comment'];
      if (!allowed.includes(kind)) return json({ error: 'niet toegestaan' }, 403);
      const text = str(p.text, 2000).trim();
      if ((kind === 'changes' || kind === 'comment') && !text) return json({ error: 'tekst ontbreekt' }, 400);
      const by = str(p.by, 60).trim() || (maker ? 'Maker' : 'Klant');
      const res = await mutate(token, drafts => {
        const d = drafts[String(p.id || '')];
        if (!d || !d.submitted) return { error: 'not found', status: 404 };
        const r = reviewFields(d);
        if (kind === 'resolve' || kind === 'reopen') {
          const item = r.thread.find(t => t.id === p.commentId);
          if (!item) return { error: 'not found', status: 404 };
          item.resolved = kind === 'resolve';
          item.resolvedBy = kind === 'resolve' ? by : '';
          item.resolvedAt = kind === 'resolve' ? Date.now() : 0;
        } else {
          const slide = Number.isInteger(p.slide) && p.slide >= 0 && p.slide < 20 ? p.slide : null;
          r.thread.push({ id: uid(), at: Date.now(), by, role, type: kind, text, slide, version: r.version, resolved: false });
          if (kind === 'approve') { r.status = 'approved'; r.approvals.push({ by, at: Date.now(), version: r.version }); }
          if (kind === 'changes') r.status = 'changes';
        }
        Object.assign(d, r);
        drafts[d.id] = d;
        return { ok: true, draft: d, message: `Posttool: ${kind} op "${d.name}" door ${by}` };
      });
      if (res.error) return json({ error: res.error }, res.status || 500);
      const mail = ['approve', 'changes', 'comment'].includes(kind) ? await notify(kind, res.draft, { by, text, role, slide: Number.isInteger(p.slide) ? p.slide : null }) : null;
      return json({ ok: true, draft: res.draft, mail });
    }

    /* alles hieronder alleen voor makers */
    if (!maker) return needMaker();

    if (p.action === 'save') {
      const incoming = cleanContent(p.draft);
      if (!incoming) return json({ error: 'invalid draft' }, 400);
      const res = await mutate(token, drafts => {
        const prev = drafts[incoming.id];
        const r = reviewFields(prev);
        if (r.submitted) r.editedSinceSubmit = true;
        drafts[incoming.id] = Object.assign(incoming, r);
        const ids = Object.values(drafts).sort((a, b) => b.updated - a.updated).map(d => d.id);
        for (const old of ids.slice(MAX_DRAFTS)) delete drafts[old];
        return { ok: true, draft: drafts[incoming.id], message: `Posttool: concept "${incoming.name}" bewaard` };
      });
      return res.error ? json({ error: res.error }, res.status || 500) : json({ ok: true, draft: res.draft });
    }

    if (p.action === 'delete') {
      const res = await mutate(token, drafts => {
        delete drafts[String(p.id || '')];
        return { ok: true, message: 'Posttool: concept verwijderd' };
      });
      return res.error ? json({ error: res.error }, res.status || 500) : json({ ok: true });
    }

    if (p.action === 'upload') {
      const path = 'posts/media/' + String(p.path || '');
      if (!/^posts\/media\/[\w-]{6,40}\/v\d{1,3}\/[\w.-]{1,64}$/.test(path)) return json({ error: 'bad path' }, 400);
      const b64 = String(p.b64 || '');
      if (b64.length * 0.75 > MAX_UPLOAD) return json({ error: 'te groot' }, 413);
      for (let attempt = 0; attempt < 2; attempt++) {
        let sha = null;
        if (attempt) {
          const g = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`, { headers: ghHeaders(token) });
          if (g.ok) sha = (await g.json()).sha;
        }
        const body = { message: `Posttool: ${/\/v0\//.test(path) ? 'beeld' : 'preview'} ${path.split('/').slice(2).join('/')}`, content: b64, branch: BRANCH };
        if (sha) body.sha = sha;
        const put = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
          method: 'PUT', headers: ghHeaders(token, { 'Content-Type': 'application/json' }), body: JSON.stringify(body)
        });
        if (put.ok) return json({ ok: true, path });
        if (put.status !== 422 && put.status !== 409) return json({ error: `github ${put.status}` }, 500);
      }
      return json({ error: 'upload mislukt' }, 500);
    }

    if (p.action === 'submit') {
      const previews = Array.isArray(p.previews) ? p.previews.slice(0, 20).map(x => ({
        slide: Math.max(0, Math.min(19, +x.slide || 0)),
        still: cleanFile(x.still),
        video: cleanFile(x.video)
      })).filter(x => x.still) : [];
      if (!previews.length) return json({ error: 'geen previews' }, 400);
      const sequence = cleanFile(p.sequence);
      const by = str(p.by, 60).trim() || 'Maker';
      const note = str(p.note, 2000).trim();
      const res = await mutate(token, drafts => {
        const d = drafts[String(p.id || '')];
        if (!d) return { error: 'bewaar de post eerst', status: 404 };
        const r = reviewFields(d);
        const version = r.version + 1;
        if (+p.version !== version) return { error: 'versie klopt niet, laad opnieuw', status: 409 };
        r.version = version;
        r.status = 'review';
        r.editedSinceSubmit = false;
        r.submitted = { version, at: Date.now(), by, name: d.name, format: d.format, mode: d.mode, videoExport: d.videoExport, caption: d.caption || '', date: d.date || '', previews, sequence };
        r.thread.push({ id: uid(), at: Date.now(), by, role: 'maker', type: 'submit', text: note, slide: null, version, resolved: true });
        Object.assign(d, r);
        drafts[d.id] = d;
        return { ok: true, draft: d, message: `Posttool: "${d.name}" versie ${version} ter goedkeuring` };
      });
      if (res.error) return json({ error: res.error }, res.status || 500);
      const mail = await notify('submit', res.draft, { by, note });
      return json({ ok: true, draft: res.draft, mail });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}
