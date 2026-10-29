// Publicar trabalho na Unilinkr a partir do chat: POST {leadId, company, contact, job, price_cents?} → backend cria o draft e devolve link Stripe (ou publica logo)
// GET ?uuid= → estado do pedido. Backend: UNILINKR_API_URL + UNILINKR_API_TOKEN (assisted-onboarding integration token).
import { getSession } from '../lib/session.js';
import { DEMO } from '../lib/demo.js';

export const maxDuration = 30;
const API = () => (process.env.UNILINKR_API_URL || 'https://api.exemplo.com').replace(/\/$/, '');

async function backend(path, body) {
  const token = process.env.UNILINKR_API_TOKEN; if (!token) throw new Error('UNILINKR_API_TOKEN em falta no Vercel');
  const r = await fetch(API() + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-unilinkr-api-key': token }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  /*
   * Dois 404 diferentes, e confundi-los manda o comercial atrás do problema
   * errado. Um Express sem rota devolve HTML, portanto `d` fica vazio: é a rota
   * que falta. O backend, quando a rota existe e o pedido não, devolve o
   * envelope JSON com `message`: é o pedido que não existe.
   *
   * A distinção passou a importar quando a rota foi escrita (09/09/2026); até
   * aí só havia o primeiro caso.
   */
  if (r.status === 404 && !d.message) throw new Error('HTTP 404: a rota de publicação não existe no backend');
  if (!r.ok) throw new Error(d.message || d.error || `backend HTTP ${r.status}`);
  return d.data || d; // envelope {status:'SUCCESS', data}
}

async function handler(req) {
  const s = await getSession(req); if (!s) return Response.json({ error: 'Sem sessão.' }, { status: 401 });
  if (DEMO) return Response.json({ error: 'Publicar trabalhos no backend não está disponível no modo demo.' }, { status: 501 });
  try {
    if (req.method === 'GET') { const uuid = new URL(req.url).searchParams.get('uuid'); if (!uuid) return Response.json({ error: 'uuid' }, { status: 400 }); return Response.json(await backend('/v1/assisted-onboarding/publish-request/' + encodeURIComponent(uuid))); }
    const b = await req.json().catch(() => ({}));
    const j = b.job || {}, need = ['title', 'description', 'city', 'start_date', 'end_date', 'payment_frequency', 'amount'].filter(k => !j[k]);
    if (need.length || !b.company?.name || !b.company?.email || !b.company?.phone) return Response.json({ error: 'Faltam: ' + [...need, ...(!b.company?.name ? ['empresa'] : []), ...(!b.company?.email ? ['email'] : []), ...(!b.company?.phone ? ['telefone'] : [])].join(', ') }, { status: 400 });
    const d = await backend('/v1/assisted-onboarding/publish-request', { source: 'prospecting', external_ref: b.leadId, company: b.company, contact: b.contact || {}, job: j, price_cents: b.price_cents || undefined, requested_by: s.email });
    return Response.json(d);
  } catch (e) { return Response.json({ error: e.message }, { status: 502 }); }
}
export { handler as GET, handler as POST };
