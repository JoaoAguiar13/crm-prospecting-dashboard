// Substitui o node:path na demo estática (só o que as rotas usam).
export function join(...partes) {
  const absoluto = String(partes[0] || '').startsWith('/');
  const saida = [];
  for (const parte of partes.join('/').split('/')) {
    if (!parte || parte === '.') continue;
    if (parte === '..') saida.pop();
    else saida.push(parte);
  }
  return (absoluto ? '/' : '') + saida.join('/');
}

export function dirname(caminho) {
  const i = String(caminho).lastIndexOf('/');
  return i > 0 ? caminho.slice(0, i) : i === 0 ? '/' : '.';
}
