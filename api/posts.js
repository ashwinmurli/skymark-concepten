export const config = { runtime: 'edge' };

/* Concepten van de posttool.
   Bewaart posts/drafts.json op de branch "feedback" (die deployt niet),
   met dezelfde GitHub-token als api/review.js. Altijd POST:
   { secret, action: "list" }                 -> { drafts: [samenvatting] }
   { secret, action: "get", id }              -> { draft }
   { secret, action: "save", draft }          -> { ok, draft }
   { secret, action: "delete", id }           -> { ok }
   Eigen uploads (foto/video van je computer) worden niet opgeslagen; alleen
   tekst, keuzes en verwijzingen naar de fotoselectie. */

const REPO = 'ashwinmurli/skymark-concepten';
const BRANCH = 'feedback';
const FILE = 'posts/drafts.json';

const SECRET_HASHES = [
  '5a01578e704b3b7cd4a0dda3232734cf95a1c3adf756c20702de3f67eb743174',
  '7b132e77d40b11d72715ae2687f63b7a142a379228e271c69ba849cff13fae03'
];

const MAX_DRAFTS = 300;
const MAX_BYTES = 60000;

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
  return { Authorization: `token ${token}`, 'User-Agent': 'skymark-posts' };
}

async function readRemote(token) {
  const resp = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}?ref=${BRANCH}`, { headers: ghHeaders(token) });
  if (resp.status === 404) return { drafts: {}, sha: null };
  if (!resp.ok) throw new Error(`GitHub GET ${resp.status}`);
  const data = await resp.json();
  let drafts = {};
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, '')))));
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
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function clean(draft) {
  if (!draft || typeof draft !== 'object') return null;
  const id = String(draft.id || '');
  if (!/^[\w-]{6,40}$/.test(id)) return null;
  const out = {
    id,
    name: String(draft.name || 'Naamloze post').slice(0, 120),
    author: String(draft.author || '').slice(0, 60),
    updated: Date.now(),
    format: ['feed', 'story', 'carousel'].includes(draft.format) ? draft.format : 'feed',
    mode: draft.mode === 'video' ? 'video' : 'static',
    videoExport: draft.videoExport === 'doorlopend' ? 'doorlopend' : 'los',
    transition: {
      type: draft.transition && ['cut', 'fade', 'slide', 'wipe'].includes(draft.transition.type) ? draft.transition.type : 'fade',
      dur: draft.transition && +draft.transition.dur > 0 ? Math.min(1.5, +draft.transition.dur) : 0.7
    },
    slides: Array.isArray(draft.slides) ? draft.slides.slice(0, 20) : []
  };
  if (JSON.stringify(out).length > MAX_BYTES) return null;
  return out;
}

function summary(d) {
  return { id: d.id, name: d.name, author: d.author, updated: d.updated, format: d.format, mode: d.mode || 'static', count: d.slides.length, first: d.slides[0] ? d.slides[0].template : null };
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let payload;
  try { payload = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  if (!SECRET_HASHES.includes(await sha256hex(String(payload.secret || '')))) return json({ error: 'unauthorized' }, 401);
  const token = process.env.GITHUB_TOKEN;
  if (!token) return json({ error: 'not configured' }, 500);

  try {
    if (payload.action === 'list') {
      const { drafts } = await readRemote(token);
      return json({ drafts: Object.values(drafts).map(summary).sort((a, b) => b.updated - a.updated) });
    }
    if (payload.action === 'get') {
      const { drafts } = await readRemote(token);
      const d = drafts[String(payload.id || '')];
      return d ? json({ draft: d }) : json({ error: 'not found' }, 404);
    }
    if (payload.action === 'save' || payload.action === 'delete') {
      const incoming = payload.action === 'save' ? clean(payload.draft) : null;
      if (payload.action === 'save' && !incoming) return json({ error: 'invalid draft' }, 400);
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await readRemote(token);
        const drafts = { ...remote.drafts };
        let msg;
        if (incoming) {
          drafts[incoming.id] = incoming;
          const ids = Object.values(drafts).sort((a, b) => b.updated - a.updated).map(d => d.id);
          for (const old of ids.slice(MAX_DRAFTS)) delete drafts[old];
          msg = `Posttool: concept "${incoming.name}" bewaard`;
        } else {
          delete drafts[String(payload.id || '')];
          msg = 'Posttool: concept verwijderd';
        }
        const put = await writeRemote(token, drafts, remote.sha, msg);
        if (put.ok) return json({ ok: true, draft: incoming || undefined });
        if (put.status !== 409 && put.status !== 422) return json({ error: `github ${put.status}` }, 500);
      }
      return json({ error: 'conflict' }, 500);
    }
    return json({ error: 'unknown action' }, 400);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}
