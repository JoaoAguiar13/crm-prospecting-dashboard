/*
 * Escrever um email à mão e enviá-lo pelo Close.
 *
 * Isto manda um email a uma empresa a sério e não se desfaz, portanto o que
 * aqui se prova não é «a função corre»: é que o servidor não aceita do cliente
 * nada que decida a QUEM o email vai, e que só diz «enviado» depois de ler a
 * resposta do Close.
 *
 * O Close é falsificado pelo `fetch` global — é por aí que o `lib/close.js`
 * fala com ele, portanto intercetar aqui cobre o caminho inteiro sem mexer em
 * nada por dentro. Nenhum destes testes toca num lead a sério.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SESSION_SECRET = 'segredo-so-para-os-testes-do-email';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'email-a-mao-'));
process.env.CLOSE_API_KEY = 'chave-falsa-so-para-os-testes';

const { sign } = await import('../lib/session.js');
const { esquecerEtapas } = await import('../lib/close.js');
const { GET, POST, esquecerEnvios, esquecerContas, textoVisivel } = await import('../api/email.js');

const cookie = `session=${await sign({ email: 'consultor@exemplo.com', admin: true })}`;

const CONTA = 'emailacct_teste';
const LEAD = 'lead_aSP0teste';
const CONTACTO = 'cont_BsdXteste';
const OUTRO_CONTACTO = 'cont_de_outra_empresa';
const ETAPA = 'custom.cf_Exemplo0001';

/* O que o Close falso viu, para se poder afirmar o que saiu — e o que não saiu. */
let visto;
/* Respostas que um teste pode trocar para simular o Close a portar-se mal. */
let close;

const resposta = (corpo, ok = true, status = 200) => ({
  ok, status, text: async () => JSON.stringify(corpo),
});

beforeEach(() => {
  visto = { emails: [], puts: [], tarefas: [] };
  close = {
    etapaDoLead: '0 - Nao contactado',
    aoEnviar: () => resposta({ id: 'acti_enviado', status: 'outbox' }),
    aoMudarEtapa: () => resposta({ id: LEAD }),
    aoCriarTarefa: () => resposta({ id: 'task_criada' }),
  };
  esquecerEnvios();
  esquecerContas();
  esquecerEtapas();

  globalThis.fetch = async (url, opcoes = {}) => {
    const u = String(url);
    const metodo = opcoes.method || 'GET';
    const corpo = opcoes.body ? JSON.parse(opcoes.body) : null;

    if (u.includes('/email_account/')) {
      return resposta({ data: [{
        id: CONTA,
        email: 'comercial@empresa.example',
        enabled_features: ['email_sending'],
        send_status: 'ok',
        default_identity: { email: 'comercial@empresa.example', name: 'Nome Apelido' },
      }] });
    }
    if (u.includes('/custom_field/lead/')) {
      return resposta({ choices: ['0 - Nao contactado', '1 - Email enviado', '2 - WhatsApp 1 enviado'] });
    }
    if (u.includes('/activity/email/')) {
      visto.emails.push(corpo);
      return close.aoEnviar();
    }
    if (u.includes('/task/')) {
      visto.tarefas.push(corpo);
      return close.aoCriarTarefa();
    }
    if (u.includes(`/lead/${LEAD}/`) && metodo === 'PUT') {
      visto.puts.push(corpo);
      return close.aoMudarEtapa();
    }
    if (u.includes(`/lead/${LEAD}/`)) {
      return resposta({
        id: LEAD,
        display_name: 'Restaurante Exemplo',
        [ETAPA]: close.etapaDoLead,
        contacts: [{
          id: CONTACTO, name: 'Ana Ribeiro',
          emails: [{ email: 'ana@exemplo.pt' }],
          phones: [{ phone: '+351900000006' }],
        }],
      });
    }
    throw new Error('o teste não previu esta chamada ao Close: ' + metodo + ' ' + u);
  };
});

const bom = {
  leadId: LEAD, contactId: CONTACTO,
  subject: 'Estudantes universitários - Restaurante Exemplo X Unilinkr',
  bodyHtml: '<div>Bom dia Ana,</div><div>Tenho uma proposta para a vossa equipa de sala.</div>',
};

const enviar = async (corpo, comSessao = true) => {
  const r = await POST(new Request('https://exemplo/api/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(comSessao ? { cookie } : {}) },
    body: JSON.stringify(corpo),
  }));
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
};

test('sem sessao nao passa, e nada sai', async () => {
  assert.equal((await enviar(bom, false)).status, 401);
  assert.equal(visto.emails.length, 0);
});

