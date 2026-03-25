export const config = { runtime: 'edge' };

export default async function handler(req) {
  // Only allow POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Verify editor secret
  const { html, secret } = await req.json();
  if (secret !== process.env.EDITOR_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!html || html.length < 1000) {
    return new Response('Invalid HTML', { status: 400 });
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = 'ashwinmurli/skymark-concepten';
  const branch = 'main';
  const filePath = 'index.html';

  // Get current file SHA (needed for update)
  const getResp = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`,
    { headers: { Authorization: `token ${token}`, 'User-Agent': 'skymark-editor' } }
  );

  if (!getResp.ok) {
    return new Response(`GitHub GET error: ${getResp.status}`, { status: 500 });
  }

  const fileData = await getResp.json();
  const sha = fileData.sha;

  // Encode HTML to base64
  const encoded = btoa(unescape(encodeURIComponent(html)));

  // Push update
  const putResp = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'skymark-editor'
      },
      body: JSON.stringify({
        message: `Editor update ${new Date().toISOString().slice(0,16).replace('T',' ')}`,
        content: encoded,
        sha: sha,
        branch: branch
      })
    }
  );

  if (!putResp.ok) {
    const err = await putResp.text();
    return new Response(`GitHub PUT error: ${err}`, { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
