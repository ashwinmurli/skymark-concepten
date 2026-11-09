export const config = { runtime: 'edge' };
import { sendMail, others } from './_mail.js';

/* Feedback-opslag voor de fotoselectie en de templatepagina.
   Bewaart voorkeuren en opmerkingen als <pagina>/reviews.json op de
   branch "feedback" (die branch deployt niet, zie vercel.json), via dezelfde
   GitHub-token die api/save.js al gebruikt. Eén endpoint, altijd POST:
   { secret, page?, action: "get" }               -> { items }
   { secret, page?, action: "set", items: {...} } -> { ok, items }  (gemergde stand)
   page is "fotoselectie" (standaard) of "templates".
   { secret, page: "templates", action: "notify", id, label } -> mailt Ash en Celine over
   een reactie op een template; dezelfde reactie wordt maar één keer gemeld (notifiedSig).
   Merge is per foto: de hoogste "updated"-timestamp wint. */

const REPO = 'ashwinmurli/skymark-concepten';
const BRANCH = 'feedback';
const PAGES = {
  fotoselectie: { file: 'fotoselectie/reviews.json', label: 'Fotoselectie', choices: [null, 'bewerkt', 'origineel', 'geen', 'zacht'] },
  templates: { file: 'templates/reviews.json', label: 'Templates', choices: [null, 'akkoord', 'aanpassen'] }
};

/* sha256-hashes van het kijk- en het editwachtwoord van de portal */
const SECRET_HASHES = [
  '5a01578e704b3b7cd4a0dda3232734cf95a1c3adf756c20702de3f67eb743174',
  '7b132e77d40b11d72715ae2687f63b7a142a379228e271c69ba849cff13fae03'
];


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

function ghHeaders(token) {
  return { Authorization: `token ${token}`, 'User-Agent': 'skymark-review' };
}

async function readRemote(token, page) {
  const resp = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${page.file}?ref=${BRANCH}`,
    { headers: ghHeaders(token) }
  );
  if (resp.status === 404) return { items: {}, selections: {}, sha: null };
  if (!resp.ok) throw new Error(`GitHub GET ${resp.status}`);
  const data = await resp.json();
  let items = {}, selections = {};
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, '')))));
    if (parsed && typeof parsed.items === 'object') items = parsed.items;
    if (parsed && typeof parsed.selections === 'object') selections = parsed.selections;
  } catch (e) { /* corrupte inhoud: behandel als leeg, sha blijft bruikbaar */ }
  return { items, selections, sha: data.sha };
}

function sanitizeItems(raw, CHOICES) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const ids = Object.keys(raw).slice(0, 5000);
  for (const id of ids) {
    if (!/^[\w-]{1,90}$/.test(id)) continue;
    const it = raw[id];
    if (!it || typeof it !== 'object') continue;
    const choice = CHOICES.includes(it.choice) ? it.choice : null;
    const note = typeof it.note === 'string' ? it.note.slice(0, 2000) : '';
    const name = typeof it.name === 'string' ? it.name.slice(0, 100) : '';
    const updated = typeof it.updated === 'number' && isFinite(it.updated) ? it.updated : 0;
    /* een leeg item met een timestamp is een bewuste reset en telt dus mee */
    if (choice === null && !note.trim() && !updated) continue;
    out[id] = { choice, note, name, updated };
  }
  return out;
}

function sanitizeSelections(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const slugs = Object.keys(raw).slice(0, 30);
  for (const s of slugs) {
    if (!/^[\w-]{1,40}$/.test(s)) continue;
    const sel = raw[s];
    if (!sel || typeof sel !== 'object') continue;
    const name = typeof sel.name === 'string' ? sel.name.slice(0, 100) : s;
    const updated = typeof sel.updated === 'number' && isFinite(sel.updated) ? sel.updated : 0;
    const ids = Array.isArray(sel.ids)
      ? [...new Set(sel.ids.filter(id => typeof id === 'string' && /^[\w-]{1,40}$/.test(id)))].slice(0, 40)
      : [];
    out[s] = { name, ids, updated };
  }
  return out;
}

function merge(remote, incoming) {
  const out = { ...remote };
  for (const id of Object.keys(incoming)) {
    const r = out[id];
    if (!r || (incoming[id].updated || 0) >= (r.updated || 0)) {
      /* het server-veld notifiedSig blijft staan; de browser stuurt het niet mee */
      out[id] = r && r.notifiedSig ? { ...incoming[id], notifiedSig: r.notifiedSig } : incoming[id];
    }
  }
  return out;
}

const SITE = 'https://skymark.connectingthepolkadots.com';
const sigOf = it => `${it.choice || ''}|${(it.note || '').trim()}`;

async function notifyTemplate(token, page, id, label) {
  const remote = await readRemote(token, page);
  const it = remote.items[id];
  if (!it || !(it.choice || (it.note || '').trim())) return 'leeg';
  const sig = sigOf(it);
  if (it.notifiedSig === sig) return 'al gemeld';
  const by = (it.name || '').trim() || 'Iemand';
  const tid = id.split('--')[0];
  const name = String(label || tid).slice(0, 80);
  const verdict = it.choice === 'akkoord' ? 'Akkoord' : it.choice === 'aanpassen' ? 'Graag aanpassen' : 'Opmerking';
  const intro = it.choice === 'aanpassen' ? `${by} ziet dit template graag anders.`
    : it.choice === 'akkoord' ? `${by} is akkoord met dit template.`
    : `${by} liet een opmerking achter bij dit template.`;
  const mail = await sendMail(others('maker', by), `${by} over template ${name}: ${verdict}`, {
    eyebrow: 'Templates · reactie',
    title: `${by} reageerde op ${name}`,
    intro,
    quote: (it.note || '').trim(),
    rows: [['Template', name], ['Oordeel', verdict]],
    cta: 'Bekijk het template',
    link: `${SITE}/templates/#t-${tid}`
  });
  /* vastleggen dat deze stand gemeld is; bij een gelijktijdige save opnieuw proberen */
  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = attempt ? await readRemote(token, page) : remote;
    const cur = fresh.items[id];
    if (!cur || sigOf(cur) !== sig) break;
    fresh.items[id] = { ...cur, notifiedSig: sig };
    const put = await writeRemote(token, page, fresh.items, fresh.sha, fresh.selections);
    if (put.ok) break;
  }
  return mail;
}