test('o que e recusado antes de tocar no Close', async () => {
  const maus = [
    [{ ...bom, leadId: '' }, /lead/i],
    [{ ...bom, leadId: 'cont_trocado' }, /lead/i],
    [{ ...bom, contactId: '' }, /pessoa|contacto/i],
    [{ ...bom, contactId: 'lead_trocado' }, /pessoa|contacto/i],
    [{ ...bom, subject: '   ' }, /assunto/i],
    [{ ...bom, subject: 'x'.repeat(301) }, /assunto|300/],
    [{ ...bom, bodyHtml: '' }, /corpo/i],
    [{ ...bom, bodyHtml: '<div><br></div>' }, /corpo/i],
    [{ ...bom, bodyHtml: '<div>&nbsp;</div>' }, /corpo/i],
  ];
  for (const [corpo, frase] of maus) {
    const r = await enviar(corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo).slice(0, 60));
    assert.match(r.corpo.error, frase);
  }
  assert.equal(visto.emails.length, 0, 'nenhum destes podia ter chegado ao Close');
});

test('um corpo que ainda tem o [[meio]] e recusado — nao vai assim para uma empresa', async () => {
  const r = await enviar({ ...bom, bodyHtml: '<div>Bom dia,</div><div>[[meio]]</div><div>Cumprimentos</div>' });
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /\[\[meio\]\]/);
  assert.equal(visto.emails.length, 0);
});

test('o contacto tem de ser DAQUELE lead', async () => {
  const r = await enviar({ ...bom, contactId: OUTRO_CONTACTO });
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /nao e|não é/i);
  assert.equal(visto.emails.length, 0, 'um contacto de outra empresa nao podia ter gerado envio nenhum');
});

test('o destino sai do Close, nunca do pedido', async () => {
  const r = await enviar({ ...bom, to: ['atacante@exemplo.com'], email: 'atacante@exemplo.com' });
  assert.equal(r.status, 200);
  assert.deepEqual(visto.emails[0].to, ['ana@exemplo.pt']);
  assert.equal(r.corpo.para, 'ana@exemplo.pt');
});

test('o envio leva o que o no do n8n levava', async () => {
  const r = await enviar(bom);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  const e = visto.emails[0];
  assert.equal(e.lead_id, LEAD);
  assert.equal(e.contact_id, CONTACTO);
  assert.equal(e.email_account_id, CONTA);
  assert.equal(e.status, 'outbox');
  assert.equal(e.subject, bom.subject);
  assert.equal(e.body_html, bom.bodyHtml);
  assert.match(e.sender, /comercial@empresa\.example/);
});

test('nao se manda o mesmo email duas vezes seguidas a mesma pessoa', async () => {
  assert.equal((await enviar(bom)).status, 200);
  const segundo = await enviar(bom);
  assert.equal(segundo.status, 409);
  assert.match(segundo.corpo.error, /espera|segundos|s —|há/i);
  assert.equal(visto.emails.length, 1, 'so um email podia ter saido');
});

test('a guarda e por pessoa: outra pessoa da mesma empresa passa', async () => {
  globalThis.fetch = (
    (original) => async (url, opcoes) => {
      const u = String(url);
      if (u.includes(`/lead/${LEAD}/`) && (opcoes?.method || 'GET') === 'GET') {
        return resposta({
          id: LEAD, [ETAPA]: close.etapaDoLead,
          contacts: [
            { id: CONTACTO, name: 'Ana', emails: [{ email: 'ana@exemplo.pt' }] },
            { id: 'cont_segundo', name: 'Pedro', emails: [{ email: 'pedro@exemplo.pt' }] },
          ],
        });
      }
      return original(url, opcoes);
    }
  )(globalThis.fetch);

  assert.equal((await enviar(bom)).status, 200);
  assert.equal((await enviar({ ...bom, contactId: 'cont_segundo' })).status, 200);
  assert.equal(visto.emails.length, 2);
});

test('«enviado» so se o Close confirmar com um id', async () => {
  close.aoEnviar = () => resposta({ status: 'outbox' }); // 200, mas sem id
  const r = await enviar(bom);
  assert.equal(r.status, 502);
  assert.doesNotMatch(r.corpo.error, /^Email enviado/i);
  assert.match(r.corpo.error, /sem confirmar|antes de repetir/i);
  assert.equal(r.corpo.ok, undefined);
});

test('se o Close recusar, diz que nada foi enviado e deixa repetir', async () => {
  close.aoEnviar = () => resposta({ error: 'sem permissao' }, false, 403);
  const r = await enviar(bom);
  assert.equal(r.status, 502);
  assert.match(r.corpo.error, /[Nn]ada foi enviado/);

  close.aoEnviar = () => resposta({ id: 'acti_enviado', status: 'outbox' });
  assert.equal((await enviar(bom)).status, 200, 'uma falha nao pode trancar a segunda tentativa');
});

