// Escrever e enviar um email a uma empresa, à mão, a partir da ficha do lead.
//
//   GET  → { conta: { email, nome, minha } }  — de que conta é que o email sai.
//   POST { leadId, contactId, subject, bodyHtml } → envia pelo Close.
//
// Substitui o email de campanha. Esse saía do n8n, do nó «Email 1 (Close)» da
// «Unilinkr - Sequência Outreach», com o mesmo pedido que está aqui em baixo:
// POST /activity/email/ com status 'outbox', que põe o email na fila de envio
// do Close e o deixa na ficha do lead, com aberturas.
//
// A diferença é quem escreve o meio. O assunto, a saudação e a despedida
// continuam a ser o template do Close — editável lá e na secção Campanhas.
//
// O QUE ESTE SERVIDOR NÃO ACEITA DO CLIENTE, e porquê:
//
// A lição está no que o `api/outreach.js` fazia: o cliente mandava o id do
// template e o servidor mandava-o a qualquer lead, porque a ligação
// campanha→lead só existia na interface. Aqui o cliente diz QUEM, não O QUÊ
// DE QUEM: o endereço de destino nunca vem no pedido — é lido do contacto no
// Close, depois de se confirmar que o contacto é mesmo daquele lead.
//
// Isto manda um email a uma empresa a sério e não se desfaz.
import { getSession } from '../lib/session.js';
import { close, CF, escolhaDaEtapa } from '../lib/close.js';
import { marcarEstadoNaCopia } from '../lib/leads.js';

const json = (body, status = 200) => Response.json(body, { status });
const limpar = (v) => String(v ?? '').trim();

/*
 * O sítio onde falta escrever.
 *
 * Os dois templates de campanha do Close trazem `[[meio]]` numa linha entre a
 * apresentação e o pedido de reunião. Não é sintaxe do Close — passa pelo
 * render intacto (medido a 18/09/2026), e é isso que o torna útil: marca onde
 * o texto personalizado entra, e é editável no Close como o resto do template.
 *
 * O servidor recusa um corpo que ainda o tenha lá. Um email que chega a uma
 * empresa a dizer «[[meio]]» é pior do que um erro no ecrã.
 */
export const MARCA_DO_MEIO = '[[meio]]';

/*
 * O lembrete de seguimento, que era o dia 7 da sequência.
 *
 * A cadeia do n8n agendava três contactos: email (dia 0), WhatsApp (dia 4) e
 * uma tarefa de chamada (dia 7). Saíram os três juntos, porque vinham todos no
 * mesmo botão — mas só o primeiro é que o comercial pediu para tirar.
 *
 * O WhatsApp não volta: é um template aprovado pela Meta, ou seja texto igual
 * para toda a gente, que é o que se está a acabar. Quem quiser mandar um manda-o
 * pelo separador Conversas.
 *
 * A tarefa volta, porque não é um contacto com a empresa — é um despertador
 * para a equipa, e esquecer-se de voltar a um lead é o defeito mais caro que
 * este funil tem.
 *
 * O que NÃO volta é a maquinaria. A cadeia esperava quatro dias, relia o lead,
 * esperava mais três e só então criava a tarefa — dezoito nós e duas esperas
 * para uma linha de texto no Close. Aqui a tarefa nasce no momento do envio,
 * datada para daqui a uma semana. Não há nada a correr entretanto, portanto não
 * há nada que possa falhar entretanto.
 *
 * Sete dias porque é a cadência que a equipa já conhece e que a Wiki descreve.
 */
const DIAS_ATE_AO_SEGUIMENTO = 7;

const daquiA = (dias) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

/*
 * Texto visível de um bocado de HTML, para saber se está vazio.
 *
 * Um corpo vindo de um campo editável nunca vem literalmente vazio: vem
 * `<div><br></div>`, ou um `&nbsp;` sozinho. Contar caracteres do HTML dava
 * «tem 17 caracteres» a um email em branco.
 */
export const textoVisivel = (html) =>
  String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim();

/*
 * Guarda de repetição, o mesmo padrão do `ultimoDisparo` que estava no
 * `api/outreach.js`.
 *
 * O botão fica desactivado no cliente, mas volta a ficar clicável no `catch`,
 * e duas abas ou um `curl` dispensam-no de todo. Dois cliques seguidos são
 * dois emails à mesma pessoa.
 *
 * A chave é lead+contacto: escrever a duas pessoas da mesma empresa de
 * seguida é legítimo; escrever duas vezes à mesma não é.
 *
 * ponytail: um Map em memória, que é o que um processo só precisa. Com várias
 * instâncias cada uma teria o seu — aí, o carimbo teria de ir para o Close.
 */
const JANELA_DE_REPETICAO = 60_000;
const ultimoEnvio = new Map();

