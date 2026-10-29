// Tarefas do Close: GET lista as por fazer · POST cria · PATCH marca concluída.
//
// Eram três webhooks do n8n (`get-close-tasks`, `create-task`,
// `complete-task`), todos desligados a 09/09/2026. O separador Tarefas mostrava
// um erro e mais nada — e havia 64 tarefas por fazer no Close que ninguém via.
//
// Como na etapa do lead: não é preciso n8n. A plataforma já fala com o Close
// por API directa, e tarefas são um recurso normal lá.
import { getSession } from '../lib/session.js';
import { close } from '../lib/close.js';

const json = (body, status = 200) => Response.json(body, { status });
const limpar = (v) => String(v ?? '').trim();

/*
 * A forma que a interface já esperava do n8n. Mantida à letra para o
 * `renderTasks` não mudar: o que muda é de onde vem, não o que é.
 */
const paraOEcra = (t) => ({
  id: t.id,
  leadId: t.lead_id || '',
  leadName: t.lead_name || '',
  text: t.text || '',
  date: t.due_date || t.date || '',
  assignedTo: t.assigned_to_name || '',
  createdBy: t.created_by_name || '',
});

/** As datas do Close são YYYY-MM-DD. Uma data mal formada é recusada aqui. */
const dataValida = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);

async function handler(req) {
  const s = await getSession(req);
  if (!s) return json({ error: 'Sem sessão.' }, 401);

  if (req.method === 'GET') {
    try {
      /*
       * `_limit=200` é o tecto do Close por página. Com 64 tarefas abertas há
       * folga de sobra; se um dia passar de 200, o que falta fica de fora em
       * silêncio — por isso a resposta diz quantas há ao todo.
       * ponytail: uma página, que é o que este volume precisa. Paginar quando
       * o `total` passar o `_limit`.
       */
      const d = await close('/task/?_type=lead&is_complete=false&_limit=200');
      const tasks = (d.data || []).map(paraOEcra);
      return json({ tasks, total: d.total_results ?? tasks.length }, 200);
    } catch (e) {
      return json({ error: `Não consegui ler as tarefas do Close. ${e.message}` }, 502);
    }
  }

  const b = await req.json().catch(() => ({}));

  if (req.method === 'POST') {
    const leadId = limpar(b.leadId);
    const text = limpar(b.text);
    const date = limpar(b.date);
    if (!leadId) return json({ error: 'Falta o lead.' }, 400);
    if (!text) return json({ error: 'A tarefa precisa de um texto.' }, 400);
    if (!dataValida(date)) return json({ error: `Data inválida: ${b.date || '(vazia)'}. Usa AAAA-MM-DD.` }, 400);
    try {
      const t = await close('/task/', {
        method: 'POST',
        body: { _type: 'lead', lead_id: leadId, text, due_date: date },
      });
      return json({ task: paraOEcra(t) });
    } catch (e) {
      return json({ error: `O Close recusou criar a tarefa. ${e.message}` }, 502);
    }
  }

  if (req.method === 'PATCH') {
    const id = limpar(b.id);
    if (!id) return json({ error: 'Falta a tarefa.' }, 400);
    try {
      await close(`/task/${encodeURIComponent(id)}/`, { method: 'PUT', body: { is_complete: true } });
      return json({ ok: true, id });
    } catch (e) {
      return json({ error: `O Close recusou concluir a tarefa. ${e.message}` }, 502);
    }
  }

  return json({ error: 'método não permitido' }, 405);
}

export { handler as GET, handler as POST, handler as PATCH };
