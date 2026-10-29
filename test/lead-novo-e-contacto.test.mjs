/*
 * Criar leads e contactos no Close, sem n8n.
 *
 * Aqui testa-se a validação e a busca de coordenadas. As idas ao Close foram
 * provadas ao vivo a 10/09/2026: lead criado no Porto com as coordenadas certas
 * (41.157, -8.6296), contacto criado nele, e os dois apagados no fim.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SESSION_SECRET = 'segredo-so-para-os-testes-do-lead-novo';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'lead-novo-'));
delete process.env.ACCESS_CODE;
delete process.env.CLOSE_API_KEY;

const { sign } = await import('../lib/session.js');
const { writeJson } = await import('../lib/store.js');
const { coordenadasDaCidade, coordenadasDaMorada, juntarLeadNaCopia } = await import('../lib/leads.js');
const { POST: criarLead } = await import('../api/lead-novo.js');
const { POST: criarContacto } = await import('../api/contacto.js');

const cookie = `session=${await sign({ email: 'admin@empresa.example', admin: true })}`;

const pedir = async (fn, corpo, comSessao = true) => {
  const r = await fn(new Request('https://exemplo/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(comSessao ? { cookie } : {}) },
    body: JSON.stringify(corpo),
  }));
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
};

const semearCache = () => writeJson('leads-cache.json', {
  at: Date.now(),
  text: JSON.stringify({
    escolas: [{ id: 'lead_e1', name: 'Escola', city: 'Porto', lat: 41.15, lng: -8.61, status: 0 }],
    empresas: [
      { id: 'lead_c1', name: 'A', city: 'Porto', lat: 41.17, lng: -8.63, status: 0 },
      { id: 'lead_c2', name: 'B', city: 'Lisboa', lat: 38.72, lng: -9.14, status: 0 },
      { id: 'lead_c3', name: 'C', city: 'Braga', lat: '', lng: '', status: 0 },
    ],
  }),
});

test('sem sessao nao passa', async () => {
  assert.equal((await pedir(criarLead, { type: 'empresa', name: 'X', city: 'Porto' }, false)).status, 401);
  assert.equal((await pedir(criarContacto, { leadId: 'lead_x', name: 'X', email: 'a@b.pt' }, false)).status, 401);
});

test('um lead sem tipo, nome ou cidade e recusado, e a frase diz o que falta', async () => {
  const semTudo = await pedir(criarLead, {});
  assert.equal(semTudo.status, 400);
  for (const p of [/tipo/i, /nome/i, /cidade/i]) assert.match(semTudo.corpo.error, p);

  const soFalta = await pedir(criarLead, { type: 'empresa', name: 'X' });
  assert.match(soFalta.corpo.error, /cidade/i);
  assert.doesNotMatch(soFalta.corpo.error, /nome/i, 'nao pode pedir o que ja foi dado');
});

test('um tipo que nao existe e recusado', async () => {
  for (const t of ['pessoa', '', 'ESCOLAS', null]) {
    assert.equal((await pedir(criarLead, { type: t, name: 'X', city: 'Porto' })).status, 400);
  }
});

test('um contacto sem forma de o contactar e recusado', async () => {
  const r = await pedir(criarContacto, { leadId: 'lead_x', name: 'Alguem' });
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /email ou.*telefone/i);
});

test('um id que nao e de lead e recusado antes de sair daqui', async () => {
  const r = await pedir(criarContacto, { leadId: 'cont_abc', name: 'X', email: 'a@b.pt' });
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /lead/i);
});

test('as coordenadas saem da media dos leads da mesma cidade', async () => {
  await semearCache();
  const porto = await coordenadasDaCidade('Porto');
  assert.equal(porto.aPartirDe, 2, 'os dois leads do Porto');
  assert.equal(porto.lat, 41.16);
  assert.equal(porto.lng, -8.62);

  const lisboa = await coordenadasDaCidade('lisboa'); // maiusculas nao contam
  assert.equal(lisboa.aPartirDe, 1);
});

test('uma cidade sem coordenadas utilizaveis devolve null, em vez de NaN', async () => {
  await semearCache();
  assert.equal(await coordenadasDaCidade('Braga'), null, 'os leads de Braga nao tem lat/lng');
  assert.equal(await coordenadasDaCidade('Vila Nova de Foz Côa'), null);
  assert.equal(await coordenadasDaCidade(''), null);
});

test('juntar o mesmo lead duas vezes nao o duplica', async () => {
  await semearCache();
  const novo = { id: 'lead_novo', name: 'Novo', city: 'Porto', status: 0 };
  assert.equal(await juntarLeadNaCopia('empresas', novo), true);
  assert.equal(await juntarLeadNaCopia('empresas', novo), true);
  const { readJson } = await import('../lib/store.js');
  const d = JSON.parse((await readJson('leads-cache.json', null)).text);
  assert.equal(d.empresas.filter((r) => r.id === 'lead_novo').length, 1);
});

test('sem CLOSE_API_KEY os erros dizem isso, sem rebentar', async () => {
  await semearCache();
  const r = await pedir(criarLead, { type: 'empresa', name: 'X', city: 'Porto' });
  assert.equal(r.status, 502);
  assert.match(r.corpo.error, /Close/);
  assert.doesNotMatch(r.corpo.error, /undefined|\[object/i);
});

/*
 * A morada, pelo Photon. O `fetch` é falso: a resposta tem a forma do que o
 * Photon devolveu a 28/09/2026 para uma escola, tal como o comercial a escreveu.
 */