export const esquecerEnvios = () => ultimoEnvio.clear();

/*
 * De que conta sai o email.
 *
 * O n8n tinha o `email_account_id` do responsável comercial fixo no workflow. A pergunta certa
 * era se cada pessoa pode enviar da sua — e a resposta, medida a 18/09/2026, é
 * que não dá:
 *
 *   GET /email_account/  devolve UMA conta: comercial@empresa.example.
 *   GET /me/             diz que a CLOSE_API_KEY é do responsável comercial.
 *   GET /user/           não tem o comercial de todo (nem em unilinkr.net).
 *
 * Uma chave do Close é de uma pessoa, e só pode enviar pelas contas de email
 * dessa pessoa. Para o comercial enviar dele, faltam duas coisas que não se fazem a
 * partir daqui: ser utilizador do Close, e ligar lá a caixa de correio dele.
 *
 * Portanto sai do responsável comercial — e a interface diz isso antes de a pessoa escrever, em
 * vez de a deixar pensar que assinou o email.
 */
let contas = null;

export const esquecerContas = () => { contas = null; };

async function lerContas() {
  if (contas) return contas;
  const d = await close('/email_account/');
  contas = (d.data || []).filter(
    (c) => (c.enabled_features || []).includes('email_sending') && c.send_status !== 'error',
  );
  if (!contas.length) throw new Error('Não há nenhuma conta de email no Close que possa enviar.');
  return contas;
}

/** A conta por onde o email sai, e se é a de quem está a escrever. */
async function contaDe(emailDaSessao) {
  const todas = await lerContas();
  const meu = String(emailDaSessao || '').toLowerCase();
  const minha = todas.find(
    (c) =>
      String(c.email || '').toLowerCase() === meu ||
      (c.identities || []).some((i) => String(i.email || '').toLowerCase() === meu),
  );
  const c = minha || todas[0];
  const id = c.default_identity || (c.identities || [])[0] || { email: c.email };
  return {
    id: c.id,
    email: id.email || c.email,
    nome: id.name || '',
    minha: !!minha,
    remetente: id.name ? `${id.name} <${id.email || c.email}>` : id.email || c.email,
  };
}

