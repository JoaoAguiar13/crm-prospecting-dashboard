/*
 * Os pins acompanham a morada, mesmo quando ela é escrita directamente no Close.
 *
 * A 28/09/2026 havia leads com morada e sem pin, e corrigir a morada no Close
 * não mexia no pin. O Photon é um `fetch` falso; a escrita no Close é um espião.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'pins-'));

const { writeJson, readJson } = await import('../lib/store.js');
const { acertarPins, esquecerCopia } = await import('../lib/leads.js');

const PORTO = [
  { id: 'lead_a', name: 'A', address: 'Rua A 1', city: 'Porto', lat: 41.16, lng: -8.62 },
  { id: 'lead_b', name: 'B', address: 'Rua B 2', city: 'Porto', lat: 41.14, lng: -8.64 },
];

async function semear(empresas) {
  await writeJson('leads-cache.json', { at: Date.now(), text: JSON.stringify({ escolas: [], empresas }) });
  esquecerCopia();
}
const copia = async () => JSON.parse((await readJson('leads-cache.json', null)).text).empresas;

/** Um Photon que responde sempre o mesmo ponto em Portugal, e conta as perguntas. */
function photon(lat = 41.15, lng = -8.59) {
  const f = async () => { f.n++; return Response.json({ features: [{ geometry: { coordinates: [lng, lat] }, properties: { countrycode: 'PT' } }] }); };
  f.n = 0;
  return f;
}
async function comFetch(falso, fn) {
  const antes = globalThis.fetch;
  globalThis.fetch = falso;
  try { return await fn(); } finally { globalThis.fetch = antes; }
}
const espiao = () => { const e = async (id, c) => { e.escritas.push({ id, ...c }); }; e.escritas = []; return e; };

test('primeira volta: os pins que ja existem ficam, os que faltam aparecem', async () => {
  await writeJson('moradas-vistas.json', null);
  await semear([...PORTO, { id: 'lead_sem', name: 'Sem', address: 'Rua C 3', city: 'Porto', lat: '', lng: '' }]);
  const f = photon(), escrever = espiao();
  const feitos = await comFetch(f, () => acertarPins({ escrever }));
  assert.equal(f.n, 1, 'so o lead sem pin vai ao Photon');
  assert.deepEqual(escrever.escritas, [{ id: 'lead_sem', lat: 41.15, lng: -8.59 }]);
  assert.equal(feitos.length, 1);
  const c = await copia();
  assert.equal(c.find((r) => r.id === 'lead_sem').lat, 41.15, 'a copia mostra-o logo, sem esperar pelo refresco');
  assert.equal(c.find((r) => r.id === 'lead_a').lat, 41.16, 'o pin da auditoria nao se toca');
});

test('mudar a morada no Close move o pin; nao mudar nao faz nada', async () => {
  await writeJson('moradas-vistas.json', null);
  await semear(PORTO);
  await comFetch(photon(), () => acertarPins({ escrever: espiao() })); // toma nota

  const f = photon(), escrever = espiao();
  await semear([{ ...PORTO[0], address: 'Rua Nova 9' }, PORTO[1]]);
  await comFetch(f, () => acertarPins({ escrever }));
  assert.equal(f.n, 1);
  assert.deepEqual(escrever.escritas.map((e) => e.id), ['lead_a']);

  const outra = photon(), nada = espiao();
  await comFetch(outra, () => acertarPins({ escrever: nada }));
  assert.equal(outra.n, 0, 'a morada nova ja ficou vista');
  assert.equal(nada.escritas.length, 0);
});

test('um lead novo que ja traz pin (o do «Novo lead») nao e geocodificado outra vez', async () => {
  await writeJson('moradas-vistas.json', null);
  await semear(PORTO);
  await comFetch(photon(), () => acertarPins({ escrever: espiao() }));
  await semear([...PORTO, { id: 'lead_novo', name: 'N', address: 'Rua N', city: 'Porto', lat: 41.1, lng: -8.6 }]);
  const f = photon();
  await comFetch(f, () => acertarPins({ escrever: espiao() }));
  assert.equal(f.n, 0);
});

