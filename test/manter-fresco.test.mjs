/*
 * A lista tem de se refrescar sozinha.
 *
 * Só refrescava quando alguém carregava em «Atualizar» ou quando o webhook do
 * Close disparava — e o webhook não dispara, porque falta a `CLOSE_WEBHOOK_KEY`.
 * Medido a 10/09/2026: a lista tinha cinco dias e não havia caminho nenhum
 * para a pôr fresca sem alguém se lembrar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'manter-fresco-'));
process.env.SESSION_SECRET = 'segredo-so-para-os-testes-do-refresco';

/*
 * Uma chave falsa, e não nenhuma.
 *
 * Isto apagava a `CLOSE_API_KEY`, porque com ela apagada o refresco falhava e
 * era isso que se queria testar. Enquanto a lista vinha do n8n, a primeira
 * coisa que o refresco fazia era um `fetch`, e por isso «houve pedido?»
 * continuava a ser um sinal fiável de «tentou».
 *
 * A 20/09/2026 a lista passou a vir direto do Close, e o `lib/close.js` recusa
 * ANTES de chamar o `fetch` quando a chave não existe. Sem chave nenhuma, o
 * `fetch` que estes testes intercetam deixava de ser chamado em qualquer caso
 * — e quatro deles passariam a provar exactamente nada, incluindo o que conta
 * pedidos para garantir que uma cópia fresca não manda ninguém a lado nenhum.
 *
 * Com uma chave falsa o caminho corre até ao fim e é o `fetch` intercetado que
 * decide o que acontece, que é o que estes testes querem mandar.
 */
process.env.CLOSE_API_KEY = 'chave-falsa-so-para-os-testes-do-refresco';

const { writeJson, readJson } = await import('../lib/store.js');
const { manterFresco, esquecerCopia } = await import('../lib/leads.js');

const semear = (idadeMs) => writeJson('leads-cache.json', {
  at: Date.now() - idadeMs,
  text: JSON.stringify({ escolas: [{ id: 'lead_e', name: 'Escola', status: 0 }], empresas: [] }),
});

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test('uma copia fresca nao e tocada — nem um pedido sai', async () => {
  /*
   * Confirmar pelo `at` não chegava: o refresco falha e o `at` fica igual de
   * qualquer maneira, portanto o teste passava mesmo sem a guarda da idade. O
   * que prova a guarda é não sair pedido nenhum.
   */
  await semear(60_000); // um minuto
  let chamadas = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { chamadas++; throw new Error('nao devia ter sido chamado'); };
  try {
    const parar = manterFresco({ deVezEmQuando: 50, velhaAoFimDe: 10 * 60_000 });
    await esperar(250);
    parar();
    assert.equal(chamadas, 0, 'uma cópia fresca não manda ninguém a lado nenhum');
  } finally { globalThis.fetch = original; }
});

test('uma copia velha e tentada, e um refresco falhado NAO estraga o que ha', async () => {
  /*
   * O refresco falha (o `fetch` abaixo rebenta). O que não pode acontecer é a
   * cópia velha desaparecer: vale mais uma lista de cinco dias do que um ecrã
   * vazio, e o rodapé diz a idade.
   */
  await semear(60 * 60_000); // uma hora
  const antes = await readJson('leads-cache.json', null);
  const parar = manterFresco({ deVezEmQuando: 50, velhaAoFimDe: 10 * 60_000 });
  await esperar(300);
  parar();
  const depois = await readJson('leads-cache.json', null);
  assert.equal(depois.at, antes.at, 'a idade fica como estava: o refresco falhou');
  assert.equal(depois.text, antes.text, 'e os leads continuam lá');
});

test('nao se atropela a si proprio', async () => {
  /*
   * Duas voltas do temporizador não podem lançar dois refrescos ao mesmo
   * tempo: são 14 pedidos ao Close cada um.
   */
  await semear(60 * 60_000);
  let chamadas = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { chamadas++; await esperar(400); throw new Error('lento e falhado'); };
  try {
    const parar = manterFresco({ deVezEmQuando: 30, velhaAoFimDe: 1000 });
    await esperar(250); // seriam ~8 voltas
    parar();
    await esperar(500);
    assert.ok(chamadas <= 1, `so podia ter chamado uma vez, chamou ${chamadas}`);
  } finally { globalThis.fetch = original; }
});

