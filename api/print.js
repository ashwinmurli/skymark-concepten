import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';

/* Printbestanden (volle resolutie) van de definitieve fotoselectie.
   De bestanden staan in Vercel Blob (openbaar, zodat downloaden en zippen
   direct vanaf de pagina kan); de site zelf blijft klein.
   Een functie mag maar 4,5 MB ontvangen, dus de upload gaat rechtstreeks naar
   Blob. Deze functie geeft alleen een kortlevende uploadsleutel voor één bestand,
   en alleen aan makers:
   POST /api/print  header x-skymark-secret: <makerswachtwoord>
     body { name: "Skymark-DSCF1558-print.jpg" } -> { token, pathname } */

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
  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const name = String(body.name || '');
  if (!NAME_RE.test(name)) return json({ error: 'ongeldige bestandsnaam' }, 400);
  const pathname = `fotoselectie/print/${name}`;
  const token = await generateClientTokenFromReadWriteToken({
    pathname,
    allowOverwrite: true,
    addRandomSuffix: false,
    maximumSizeInBytes: 200 * 1024 * 1024,
    allowedContentTypes: ['image/jpeg', 'image/png', 'image/tiff'],
    validUntil: Date.now() + 15 * 60 * 1000,
    cacheControlMaxAge: 60 * 60 * 24 * 30
  });
  return json({ token, pathname });
}

export function GET() {
  return new Response('Method not allowed', { status: 405 });
}
