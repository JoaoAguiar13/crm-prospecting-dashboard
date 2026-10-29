// Ficheiros JSON pequenos (acessos, campanhas, enrich) em disco.
//
// Era o Vercel Blob. Na Railway a coisa certa é o volume montado em DATA_DIR:
// são três ficheiros de configuração, poucos KB, escritos raramente e lidos a
// cada pedido — um serviço de objectos para isto é peso sem retorno.
//
// A escrita é atómica (ficheiro temporário + rename): sem isso, um reinício a
// meio de um write deixa o JSON truncado e a lista de acessos ilegível, que
// tranca toda a gente fora da plataforma.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || '/data';

const caminho = (path) => join(DATA_DIR, path);

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(caminho(path), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return structuredClone(fallback);
    throw e;
  }
}

export async function writeJson(path, data) {
  const destino = caminho(path);
  await mkdir(dirname(destino), { recursive: true });
  const temp = `${destino}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 1));
  await rename(temp, destino);
  return { path };
}
