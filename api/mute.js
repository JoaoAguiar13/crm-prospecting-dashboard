// Assumir/devolver uma conversa do bot das empresas: POST {phone, action}
// action: 'take-over' cala o bot nessa conversa; 'resume' devolve-lha.
// Backend: UNILINKR_API_URL + UNILINKR_API_TOKEN (o mesmo par do api/job.js).
import { getSession } from '../lib/session.js';
import { DEMO, muteDemo } from '../lib/demo.js';

export const maxDuration = 15;
const API = () => (process.env.UNILINKR_API_URL || 'https://api.exemplo.com').replace(/\/$/, '');

async function handler(req) {
  const s = await getSession(req); if (!s) return Response.json({ error: 'Sem sessão.' }, { status: 401 });
  if (DEMO) return muteDemo(req);
  const token = process.env.UNILINKR_API_TOKEN;
  if (!token) return Response.json({ error: 'UNILINKR_API_TOKEN em falta no Vercel — pedir ao administrador.' }, { status: 501 });

  /*
   * GET → que conversas estão caladas neste momento. A plataforma pergunta-o ao
   * carregar as conversas: sem isso não sabe o que já assumiu, mostra "assumir"
   * numa conversa já calada, e o único caminho até "devolver" é assumir outra
   * vez. Falha em silêncio de propósito — não saber o estado do mute não pode
   * impedir ninguém de ver as conversas.
   */
  if (req.method === 'GET') {
    try {
      const r = await fetch(`${API()}/v1/assisted-onboarding/conversations/muted`, {
        headers: { 'x-unilinkr-api-key': token },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return Response.json({ muted: [] });
      return Response.json({ muted: (d.data || d).muted || [] });
    } catch { return Response.json({ muted: [] }); }
  }

  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const b = await req.json().catch(() => ({}));
  const action = b.action === 'resume' ? 'resume' : 'take-over';
  if (!b.phone) return Response.json({ error: 'phone é obrigatório.' }, { status: 400 });
  try {
    const r = await fetch(`${API()}/v1/assisted-onboarding/conversations/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-unilinkr-api-key': token },
      body: JSON.stringify({ phone: b.phone, actor: 'prospecao:' + (s.email || 'desconhecido') }),
    });
    const d = await r.json().catch(() => ({}));
    /*
     * A mensagem do backend passa como está. A primeira versão substituía o 404
     * por um texto fixo ("o bot não tem conversa com esse número") e assim
     * deitava fora a única coisa útil: o backend sabe distinguir um número de
     * OPERADOR — cujas mensagens vão para a consola e nunca criam conversa de
     * bot — de um número que o bot nunca viu. Com a conversa à vista no ecrã, o
     * texto fixo parecia avaria.
     */
    if (!r.ok) {
      return Response.json({ error: d.message || d.error || `backend HTTP ${r.status}` }, { status: r.status === 404 ? 404 : 502 });
    }
    return Response.json(d.data || d);
  } catch (e) { return Response.json({ error: e.message }, { status: 502 }); }
}
export { handler as GET, handler as POST };
