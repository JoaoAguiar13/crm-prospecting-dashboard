// Substitui o node:fs/promises na demo estática: os ficheiros JSON do
// lib/store.js (acessos, campanhas, cache de leads) ficam em memória e
// desaparecem quando se recarrega a página.
const ficheiros = new Map();

const naoExiste = (caminho) => Object.assign(new Error(`ENOENT: ${caminho}`), { code: 'ENOENT' });

export async function readFile(caminho) {
  if (!ficheiros.has(caminho)) throw naoExiste(caminho);
  return ficheiros.get(caminho);
}

export async function writeFile(caminho, dados) {
  ficheiros.set(caminho, String(dados));
}

export async function rename(de, para) {
  if (!ficheiros.has(de)) throw naoExiste(de);
  ficheiros.set(para, ficheiros.get(de));
  ficheiros.delete(de);
}

export async function mkdir() {}