const photon = (...pontos) => async () => Response.json({
  features: pontos.map(([lat, lng, pais]) => ({ geometry: { coordinates: [lng, lat] }, properties: { countrycode: pais } })),
});
const comFetch = async (falso, fn) => {
  const antes = globalThis.fetch;
  globalThis.fetch = falso;
  try { return await fn(); } finally { globalThis.fetch = antes; }
};
const PORTO = { lat: 41.157107, lng: -8.62968 };

test('a morada encontrada manda no pin', async () => {
  const c = await comFetch(photon([41.1801234, -8.6812347, 'PT']),
    () => coordenadasDaMorada('Rua do Exemplo 100 Matosinhos 4450-000', 'Porto', PORTO));
  assert.deepEqual(c, { lat: 41.180123, lng: -8.681235 });
});

test('um resultado fora de Portugal ou longe da cidade salta-se', async () => {
  const c = await comFetch(photon([40.4, -3.7, 'ES'], [40.66, -7.91, 'PT'], [41.15, -8.59, 'PT']),
    () => coordenadasDaMorada('Rua Direita 1', 'Porto', PORTO));
  assert.deepEqual(c, { lat: 41.15, lng: -8.59 }, 'Madrid e Viseu ficam de fora');

  const nada = await comFetch(photon([40.66, -7.91, 'PT']), () => coordenadasDaMorada('Rua Direita 1', 'Porto', PORTO));
  assert.equal(nada, null, 'so Viseu: antes o pin da cidade do que a rua errada');

  // Cidade nova, sem media para comparar: so o filtro do pais protege.
  const semRef = await comFetch(photon([40.4, -3.7, 'ES'], [40.66, -7.91, 'PT']), () => coordenadasDaMorada('Rua Direita 1', 'Viseu'));
  assert.deepEqual(semRef, { lat: 40.66, lng: -7.91 });
});

test('sem morada ou sem resultados devolve null; com o Photon em baixo, atira', async () => {
  let chamou = false;
  assert.equal(await comFetch(async () => { chamou = true; }, () => coordenadasDaMorada('  ', 'Porto', PORTO)), null);
  assert.equal(chamou, false, 'sem morada nem se pergunta');
  assert.equal(await comFetch(photon(), () => coordenadasDaMorada('Rua X', 'Porto')), null);
  // «Nao existe» e «nao sei» sao coisas diferentes, e quem chama tem de as distinguir.
  await assert.rejects(comFetch(async () => { throw new TypeError('fetch failed'); }, () => coordenadasDaMorada('Rua X', 'Porto')));
  await assert.rejects(comFetch(async () => new Response('', { status: 503 }), () => coordenadasDaMorada('Rua X', 'Porto')), /503/);
});
