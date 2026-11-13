import { put } from '@vercel/blob';

/* Printbestanden (volle resolutie) van de definitieve fotoselectie.
   De bestanden staan in Vercel Blob (openbaar, zodat downloaden en zippen
   direct vanaf de pagina kan); de site zelf blijft klein.
   Alleen makers kunnen uploaden:
   POST /api/print?name=Skymark-DSCF1558-print.jpg
     header x-skymark-secret: <makerswachtwoord>, body: het bestand
     -> { url, downloadUrl, pathname } */

const MAKER_HASH = '1b89a93efd9c4119f37c5abbb7bdff935ce567a6496b661b53bfe98557b9b64e';
const NAME_RE = /^[\w.-]{1,120}\.(jpe?g|png|tiff?)$/i;

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

export async function POST(req) {
  if (await sha256hex(req.headers.get('x-skymark-secret') || '') !== MAKER_HASH) return json({ error: 'unauthorized' }, 401);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ error: 'geen Blob-opslag gekoppeld' }, 500);
  const name = new URL(req.url).searchParams.get('name') || '';
  if (!NAME_RE.test(name)) return json({ error: 'ongeldige bestandsnaam' }, 400);
  if (!req.body) return json({ error: 'leeg bestand' }, 400);
  const ext = name.split('.').pop().toLowerCase();
  const type = ext === 'png' ? 'image/png' : ext.startsWith('tif') ? 'image/tiff' : 'image/jpeg';
  try {
    const blob = await put(`fotoselectie/print/${name}`, req.body, {
      access: 'public', contentType: type, addRandomSuffix: false, allowOverwrite: true,
      cacheControlMaxAge: 60 * 60 * 24 * 30
    });
    return json({ url: blob.url, downloadUrl: blob.downloadUrl, pathname: blob.pathname });
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}

export function GET() {
  return new Response('Method not allowed', { status: 405 });
}