test('um lead por contactar sobe a Etapa 1 — e os «Enviados» da campanha contam-no', async () => {
  const r = await enviar(bom);
  assert.equal(r.corpo.etapa, '1 - Email enviado');
  assert.equal(visto.puts.length, 1);
  assert.equal(visto.puts[0][ETAPA], '1 - Email enviado');
});

test('escrever a um lead que ja vai na chamada nao o manda para tras', async () => {
  close.etapaDoLead = '3 - Chamada';
  const r = await enviar(bom);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.etapa, null);
  assert.equal(visto.puts.length, 0, 'a etapa 3 nao podia ter sido escrita por cima');
});

test('se a etapa falhar depois do envio, o email JA saiu — e diz-se isso', async () => {
  close.aoMudarEtapa = () => resposta({ error: 'campo bloqueado' }, false, 400);
  const r = await enviar(bom);
  assert.equal(r.status, 200, 'nao pode ser um erro: o email saiu mesmo');
  assert.equal(r.corpo.ok, true);
  assert.match(r.corpo.aviso, /saiu/i);
  assert.match(r.corpo.aviso, /etapa/i);
});

/*
 * O seguimento.
 *
 * Era o dia 7 da cadeia do n8n — a única das três coisas que o botão fazia que
 * não é um contacto com a empresa. A cadeia esperava uma semana para a criar;
 * aqui nasce no envio, datada para daqui a uma semana.
 */
test('enviar cria a tarefa de seguimento, daqui a sete dias', async () => {
  const r = await enviar(bom);
  assert.equal(r.status, 200);
  assert.equal(visto.tarefas.length, 1);
  const t = visto.tarefas[0];
  assert.equal(t._type, 'lead');
  assert.equal(t.lead_id, LEAD);
  assert.match(t.text, /Ana Ribeiro/);
  assert.match(t.text, /Restaurante Exemplo/);
  assert.match(t.text, /\+351900000006/, 'o telefone do contacto tem de lá estar, para se ligar sem ir procurar');

  const esperada = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  assert.equal(t.due_date, esperada);
  assert.equal(r.corpo.seguimento.data, esperada);
});

test('quem nao quiser seguimento tira a cruz, e nao se cria nada', async () => {
  const r = await enviar({ ...bom, seguimento: false });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.seguimento, null);
  assert.equal(visto.tarefas.length, 0);
  assert.equal(visto.emails.length, 1, 'o email sai na mesma');
});

test('um contacto sem telefone nao deixa parenteses vazios na tarefa', async () => {
  globalThis.fetch = ((original) => async (url, opcoes) => {
    const u = String(url);
    if (u.includes(`/lead/${LEAD}/`) && (opcoes?.method || 'GET') === 'GET') {
      return resposta({
        id: LEAD, display_name: 'Restaurante Exemplo', [ETAPA]: close.etapaDoLead,
        contacts: [{ id: CONTACTO, name: 'Ana Ribeiro', emails: [{ email: 'ana@exemplo.pt' }] }],
      });
    }
    return original(url, opcoes);
  })(globalThis.fetch);

  await enviar(bom);
  assert.doesNotMatch(visto.tarefas[0].text, /\(\s*\)/);
  assert.match(visto.tarefas[0].text, /Ana Ribeiro/);
});

test('se a tarefa falhar, o email JA saiu — e o aviso diz as duas coisas', async () => {
  close.aoMudarEtapa = () => resposta({ error: 'campo bloqueado' }, false, 400);
  close.aoCriarTarefa = () => resposta({ error: 'sem permissao' }, false, 403);
  const r = await enviar(bom);
  assert.equal(r.status, 200, 'nada disto pode virar erro: o email saiu');
  assert.equal(r.corpo.ok, true);
  assert.match(r.corpo.aviso, /etapa/i);
  assert.match(r.corpo.aviso, /tarefa/i);
  assert.match(r.corpo.aviso, /saiu/i);
});

test('o GET diz de que conta sai, e que nao e a de quem escreve', async () => {
  const r = await GET(new Request('https://exemplo/api/email', { headers: { cookie } }));
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.conta.email, 'comercial@empresa.example');
  assert.equal(d.conta.minha, false, 'o comercial nao tem caixa ligada ao Close');
});

test('textoVisivel nao conta moldura como texto', () => {
  assert.equal(textoVisivel('<div><br></div>'), '');
  assert.equal(textoVisivel('<div>&nbsp;</div>'), '');
  assert.equal(textoVisivel(''), '');
  assert.equal(textoVisivel('<div>Bom dia</div>'), 'Bom dia');
});
