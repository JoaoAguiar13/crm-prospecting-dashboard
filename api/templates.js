// Email templates do Close (fonte única dos emails, editáveis no Close e aqui):
// GET → lista · GET ?id= → template · GET ?id=&lead=[&contact=] → renderizado para o lead · POST {id?, name, subject, body} → cria/atualiza
import { getSession } from '../lib/session.js';
import { close } from '../lib/close.js';

const pick = t => ({ id: t.id, name: t.name, subject: t.subject, body: t.body, updated: t.date_updated, archived: t.is_archived });

async function handler(req) {
  const s = await getSession(req); if (!s) return Response.json({ error: 'Sem sessão.' }, { status: 401 });
  const q = new URL(req.url).searchParams;
  try {
    if (req.method === 'GET') {
      const id = q.get('id');
      if (!id) { const d = await close('/email_template/?_fields=id,name,subject,date_updated,is_archived&_limit=200'); return Response.json({ templates: d.data.filter(t => !t.is_archived).map(pick) }); }
      if (q.get('lead')) { const d = await close(`/email_template/${id}/render/?lead_id=${q.get('lead')}${q.get('contact') ? '&contact_id=' + q.get('contact') : ''}`); return Response.json({ subject: d.subject, body: d.body }); }
      return Response.json(pick(await close(`/email_template/${id}/`)));
    }
    if (req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const body = { name: String(b.name || '').trim(), subject: String(b.subject || '').trim(), body: String(b.body || ''), is_shared: true };
      if (!body.name || !body.subject) return Response.json({ error: 'Nome e assunto são obrigatórios.' }, { status: 400 });
      const t = b.id ? await close(`/email_template/${b.id}/`, { method: 'PUT', body }) : await close('/email_template/', { method: 'POST', body });
      return Response.json(pick(t));
    }
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  } catch (e) { return Response.json({ error: e.message }, { status: 502 }); }
}
export { handler as GET, handler as POST };
