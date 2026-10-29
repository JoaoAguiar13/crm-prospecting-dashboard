/*
 * O que se comprime e o que não.
 *
 * Medido a 11/09/2026 contra a produção: o `/api/leads` são 0,75 MB de JSON e
 * saíam sem compressão nenhuma — 8 a 40 segundos por leitura, contra 0,2 s do
 * `?at=1`, que é pequeno. No fio, depois: 783 KB → 213 KB.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { talvezComprimir } from '../lib/comprimir.js';

const pedido = (encoding) => ({ headers: { 'accept-encoding': encoding } });
const jsonGrande = Buffer.from(JSON.stringify({ leads: Array.from({ length: 400 }, (_, i) => ({ id: i, nome: 'Restaurante da Esquina' })) }));
const tipoJson = { 'content-type': 'application/json' };

test('um JSON grande comprime, e volta a ser o mesmo', () => {
  const r = talvezComprimir(pedido('gzip'), null, tipoJson, jsonGrande);
  assert.equal(r.headers['content-encoding'], 'gzip');
  assert.ok(r.corpo.length < jsonGrande.length / 2, 'tem de encolher para menos de metade');
  assert.deepEqual(gunzipSync(r.corpo), jsonGrande, 'e descomprimir tem de dar o original, byte a byte');
});

test('o vary vai junto, senao uma cache serve gzip a quem nao o pediu', () => {
  const r = talvezComprimir(pedido('gzip'), null, tipoJson, jsonGrande);
  assert.equal(r.headers.vary, 'accept-encoding');
});

test('quem nao pede gzip recebe o original', () => {
  for (const e of ['identity', '', undefined, 'br', 'deflate']) {
    const r = talvezComprimir(pedido(e), null, tipoJson, jsonGrande);
    assert.equal(r.headers['content-encoding'], undefined, `«${e}» nao devia comprimir`);
    assert.equal(r.corpo, jsonGrande);
  }
});

test('um corpo pequeno nao se comprime: o cabecalho custa mais do que poupa', () => {
  const pequeno = Buffer.from('{"at":1757600000000}');
  const r = talvezComprimir(pedido('gzip'), null, tipoJson, pequeno);
  assert.equal(r.headers['content-encoding'], undefined);
  assert.equal(r.corpo, pequeno);
});

test('so se comprime o que e texto', () => {
  const grande = Buffer.alloc(50000, 7);
  for (const tipo of ['image/png', 'application/pdf', 'font/woff2', 'application/octet-stream']) {
    const r = talvezComprimir(pedido('gzip'), null, { 'content-type': tipo }, grande);
    assert.equal(r.headers['content-encoding'], undefined, tipo);
  }
  for (const tipo of ['text/html; charset=utf-8', 'application/json', 'text/css', 'application/javascript', 'image/svg+xml']) {
    const r = talvezComprimir(pedido('gzip'), null, { 'content-type': tipo }, Buffer.from('a'.repeat(9000)));
    assert.equal(r.headers['content-encoding'], 'gzip', tipo);
  }
});

test('se comprimir nao encolher, manda-se o original', () => {
  // Bytes aleatórios não comprimem; gastar CPU para mandar MAIS seria o pior dos dois.
  const ruido = Buffer.from(Array.from({ length: 40000 }, () => Math.floor(Math.random() * 256)));
  const r = talvezComprimir(pedido('gzip'), null, tipoJson, ruido);
  assert.equal(r.headers['content-encoding'], undefined);
  assert.equal(r.corpo.length, ruido.length);
});

test('sem content-type nao se adivinha', () => {
  const r = talvezComprimir(pedido('gzip'), null, {}, jsonGrande);
  assert.equal(r.headers['content-encoding'], undefined);
});

test('os cabecalhos que ja la estavam sobrevivem', () => {
  const cab = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-cache-age': '42' };
  const r = talvezComprimir(pedido('gzip'), null, cab, jsonGrande);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-cache-age'], '42');
});
