/*
 * O que as campanhas têm de recusar.
 *
 * Medido a 10/09/2026 contra a instância local: um nome de 5000 caracteres era
 * aceite e ia inteiro para o Close, onde fica como valor de uma lista de
 * escolhas. E um DELETE sem `id` devolvia 200 sem apagar nada — um «correu
 * bem» que não correu.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SESSION_SECRET = 'segredo-so-para-os-testes-das-campanhas';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'campanhas-'));
delete process.env.ACCESS_CODE;
delete process.env.CLOSE_API_KEY; // o sync das escolhas falha e é apanhado; não deve partir nada

const { sign } = await import('../lib/session.js');
const { writeJson, readJson } = await import('../lib/store.js');
const { GET, POST, DELETE } = await import('../api/campaigns.js');

const cookie = `session=${await sign({ email: 'admin@empresa.example', admin: true })}`;

const pedir = async (fn, metodo, corpo, comSessao = true) => {
  const r = await fn(new Request('https://exemplo/api/campaigns', {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(comSessao ? { cookie } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  }));
  return { status: r.status, corpo: await r.json().catch(() => ({})) };
};

const semear = () => writeJson('campanhas.json', {
  campaigns: [{ id: 'cmp_1', name: 'Empresas 2026', tipo: 'Empresa', estado: 'ativa' }],
});

test('sem sessao nao passa', async () => {
  assert.equal((await pedir(GET, 'GET', undefined, false)).status, 401);
});

test('um nome sem fim e recusado, e a frase diz o tamanho', async () => {
  await semear();
  const r = await pedir(POST, 'POST', { name: 'x'.repeat(5000) });
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /5000/, 'diz quantos tem');
  assert.match(r.corpo.error, /80/, 'e quantos podia ter');
  const d = await readJson('campanhas.json', null);
  assert.equal(d.campaigns.length, 1, 'nao pode ter gravado nada');
});

test('oitenta caracteres passam; oitenta e um nao', async () => {
  await semear();
  assert.equal((await pedir(POST, 'POST', { name: 'a'.repeat(80) })).status, 200);
  assert.equal((await pedir(POST, 'POST', { name: 'b'.repeat(81) })).status, 400);
});

test('um DELETE sem id e recusado, em vez de dizer que correu bem', async () => {
  await semear();
  const r = await pedir(DELETE, 'DELETE', {});
  assert.equal(r.status, 400);
  assert.match(r.corpo.error, /que campanha/i);
  const d = await readJson('campanhas.json', null);
  assert.equal(d.campaigns.length, 1, 'a campanha tem de continuar la');
});

test('apagar uma campanha que nao existe da 404', async () => {
  await semear();
  const r = await pedir(DELETE, 'DELETE', { id: 'cmp_que_nao_existe' });
  assert.equal(r.status, 404);
  assert.equal((await readJson('campanhas.json', null)).campaigns.length, 1);
});

test('apagar uma que existe apaga mesmo', async () => {
  await semear();
  assert.equal((await pedir(DELETE, 'DELETE', { id: 'cmp_1' })).status, 200);
  assert.equal((await readJson('campanhas.json', null)).campaigns.length, 0);
});

test('o nome continua a nao poder ser vazio nem repetido', async () => {
  await semear();
  assert.equal((await pedir(POST, 'POST', { name: '   ' })).status, 400);
  assert.equal((await pedir(POST, 'POST', { name: 'Empresas 2026' })).status, 400);
});
