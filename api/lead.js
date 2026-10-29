// Escreve no lead do Close: POST {id, campanha?, variante?, website?, description?} (null/'' limpa o campo)
import { getSession } from '../lib/session.js';
import { close, CF } from '../lib/close.js';

export async function POST(req) {
  const s = await getSession(req); if (!s) return Response.json({ error: 'Sem sessão.' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!/^lead_/.test(b.id || '')) return Response.json({ error: 'id inválido' }, { status: 400 });
  const body = {};
  if ('campanha' in b) body[CF.campanha] = b.campanha || null;
  if ('variante' in b) body[CF.variante] = ['A', 'B'].includes(b.variante) ? b.variante : null;
  if ('website' in b && b.website) body.url = String(b.website).trim();
  if ('description' in b && b.description) body.description = String(b.description).slice(0, 2000);
  if (!Object.keys(body).length) return Response.json({ error: 'nada para escrever' }, { status: 400 });
  try { const l = await close(`/lead/${b.id}/`, { method: 'PUT', body }); return Response.json({ id: l.id, campanha: l[CF.campanha] || '', variante: l[CF.variante] || '' }); }
  catch (e) { return Response.json({ error: e.message }, { status: 502 }); }
}
