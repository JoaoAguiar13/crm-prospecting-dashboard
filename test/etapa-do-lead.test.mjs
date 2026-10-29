/*
 * A etapa de um lead passa a ir direto ao Close, sem n8n.
 *
 * O que se testa aqui é tudo o que acontece ANTES de falar com o Close (a
 * validação) e DEPOIS (a cópia em cache). A chamada ao Close em si foi provada
 * ao vivo a 10/09/2026: escrevi a mesma etapa que lá estava, e depois uma ida e
 * volta 0 → 6 → 0 pela interface, confirmada nos dois sentidos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SESSION_SECRET = 'segredo-so-para-os-testes-da-etapa';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'etapa-lead-'));
delete process.env.ACCESS_CODE;
delete process.env.CLOSE_API_KEY; // sem chave, qualquer ida ao Close falha — e é isso que quero

const { sign } = await import('../lib/session.js');
const { writeJson } = await import('../lib/store.js');
const { POST } = await import('../api/lead-status.js');

const cookie = `session=${await sign({ email: 'admin@empresa.example', admin: true })}`;

const pedir = async (corpo, comSessao = true) => {
  const r = await POST(new Request('https://exemplo/api/lead-status', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(comSessao ? { cookie } : {}) },
    body: JSON.stringify(corpo),
  }));
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
};

test('sem sessao nao passa', async () => {
  assert.equal((await pedir({ leadId: 'lead_x', status: 1 }, false)).status, 401);
});

test('uma etapa fora de 0..7 e recusada antes de tocar no Close', async () => {
  for (const mau of [8, 99, -1, 1.5, 'dois', null, undefined]) {
    const r = await pedir({ leadId: 'lead_x', status: mau });
    assert.equal(r.status, 400, `${mau} devia ser recusado`);
    assert.match(r.corpo.error, /etapa/i);
    assert.match(r.corpo.error, /0 a 7/);
  }
});

test('a etapa 7 (Cliente / Parceiro) passa a validacao e vai ao Close', async () => {
  // Sem CLOSE_API_KEY a ida ao Close falha: um 502 prova que a validacao deixou passar.
  const r = await pedir({ leadId: 'lead_x', status: 7 });
  assert.equal(r.status, 502);
  assert.doesNotMatch(r.corpo.error, /inv[aá]lida/i);
});

test('uma etapa acrescentada no Close depois da primeira leitura aparece sem reiniciar', async () => {
  const { escolhaDaEtapa, esquecerEtapas } = await import('../lib/close.js');
  const fetchReal = globalThis.fetch;
  let escolhas = ['0 - Não contactado', '4 - Reunião / Resposta', '6 - Para Reciclar'];
  let leituras = 0;
  process.env.CLOSE_API_KEY = 'chave-falsa';
  globalThis.fetch = async () => {
    leituras++;
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: escolhas }) };
  };
  try {
    esquecerEtapas();
    assert.equal(await escolhaDaEtapa(4), '4 - Reunião / Resposta');
    assert.equal(await escolhaDaEtapa(4), '4 - Reunião / Resposta');
    assert.equal(leituras, 1, 'uma etapa que existe nao volta a ler o Close');

    escolhas = [...escolhas, '7 - Cliente / Parceiro']; // alguem acrescentou-a no Close
    assert.equal(await escolhaDaEtapa(7), '7 - Cliente / Parceiro');
    assert.equal(leituras, 2);

    assert.equal(await escolhaDaEtapa(5), undefined, 'a que nao existe continua a nao existir');
  } finally {
    globalThis.fetch = fetchReal;
    delete process.env.CLOSE_API_KEY;
    esquecerEtapas();
  }
});

test('sem lead e recusado', async () => {
  const r = await pedir({ status: 1 });
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /lead/i);
});

test('a mensagem diz o que veio, para quem vende perceber o que escreveu', async () => {
  const r = await pedir({ leadId: 'lead_x', status: 42 });
  assert.match(r.corpo.error, /42/, 'a frase tem de repetir o valor recusado');
});

test('sem CLOSE_API_KEY o erro diz isso, em vez de rebentar', async () => {
  const r = await pedir({ leadId: 'lead_x', status: 3 });
  assert.equal(r.status, 502);
  assert.match(r.corpo.error, /CLOSE_API_KEY|Close/i);
  assert.doesNotMatch(r.corpo.error, /undefined|\[object/i);
});

test('a copia em cache muda so o estado, e nao a idade', async () => {
  const { marcarEstadoNaCopia } = await import('../lib/leads.js');
  const quando = Date.now() - 5 * 24 * 3600 * 1000; // cinco dias, como na producao
  await writeJson('leads-cache.json', {
    at: quando,
    text: JSON.stringify({
      escolas: [{ id: 'lead_e1', name: 'Escola A', status: 0 }],
      empresas: [{ id: 'lead_c1', name: 'Empresa A', status: 2 }],
    }),
  });

  assert.equal(await marcarEstadoNaCopia('lead_c1', 5), true);

  const { readJson } = await import('../lib/store.js');
  const d = await readJson('leads-cache.json', null);
  const dados = JSON.parse(d.text);
  assert.equal(dados.empresas[0].status, 5, 'o estado tem de mudar');
  assert.equal(dados.escolas[0].status, 0, 'os outros ficam como estavam');
  assert.equal(d.at, quando, 'a idade NAO pode saltar: os outros campos continuam velhos');
});

test('um lead que nao esta na copia devolve false, em vez de fingir', async () => {
  const { marcarEstadoNaCopia } = await import('../lib/leads.js');
  assert.equal(await marcarEstadoNaCopia('lead_que_nao_existe', 1), false);
});
