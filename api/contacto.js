// Criar um contacto num lead do Close: POST {leadId, name, title?, email?, phone?}.
//
// Era o webhook `create-contact` do n8n, desligado a 09/09/2026 e chamado do
// browser, onde o preflight CORS devolvia 500. Usava-o a ficha do lead e o
// enrichment em lote — os dois calados.
import { getSession } from '../lib/session.js';
import { close } from '../lib/close.js';

const json = (body, status = 200) => Response.json(body, { status });
const limpar = (v) => String(v ?? '').trim();

async function handler(req) {
  const s = await getSession(req);
  if (!s) return json({ error: 'Sem sessão.' }, 401);
  if (req.method !== 'POST') return json({ error: 'método não permitido' }, 405);

  const b = await req.json().catch(() => ({}));
  const leadId = limpar(b.leadId);
  const name = limpar(b.name);
  const email = limpar(b.email);
  const phone = limpar(b.phone);
  const title = limpar(b.title);

  if (!/^lead_/.test(leadId)) return json({ error: 'Falta o lead, ou o identificador não é de um lead.' }, 400);
  if (!name) return json({ error: 'O contacto precisa de um nome.' }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: `Email inválido: ${email}` }, 400);

  /*
   * Um contacto sem forma de o contactar não serve para nada, e enche o Close
   * de nomes soltos. Vale mais dizê-lo do que gravar.
   */
  if (!email && !phone) return json({ error: 'O contacto precisa de um email ou de um telefone.' }, 400);

  try {
    const c = await close('/contact/', {
      method: 'POST',
      body: {
        lead_id: leadId,
        name,
        title: title || undefined,
        emails: email ? [{ email, type: 'office' }] : [],
        phones: phone ? [{ phone, type: 'office' }] : [],
      },
    });
    return json({ id: c.id, name: c.name || name, title, email, phone });
  } catch (e) {
    return json({ error: `O Close recusou criar o contacto. ${e.message}` }, 502);
  }
}

export { handler as POST };