async function handler(req) {
  const s = await getSession(req);
  if (!s) return json({ error: 'Sem sessão.' }, 401);

  if (req.method === 'GET') {
    try {
      const { email, nome, minha } = await contaDe(s.email);
      return json({ conta: { email, nome, minha } }, 200);
    } catch (e) {
      return json({ error: `Não consegui saber de que conta sai o email. ${e.message}` }, 502);
    }
  }
  if (req.method !== 'POST') return json({ error: 'método não permitido' }, 405);

  const b = await req.json().catch(() => ({}));
  const leadId = limpar(b.leadId);
  const contactId = limpar(b.contactId);
  const subject = limpar(b.subject);
  const bodyHtml = String(b.bodyHtml ?? '');

  if (!/^lead_/.test(leadId)) return json({ error: 'Falta o lead, ou o identificador não é de um lead.' }, 400);
  if (!/^cont_/.test(contactId)) return json({ error: 'Falta a pessoa, ou o identificador não é de um contacto.' }, 400);
  if (!subject) return json({ error: 'O assunto está vazio.' }, 400);
  if (subject.length > 300) return json({ error: `O assunto tem ${subject.length} caracteres; o máximo são 300.` }, 400);
  if (!textoVisivel(bodyHtml)) return json({ error: 'O corpo do email está vazio.' }, 400);
  if (bodyHtml.includes(MARCA_DO_MEIO)) {
    return json({ error: `Falta escrever o meio do email — o ${MARCA_DO_MEIO} ainda lá está.` }, 400);
  }

  /*
   * O contacto tem de ser daquele lead, e o endereço sai daqui — não do pedido.
   *
   * Sem isto, um pedido feito à mão com um `contactId` de outra empresa
   * mandava o email de uma a outra, e ficava registado na ficha errada.
   */
  let lead;
  try {
    lead = await close(
      `/lead/${encodeURIComponent(leadId)}/?_fields=${encodeURIComponent(`id,display_name,contacts,${CF.etapa}`)}`,
    );
  } catch (e) {
    return json({ error: `Não consegui ler o lead no Close. Nada foi enviado. ${e.message}` }, 502);
  }

  const contacto = (lead.contacts || []).find((c) => c.id === contactId);
  if (!contacto) {
    return json({ error: 'Essa pessoa não é um contacto deste lead. Nada foi enviado.' }, 400);
  }
  const para = ((contacto.emails || [])[0] || {}).email;
  if (!para) {
    return json({ error: `${contacto.name || 'A pessoa escolhida'} não tem email no Close.` }, 400);
  }

  const agora = Date.now();
  const chave = `${leadId}:${contactId}`;
  for (const [k, t] of ultimoEnvio) if (agora - t > JANELA_DE_REPETICAO) ultimoEnvio.delete(k);
  const anterior = ultimoEnvio.get(chave);
  if (anterior !== undefined) {
    const faltam = Math.ceil((JANELA_DE_REPETICAO - (agora - anterior)) / 1000);
    return json(
      {
        error: `Já foi enviado um email a ${contacto.name || para} há ${Math.round((agora - anterior) / 1000)} s. Espera ${faltam} s — senão recebe dois.`,
      },
      409,
    );
  }
  ultimoEnvio.set(chave, agora);

  let conta;
  try {
    conta = await contaDe(s.email);
  } catch (e) {
    ultimoEnvio.delete(chave);
    return json({ error: `Não consegui saber de que conta enviar. Nada foi enviado. ${e.message}` }, 502);
  }

  let enviado;
  try {
    enviado = await close('/activity/email/', {
      method: 'POST',
      body: {
        lead_id: leadId,
        contact_id: contactId,
        email_account_id: conta.id,
        status: 'outbox',
        sender: conta.remetente,
        to: [para],
        subject,
        body_html: bodyHtml,
      },
    });
  } catch (e) {
    // Não saiu, portanto não há repetição a impedir.
    ultimoEnvio.delete(chave);
    return json({ error: `O Close recusou o email. Nada foi enviado. ${e.message}` }, 502);
  }

  /*
   * «Enviado» só se o Close o disser.
   *
   * Um 200 com um corpo que não tem `id` não é um email na fila de saída; é um
   * corpo que não percebi. O defeito que isto evita é o mesmo do
   * `api/outreach.js`: dizer «enviado» a partir de uma resposta que não se leu.
   */
  if (!enviado?.id) {
    ultimoEnvio.delete(chave);
    return json({ error: 'O Close respondeu, mas sem confirmar o email. Vê a ficha do lead antes de repetir.' }, 502);
  }

  /*
   * A Etapa 1 no Close, que a sequência marcava e agora ninguém marcava.
   *
   * Os contadores de «Enviados» das campanhas contam Etapa ≥ 1 (campStats, no
   * index.html). Sem isto, escrever à mão não aparecia em lado nenhum.
   *
   * Só sobe, nunca desce: escrever a um lead que já vai na chamada (etapa 3)
   * não o pode mandar para trás. E se esta parte falhar, o email JÁ saiu —
   * portanto diz-se o que aconteceu em vez de se devolver um erro que faz
   * parecer que não saiu nada.
   */
  /*
   * Daqui para baixo o email JÁ SAIU.
   *
   * Nada do que falhe a seguir pode virar um erro: um 502 depois do envio faz
   * quem escreveu pensar que não saiu nada, e escrever outra vez. Por isso os
   * problemas viajam como avisos, e a resposta continua a ser `ok`.
   */
  const avisos = [];

  const etapaAgora = Number(String(lead[CF.etapa] ?? '').match(/^\s*(\d+)/)?.[1] ?? 0);
  let etapa = null;
  if (etapaAgora < 1) {
    try {
      etapa = await escolhaDaEtapa(1);
      await close(`/lead/${encodeURIComponent(leadId)}/`, { method: 'PUT', body: { [CF.etapa]: etapa } });
      await marcarEstadoNaCopia(leadId, 1);
    } catch (e) {
      etapa = null;
      avisos.push(`a etapa não mudou para «Primeiro contacto» (${e.message})`);
    }
  }

  /* A tarefa de seguimento. `seguimento: false` no pedido salta-a. */
  let seguimento = null;
  if (b.seguimento !== false) {
    const telefone = ((contacto.phones || [])[0] || {}).phone || '';
    const quem = contacto.name || para;
    const onde = lead.display_name || '';
    const texto = `Ligar a ${quem}${onde ? ` — ${onde}` : ''}${telefone ? ` (${telefone})` : ''} — sem resposta ao email de ${daquiA(0)}`;
    const data = daquiA(DIAS_ATE_AO_SEGUIMENTO);
    try {
      const t = await close('/task/', {
        method: 'POST',
        body: { _type: 'lead', lead_id: leadId, text: texto, due_date: data },
      });
      seguimento = { id: t.id, data };
    } catch (e) {
      avisos.push(`a tarefa de seguimento não foi criada (${e.message})`);
    }
  }

  return json({
    ok: true,
    id: enviado.id,
    estado: enviado.status || 'outbox',
    para,
    de: conta.email,
    etapa,
    seguimento,
    aviso: avisos.length ? `O email saiu, mas ${avisos.join(' e ')}.` : undefined,
  });
}

export { handler as GET, handler as POST };
