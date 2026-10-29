// Os ficheiros de configuracao no volume: acessos, campanhas, enrich.
//
// O `DATA_DIR` e' lido no import do lib/store.js, portanto tem de ser definido
// antes — daí o import dinamico.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'prospecting-teste-'));
const { readJson, writeJson } = await import('../lib/store.js');

test('o que se escreve e' + ' o que se le', async () => {
  await writeJson('campanhas.json', { campanhas: [{ id: 'c1', nome: 'Empresas 2026' }] });
  const lido = await readJson('campanhas.json', null);
  assert.equal(lido.campanhas[0].nome, 'Empresas 2026');
});

test('ficheiro que nao existe devolve o valor de recurso', async () => {
  const seed = { users: [{ email: 'a@b.com', admin: true }] };
  assert.deepEqual(await readJson('nunca-escrito.json', seed), seed);
});

test('o valor de recurso e' + ' uma copia, nao o original', async () => {
  // Sem o structuredClone, quem mexesse no resultado envenenava a SEED em
  // memoria para todos os pedidos seguintes — e a lista de acessos e' uma SEED.
  const seed = { users: [{ email: 'a@b.com', admin: false }] };
  const primeiro = await readJson('tambem-nao-existe.json', seed);
  primeiro.users[0].admin = true;
  primeiro.users.push({ email: 'intruso@x.com', admin: true });

  assert.equal(seed.users.length, 1, 'a seed foi alterada de fora');
  assert.equal(seed.users[0].admin, false, 'a seed foi alterada de fora');
  const segundo = await readJson('tambem-nao-existe.json', seed);
  assert.equal(segundo.users.length, 1);
  assert.equal(segundo.users[0].admin, false);
});

test('reescrever deixa JSON valido e nenhum ficheiro temporario para tras', async () => {
  for (let i = 0; i < 5; i++) await writeJson('acessos.json', { users: Array(i + 1).fill({ email: 'a@b.com' }) });

  const ficheiros = await readdir(process.env.DATA_DIR);
  assert.deepEqual(ficheiros.filter((f) => f.endsWith('.tmp')), [], 'ficou lixo .tmp no volume');

  const cru = await readFile(join(process.env.DATA_DIR, 'acessos.json'), 'utf8');
  assert.doesNotThrow(() => JSON.parse(cru), 'o ficheiro final nao e JSON valido');
  assert.equal(JSON.parse(cru).users.length, 5);
});

test('a escrita e' + ' um rename, nao uma escrita por cima', async () => {
  // A atomicidade vem do `tmp + rename`. Um rename troca o ficheiro inteiro e
  // muda o inode; escrever por cima mantem o mesmo inode e passa por um estado
  // truncado — que e' o que deixaria a lista de acessos ilegivel e trancaria
  // toda a gente fora. O inode e' a forma deterministica de distinguir os dois
  // (nao prova o que acontece num crash, prova que o mecanismo esta' la').
  const alvo = join(process.env.DATA_DIR, 'inode.json');
  await writeJson('inode.json', { n: 1 });
  const antes = (await stat(alvo)).ino;
  await writeJson('inode.json', { n: 2 });
  const depois = (await stat(alvo)).ino;
  assert.notEqual(depois, antes, 'escreveu por cima em vez de trocar o ficheiro');
});

test('escrever numa pasta que nao existe cria-a', async () => {
  await writeJson('cache/leads.json', { leads: [] });
  assert.deepEqual(await readJson('cache/leads.json', null), { leads: [] });
});
