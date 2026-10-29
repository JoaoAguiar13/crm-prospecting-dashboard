// Substitui o node:crypto na demo estática, com a Web Crypto do browser.

export function randomBytes(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return {
    toString: (codificacao) => codificacao === 'hex'
      ? Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
      : String.fromCharCode(...bytes),
  };
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) throw new RangeError('Os dois valores têm de ter o mesmo tamanho.');
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a[i] ^ b[i];
  return diferenca === 0;
}

// Só o webhook do Close usa isto, e ele não existe na demo estática.
export function createHmac() {
  throw new Error('createHmac não existe na demo estática.');
}
