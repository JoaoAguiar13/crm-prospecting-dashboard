// Mudar a etapa de outreach de um lead: POST {leadId, status} → escreve no Close.
//
// Isto era um webhook do n8n (`update-outreach`). A 09/09/2026 esse fluxo está
// desligado, e como o browser o chamava directamente nem sequer chegava a sair
// do browser: o preflight CORS devolvia 500. Ou seja, mudar o estado de um
// lead — a acção mais usada da plataforma — não fazia nada há semanas.
//
// Não é preciso n8n para isto. A plataforma já fala com o Close por API directa
// (`lib/close.js`, que é o que serve os templates), e mudar a etapa é um PUT
// num campo. Menos uma peça, e uma que estava em baixo.
import { getSession } from '../lib/session.js';
import { close, CF, escolhaDaEtapa } from '../lib/close.js';
import { marcarEstadoNaCopia } from '../lib/leads.js';

const json = (body, status = 200) => Response.json(body, { status });

async function handler(req) {
  const s = await getSession(req);
  if (!s) return json({ error: 'Sem sessão.' }, 401);
  if (req.method !== 'POST') return json({ error: 'método não permitido' }, 405);

  const b = await req.json().catch(() => ({}));
  const leadId = String(b.leadId || '').trim();

  /*
   * `Number(null)` e `Number('')` são 0, que é uma etapa válida — «Não
   * contactado». Sem esta guarda, um pedido a que faltasse o `status` punha o
   * lead na primeira etapa em vez de ser recusado, e isso é perder trabalho
   * feito num lead a sério. O mesmo para `false` e para `[]`.
   */
  const status =
    typeof b.status === 'number' ? b.status
      : typeof b.status === 'string' && b.status.trim() !== '' ? Number(b.status)
        : NaN;

  if (!leadId) return json({ error: 'Falta o lead.' }, 400);
  if (!Number.isInteger(status) || status < 0 || status > 7) {
    return json({ error: `Etapa inválida: ${b.status}. As etapas vão de 0 a 7.` }, 400);
  }

  let etapa;
  try {
    etapa = await escolhaDaEtapa(status);
  } catch (e) {
    return json({ error: `Não consegui ler as etapas do Close: ${e.message}` }, 502);
  }
  if (!etapa) return json({ error: `O Close não tem nenhuma etapa com o número ${status}.` }, 400);

  try {
    await close(`/lead/${encodeURIComponent(leadId)}/`, { method: 'PUT', body: { [CF.etapa]: etapa } });
  } catch (e) {
    // A frase do Close vai inteira: é quem sabe o que correu mal.
    return json({ error: `O Close recusou a mudança de etapa. ${e.message}` }, 502);
  }

  /*
   * O Close já mudou. Se a cópia local não tiver este lead, dizemo-lo em vez de
   * fingir — a mudança está feita, mas a lista no ecrã só a mostra na próxima
   * leitura ao Close, que hoje depende de um fluxo do n8n que está desligado.
   */
  const naCopia = await marcarEstadoNaCopia(leadId, status);
  return json({ ok: true, status, etapa, naCopia });
}

export { handler as POST };
