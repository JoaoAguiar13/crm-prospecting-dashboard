// WhatsApp (Twilio, os três remetentes — ver SENDERS em lib/twilio.js):
// GET ?messages=1 → últimas mensagens dos três números, cada uma com `sender` · GET ?templates=1 → templates Content + estado de aprovação
// POST {to, body, sender?} → texto livre (só dentro da janela de 24 h) · POST {to, contentSid, variables, sender?} → template · POST {template:{name, body}} → regista template + pede aprovação Meta
import { getSession } from '../lib/session.js';
import { tw, SENDERS, MSG_URL } from '../lib/twilio.js';
import { explicarTwilio, estadoEmPortugues } from '../lib/erros-twilio.js';

export const maxDuration = 30;
const CONTENT = 'https://content.twilio.com/v1';
/*
 * As falhas de entrega (63016, 63024) não vêm na resposta ao envio — o Twilio
 * aceita a mensagem e só depois a marca `undelivered`. Portanto a explicação
 * tem de viajar com cada mensagem do histórico, não só com o erro do POST.
 */
const msg = m => ({ sid: m.sid, from: m.from, to: m.to, body: m.body, status: m.status, estado: estadoEmPortugues(m.status), dir: m.direction === 'inbound' ? 'in' : 'out', at: m.date_sent || m.date_created, err: m.error_code, erro: explicarTwilio(m.error_code) });

async function handler(req) {
  const s = await getSession(req); if (!s) return Response.json({ error: 'Sem sessão.' }, { status: 401 });
  const q = new URL(req.url).searchParams;
  try {
    if (req.method === 'GET') {
      if (q.has('templates')) {
        const d = await tw(`${CONTENT}/ContentAndApprovals?PageSize=100`);
        return Response.json({ templates: (d.contents || []).filter(c => c.types?.['twilio/text']).map(c => ({ sid: c.sid, name: c.friendly_name, body: c.types['twilio/text'].body, variables: c.variables || {}, status: c.approval_requests?.status || 'unsubmitted', category: c.approval_requests?.category || '', reason: c.approval_requests?.rejection_reason || '' })) });
      }
      /*
       * `since=YYYY-MM-DD` limita a janela; sem ele, os últimos SINCE_OMISSAO
       * dias. Nunca "tudo": o bot dos estudantes faz milhares de mensagens por mês e
       * uma página só leva 1000.
       *
       * E é por isso que isto pagina. A versão anterior pedia uma página de
       * 1000 por sentido e ficava-se por aí — medido a 04/09/2026, o número dos
       * estudantes estava EXACTAMENTE em 1000/1000, ou seja a cortar histórico
       * sem dizer nada. O pior não era faltar histórico antigo: era uma
       * conversa aparecer com metade das mensagens, e a janela de 24 h ser
       * calculada sobre a última mensagem que COUBE em vez da última que houve.
       *
       * O tecto de páginas existe para o pedido não crescer sem limite; quando
       * se lá chega, isso vai no `truncated` e a interface diz--o em vez de
       * fingir que aquilo é tudo.
       */
      const SINCE_OMISSAO = 7;
      const MAX_PAGINAS = 6; // 6000 mensagens por sentido e remetente
      const since = q.get('since');
      const corte = /^\d{4}-\d{2}-\d{2}$/.test(since || '')
        ? since
        : new Date(Date.now() - SINCE_OMISSAO * 86400e3).toISOString().slice(0, 10);

      let truncou = false;
      const buscarTudo = async (filtro, valor, k) => {
        const saida = [];
        let url = `${MSG_URL}?PageSize=1000&${filtro}=${encodeURIComponent(valor)}&DateSent%3E=${corte}`;
        for (let pagina = 0; pagina < MAX_PAGINAS && url; pagina++) {
          const d = await tw(url);
          for (const m of d.messages || []) saida.push({ ...msg(m), sender: k });
          // O Twilio devolve o caminho, não o URL completo.
          url = d.next_page_uri ? `https://api.twilio.com${d.next_page_uri}` : null;
          if (url && pagina === MAX_PAGINAS - 1) truncou = true;
        }
        return saida;
      };

      const pares = Object.entries(SENDERS);
      const lotes = await Promise.all(
        pares.flatMap(([k, s]) => [buscarTudo('From', s.wa, k), buscarTudo('To', s.wa, k)])
      );
      /*
       * Dedupe por (sid, sender): a mesma mensagem aparece no fetch From e no
       * To do próprio número. Mensagens entre dois números NOSSOS (não há caso
       * real) ficam só do lado que as enviou.
       */
      const vistos = new Set();
      const all = lotes.flat()
        .filter(m => { const c = m.sid + '|' + m.sender; if (vistos.has(c)) return false; vistos.add(c); return true; })
        .filter(m => (m.dir === 'in' ? m.from : m.to) !== SENDERS[m.sender].wa)
        .sort((x, y) => new Date(x.at) - new Date(y.at));
      const senders = Object.fromEntries(pares.map(([k, s]) => [k, { wa: s.wa, rotulo: s.rotulo, bot: s.bot }]));
      return Response.json(
        { senders, messages: all, since: corte, truncated: truncou },
        { headers: { 'cache-control': 'no-store' } }
      );
    }
    if (req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      if (b.template) {
        const name = String(b.template.name || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, ''), body = String(b.template.body || '').trim();
        if (!name || !body) return Response.json({ error: 'Nome e texto são obrigatórios.' }, { status: 400 });
        const vars = {}; for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) vars[m[1]] = m[1] === '1' ? 'Nome' : m[1] === '2' ? 'Empresa' : 'Valor';
        const c = await tw(`${CONTENT}/Content`, { json: { friendly_name: name, language: 'pt_PT', variables: vars, types: { 'twilio/text': { body } } } });
        const ap = await tw(`${CONTENT}/Content/${c.sid}/ApprovalRequests/whatsapp`, { json: { name, category: b.template.category === 'UTILITY' ? 'UTILITY' : 'MARKETING' } });
        return Response.json({ sid: c.sid, name, body, status: ap.status || 'pending' });
      }
      const to = 'whatsapp:' + String(b.to || '').replace(/^whatsapp:/, '').replace(/[^\d+]/g, '');
      if (!/^whatsapp:\+\d{8,}$/.test(to)) return Response.json({ error: 'Número inválido.' }, { status: 400 });
      const sender = SENDERS[b.sender || 'prospecao'];
      if (!sender) return Response.json({ error: 'Remetente desconhecido.' }, { status: 400 });
      const form = { From: sender.wa, To: to };
      if (b.contentSid) {
        // O Twilio recusa com 21656 quando as variaveis nao batem com o que o
        // template declara — e uma variavel vazia conta como nao bater. Melhor
        // dizer isso aqui do que deixar o erro chegar como "21656".
        const vars = b.variables || {};
        const vazias = Object.entries(vars).filter(([, x]) => !String(x ?? '').trim()).map(([k]) => k);
        if (vazias.length) return Response.json({ error: `Variaveis por preencher: ${vazias.map((k) => `{{${k}}}`).join(', ')}` }, { status: 400 });
        form.ContentSid = b.contentSid;
        form.ContentVariables = JSON.stringify(vars);
      }
      else { if (!String(b.body || '').trim()) return Response.json({ error: 'Mensagem vazia.' }, { status: 400 }); form.Body = String(b.body).trim(); }
      const m = await tw(MSG_URL, { form });
      return Response.json(msg(m));
    }
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  } catch (e) { return Response.json({ error: e.message }, { status: 502 }); }
}
export { handler as GET, handler as POST };