test('uma morada que o Photon nao encontra nao se pede outra vez ate mudar', async () => {
  await writeJson('moradas-vistas.json', null);
  await semear([...PORTO, { id: 'lead_x', name: 'X', address: 'Lugar Nenhum', city: 'Porto', lat: '', lng: '' }]);
  const vazio = async () => { vazio.n++; return Response.json({ features: [] }); };
  vazio.n = 0;
  const escrever = espiao();
  await comFetch(vazio, () => acertarPins({ escrever }));
  assert.equal(vazio.n, 1);
  assert.deepEqual(escrever.escritas, [{ id: 'lead_x', lat: 41.15, lng: -8.63 }], 'sem morada encontrada, fica na media da cidade');

  await semear([...PORTO, { id: 'lead_y', name: 'Y', address: 'Lugar Nenhum', city: 'Vila Nova de Foz Coa', lat: '', lng: '' }]);
  await comFetch(vazio, () => acertarPins({ escrever: espiao() }));
  await comFetch(vazio, () => acertarPins({ escrever: espiao() }));
  assert.equal(vazio.n, 2, 'cidade desconhecida e morada por encontrar: pergunta-se uma vez, nao a cada volta');
});

test('com o Photon em baixo nada se escreve nem se da por visto, e a volta para', async () => {
  await writeJson('moradas-vistas.json', null);
  await semear([...PORTO,
    { id: 'lead_p', name: 'P', address: 'R. Cel. Raul Peres', city: 'Porto', lat: '', lng: '' },
    { id: 'lead_q', name: 'Q', address: 'Rua Q', city: 'Porto', lat: '', lng: '' }]);
  const emBaixo = async () => { emBaixo.n++; throw new DOMException('tempo', 'TimeoutError'); };
  emBaixo.n = 0;
  const nada = espiao();
  assert.deepEqual(await comFetch(emBaixo, () => acertarPins({ escrever: nada })), []);
  assert.equal(nada.escritas.length, 0, 'medido a 28/09: a media da cidade ia por cima de moradas que o Photon encontra');
  assert.equal(emBaixo.n, 1, 'nao insiste com os outros na mesma volta');

  const escrever = espiao();
  await comFetch(photon(41.1522, -8.6781), () => acertarPins({ escrever }));
  assert.deepEqual(escrever.escritas.map((e) => [e.id, e.lng]), [['lead_p', -8.6781], ['lead_q', -8.6781]], 'na volta seguinte, a rua');
});

test('uma escrita que o Close recusa tenta-se na volta seguinte', async () => {
  await writeJson('moradas-vistas.json', null);
  await semear([...PORTO, { id: 'lead_z', name: 'Z', address: 'Rua Z', city: 'Porto', lat: '', lng: '' }]);
  const recusa = async () => { throw new Error('Close 500'); };
  assert.deepEqual(await comFetch(photon(), () => acertarPins({ escrever: recusa })), []);
  const escrever = espiao();
  await comFetch(photon(), () => acertarPins({ escrever }));
  assert.deepEqual(escrever.escritas.map((e) => e.id), ['lead_z']);
});

test('no maximo `maximo` por volta; os outros ficam para a seguinte', async () => {
  await writeJson('moradas-vistas.json', null);
  const muitos = Array.from({ length: 5 }, (_, i) => ({ id: `lead_${i}`, name: `L${i}`, address: `Rua ${i}`, city: 'Porto', lat: '', lng: '' }));
  await semear([...PORTO, ...muitos]);
  const f = photon();
  await comFetch(f, () => acertarPins({ maximo: 2, escrever: espiao() }));
  assert.equal(f.n, 2);
  // A copia ja traz o pin dos dois primeiros, portanto a seguinte faz os outros.
  await comFetch(f, () => acertarPins({ maximo: 2, escrever: espiao() }));
  assert.equal(f.n, 4);
});

test('os leads sem morada nem cidade nao gastam o `maximo` dos que a tem', async () => {
  await writeJson('moradas-vistas.json', null);
  const vazios = Array.from({ length: 5 }, (_, i) => ({ id: `lead_v${i}`, name: `V${i}`, address: '', city: '', lat: '', lng: '' }));
  await semear([...PORTO, ...vazios, { id: 'lead_real', name: 'R', address: 'Rua R', city: 'Porto', lat: '', lng: '' }]);
  const escrever = espiao();
  await comFetch(photon(), () => acertarPins({ maximo: 2, escrever }));
  assert.deepEqual(escrever.escritas.map((e) => e.id), ['lead_real'], 'medido a 28/09: 102 vazios a frente de 4 reais');
});

test('sem morada nem cidade nao ha nada a fazer, e nada sai daqui', async () => {
  await writeJson('moradas-vistas.json', null);
  await semear([...PORTO, { id: 'lead_vazio', name: 'V', address: '', city: '', lat: '', lng: '' }]);
  const f = photon(), escrever = espiao();
  await comFetch(f, () => acertarPins({ escrever }));
  assert.equal(f.n, 0);
  assert.equal(escrever.escritas.length, 0);
});
