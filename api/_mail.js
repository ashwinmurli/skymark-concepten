/* Gedeelde mailfuncties (Resend) voor de posttool en de templatepagina.
   Bestanden die met _ beginnen worden door Vercel niet als losse functie uitgerold. */

export const PEOPLE = {
  approver: [
    { name: 'Esmée', email: 'etenhove@amvest.nl' },
    { name: 'Camille', email: 'cstijlaart@amvest.nl' }
  ],
  maker: [
    { name: 'Ash', email: 'ash@connectingthepolkadots.com' },
    { name: 'Celine', email: 'celinepoulussen.work@gmail.com' }
  ]
};

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mailHtml({ eyebrow, title, intro, quote, rows, cta, link }) {
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

export function mailText({ title, intro, quote, rows, link }) {
  return [title, '', intro, quote ? '\n"' + quote + '"' : '', '', ...(rows || []).filter(r => r && r[1]).map(r => `${r[0]}: ${r[1]}`), '', link].join('\n');
}

export async function sendMail(to, subject, content) {
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

export function others(role, by) {
  const b = String(by || '').trim().toLowerCase();
  return PEOPLE[role].filter(p => !b || !b.startsWith(p.name.toLowerCase()));
}