async function writeRemote(token, page, items, sha, selections) {
  const body = {
    message: `${page.label}: feedback bijgewerkt ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify({ items, selections: selections || {}, updated: Date.now() }, null, 1)))),
    branch: BRANCH
  };
  if (sha) body.sha = sha;
  return fetch(`https://api.github.com/repos/${REPO}/contents/${page.file}`, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let payload;
  try { payload = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }

  const hash = await sha256hex(String(payload.secret || ''));
  if (!SECRET_HASHES.includes(hash)) return json({ error: 'unauthorized' }, 401);

  const token = process.env.GITHUB_TOKEN;
  if (!token) return json({ error: 'not configured' }, 500);

  const page = PAGES[payload.page || 'fotoselectie'];
  if (!page) return json({ error: 'unknown page' }, 400);

  try {
    if (payload.action === 'get') {
      const remote = await readRemote(token, page);
      return json({ items: remote.items, selections: remote.selections });
    }

    if (payload.action === 'set') {
      const incoming = sanitizeItems(payload.items, page.choices);
      const incomingSel = sanitizeSelections(payload.selections);
      /* twee pogingen: bij een sha-conflict (gelijktijdige save) verse stand ophalen */
      for (let attempt = 0; attempt < 2; attempt++) {
        const remote = await readRemote(token, page);
        const merged = merge(remote.items, incoming);
        const mergedSel = merge(remote.selections, incomingSel);
        const put = await writeRemote(token, page, merged, remote.sha, mergedSel);
        if (put.ok) return json({ ok: true, items: merged, selections: mergedSel });
        if (put.status !== 409 && put.status !== 422) {
          return json({ error: `github ${put.status}` }, 500);
        }
      }
      return json({ error: 'conflict' }, 500);
    }

    if (payload.action === 'notify') {
      if (payload.page !== 'templates') return json({ error: 'not supported' }, 400);
      const id = String(payload.id || '');
      if (!/^[\w-]{1,90}$/.test(id)) return json({ error: 'bad id' }, 400);
      const mail = await notifyTemplate(token, page, id, payload.label);
      return json({ ok: true, mail });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}
