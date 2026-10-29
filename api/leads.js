// GET → JSON dos leads do cache (miss → vai ao n8n) · ?at=1 → só a versão (timestamp do último refresh, 20 bytes) · ?refresh=1 → força ir ao n8n.
// O cache é regravado por /api/close-hook sempre que o Close muda um lead/contacto; o browser faz ping a ?at=1 e só descarrega o JSON quando a versão mudou.
import { cache, refreshLeads } from '../lib/leads.js';

export const maxDuration = 60;
const json = (text, at) => new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-cache-at': String(at), 'x-cache-age': String(Math.round((Date.now() - at) / 1000)), 'x-hook': process.env.CLOSE_WEBHOOK_KEY ? '1' : '0' } });

export async function GET(req) {
  const q = new URL(req.url).searchParams, c = cache();
  if (q.has('at')) return Response.json({ at: (await c.get('at')) || 0 }, { headers: { 'cache-control': 'no-store' } });
  if (!q.has('refresh')) { const [text, at] = await Promise.all([c.get('json'), c.get('at')]); if (text) return json(text, at || 0); }
  try { const { text, at } = await refreshLeads(); return json(text, at); }
  catch (e) { return Response.json({ error: e.message }, { status: 502 }); }
}