test('sem copia nenhuma, tenta na mesma', async () => {
  /*
   * O `esquecerCopia()` é o que faz este teste valer. O `memoria` do módulo
   * sobrevive de teste para teste, e sem o limpar isto corria com a cópia de
   * uma hora que o teste anterior deixou — passava por causa dela, e não por
   * causa do que afirma.
   */
  await writeJson('leads-cache.json', { at: 0, text: '' });
  esquecerCopia();
  let tentou = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { tentou = true; throw new Error('sem rede'); };
  try {
    const parar = manterFresco({ deVezEmQuando: 50, velhaAoFimDe: 1000 });
    await esperar(200);
    parar();
    assert.equal(tentou, true, 'uma copia inexistente e infinitamente velha');
  } finally { globalThis.fetch = original; }
});

/*
 * O caminho que corre bem.
 *
 * Todos os testes acima mandam o `fetch` rebentar, portanto nenhum provava o
 * que acontece quando o refresco FUNCIONA — e a 20/09/2026 a função foi
 * reescrita para ler direto do Close. Tirar-lhe a gravação no disco não
 * derrubava teste nenhum.
 */
const { refreshLeads } = await import('../lib/leads.js');
const { CF } = await import('../lib/close.js');

const doClose = (nome, tipo) => ({
  id: `lead_${nome}`, display_name: nome, url: '', status_label: 'Outreach',
  addresses: [{ city: 'Porto' }], contacts: [],
  [CF.tipo]: tipo, [CF.etapa]: '0 - Nao contactado',
});

test('um refresco que corre bem grava no disco e fica fresco', async () => {
  await semear(60 * 60_000);
  const antes = await readJson('leads-cache.json', null);
  esquecerCopia();

  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({
      total_results: 2,
      data: [doClose('Escola Nova', 'Escola'), doClose('Empresa Nova', 'Empresa')],
    }),
  });
  try {
    const r = await refreshLeads();
    assert.equal(r.fonte, 'close');

    /*
     * A gravação é de propósito «fire and forget»: o disco não pode atrasar um
     * pedido que já tem a resposta em memória. Logo, quando o `refreshLeads`
     * devolve, o ficheiro ainda pode não ter mudado — esperar é o que torna
     * esta asserção sobre o disco honesta em vez de intermitente.
     */
    await esperar(50);
    const depois = await readJson('leads-cache.json', null);
    assert.ok(depois.at > antes.at, 'a idade tem de avançar: a lista é nova');
    const dados = JSON.parse(depois.text);
    assert.equal(dados.escolas.length, 1);
    assert.equal(dados.empresas.length, 1);
    assert.equal(dados.escolas[0].name, 'Escola Nova');
    assert.equal(dados.empresas[0].name, 'Empresa Nova');
  } finally { globalThis.fetch = original; esquecerCopia(); }
});

test('um refresco falhado nao deixa a memoria vazia', async () => {
  /*
   * A cópia em disco já estava protegida. A que está em memória não estava, e
   * é essa que serve os pedidos: esvaziá-la num `catch` dava um ecrã sem leads
   * até ao próximo reinício, com o disco cheio na mesma.
   */
  await semear(60 * 60_000);
  esquecerCopia();
  const { cache } = await import('../lib/leads.js');
  const antes = await cache().get('text');

  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('sem rede'); };
  try {
    // Pelo `manterFresco`, que é onde vive o `catch` — chamar o `refreshLeads`
    // directamente saltava-o, e o teste passava sem provar nada.
    const parar = manterFresco({ deVezEmQuando: 50, velhaAoFimDe: 1000 });
    await esperar(200);
    parar();
    assert.equal(await cache().get('text'), antes, 'a cópia em memória tem de sobreviver');
  } finally { globalThis.fetch = original; }
});

test('parar para mesmo', async () => {
  await semear(60 * 60_000);
  let chamadas = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => { chamadas++; throw new Error('x'); };
  try {
    const parar = manterFresco({ deVezEmQuando: 30, velhaAoFimDe: 1000 });
    await esperar(150);
    parar();
    const depoisDeParar = chamadas;
    await esperar(200);
    assert.equal(chamadas, depoisDeParar, 'nao pode continuar a tentar depois de parado');
  } finally { globalThis.fetch = original; }
});
