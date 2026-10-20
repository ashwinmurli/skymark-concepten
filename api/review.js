export const config = { runtime: 'edge' };

/* Feedback-opslag voor de fotoselectie.
   Bewaart voorkeuren en opmerkingen als fotoselectie/reviews.json op de
   branch "feedback" (die branch deployt niet, zie vercel.json), via dezelfde
   GitHub-token die api/save.js al gebruikt. Eén endpoint, altijd POST:
   { secret, action: "get" }                  -> { items }
   { secret, action: "set", items: {...} }    -> { ok, items }  (gemergde stand)
   Merge is per foto: de hoogste "updated"-timestamp wint. */

const REPO = 'ashwinmurli/skymark-concepten';
const BRANCH = 'feedback';
const FILE = 'fotoselectie/reviews.json';

/* sha256-hashes van het kijk- en het editwachtwoord van de portal */
const SECRET_HASHES = [
  '5a01578e704b3b7cd4a0dda3232734cf95a1c3adf756c20702de3f67eb743174',
  '7b132e77d40b11d72715ae2687f63b7a142a379228e271c69ba849cff13fae03'
];

const CHOICES = [null, 'bewerkt', 'origineel', 'geen', 'zacht'];

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

async function readRemote(token) {
  const resp = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE}?ref=${BRANCH}`,
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

function sanitizeItems(raw) {
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
    if (!r || (incoming[id].updated || 0) >= (r.updated || 0)) out[id] = incoming[id];
  }
  return out;
}

async function writeRemote(token, items, sha, selections) {
  const body = {
    message: `Fotoselectie: feedback bijgewerkt ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify({ items, selections: selections || {}, updated: Date.now() }, null, 1)))),
    branch: BRANCH
  };
  if (sha) body.sha = sha;
  return fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export default async function handler(req) {
  if (req.method === 'GET' && new URL(req.url).searchParams.get('diag') === '1') {
    /* tijdelijke diagnose: alleen statuscodes, geen inhoud */
    const token = process.env.GITHUB_TOKEN;
    if (!token) return json({ token: 'ontbreekt' });
    const r1 = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}?ref=${BRANCH}`, { headers: ghHeaders(token) });
    const r2 = await fetch('https://api.github.com/user', { headers: ghHeaders(token) });
    return json({ token: 'aanwezig', leesFeedback: r1.status, tokenGeldig: r2.status, scopes: r2.headers.get('x-oauth-scopes'), verloopt: r2.headers.get('github-authentication-token-expiration') });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let payload;
  try { payload = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }

  const hash = await sha256hex(String(payload.secret || ''));
  if (!SECRET_HASHES.includes(hash)) return json({ error: 'unauthorized' }, 401);

  const token = process.env.GITHUB_TOKEN;
  if (!token) return json({ error: 'not configured' }, 500);

  try {
    if (payload.action === 'get') {
      const remote = await readRemote(token);
      return json({ items: remote.items, selections: remote.selections });
    }

    if (payload.action === 'set') {
      const incoming = sanitizeItems(payload.items);
      const incomingSel = sanitizeSelections(payload.selections);
      /* twee pogingen: bij een sha-conflict (gelijktijdige save) verse stand ophalen */
      for (let attempt = 0; attempt < 2; attempt++) {
        const remote = await readRemote(token);
        const merged = merge(remote.items, incoming);
        const mergedSel = merge(remote.selections, incomingSel);
        const put = await writeRemote(token, merged, remote.sha, mergedSel);
        if (put.ok) return json({ ok: true, items: merged, selections: mergedSel });
        if (put.status !== 409 && put.status !== 422) {
          return json({ error: `github ${put.status}` }, 500);
        }
      }
      return json({ error: 'conflict' }, 500);
    }

    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}
