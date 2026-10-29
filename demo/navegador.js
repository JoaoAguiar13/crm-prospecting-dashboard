/*
 * Demo estática: a plataforma a correr só no browser (GitHub Pages).
 *
 * As rotas de api/ são handlers `Request → Response` da Web API, portanto
 * correm no browser tal como estão. Este script, carregado antes de tudo o
 * resto, faz duas coisas:
 *
 *   1. Põe o ambiente que as rotas esperam: DEMO_MODE=1, e com isso o Close e
 *      o Twilio passam a ser simulados por lib/demo.js, com dados fictícios.
 *   2. Intercepta o fetch('/api/<rota>') da interface e entrega o pedido ao
 *      handler de api/<rota>.js, em vez de o mandar para a rede.
 *
 * Tudo vive na memória do separador: recarregar a página repõe os dados.
 * O scripts/construir-demo.mjs junta isto às páginas e às rotas.
 */
(function () {
  'use strict';

  const segredo = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  globalThis.process = { env: { DEMO_MODE: '1', SESSION_SECRET: segredo, DATA_DIR: '/demo' }, pid: 1 };

  // A pasta do site: no GitHub Pages é uma subpasta (/<repositório>/), não a raiz.
  const BASE = new URL('./', document.baseURI);
  const fetchDaRede = window.fetch.bind(window);

  let pronto = null;
  const preparar = () => (pronto ||= (async () => {
    const [{ sign }, demo] = await Promise.all([
      import(new URL('lib/session.js', BASE).href),
      import(new URL('lib/demo.js', BASE).href),
    ]);
    // O browser não deixa pôr o cabeçalho Cookie num Request. A sessão de
    // demonstração fica aqui, assinada como no servidor, e o lib/session.js da
    // demo lê-a quando o pedido não traz cookie.
    globalThis.__SESSAO_DEMO__ = 'session=' + await sign({ email: demo.DEMO_EMAIL, name: 'Utilizador demo', admin: true });
    await demo.prepararDemo();
  })());

  const json = (corpo, status) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

  window.fetch = async function (entrada, opcoes = {}) {
    const pedido = entrada instanceof Request ? entrada : null;
    const url = new URL(pedido ? pedido.url : String(entrada), location.href);
    const rota = url.origin === location.origin && url.pathname.match(/^\/api\/([\w-]+)$/);
    if (!rota) return fetchDaRede(entrada, opcoes);

    await preparar();
    let modulo;
    try {
      modulo = await import(new URL(`api/${rota[1]}.js`, BASE).href);
    } catch (e) {
      console.error(e);
      return json({ error: 'rota não existe' }, 404);
    }
    const metodo = String(opcoes.method || pedido?.method || 'GET').toUpperCase();
    const handler = modulo[metodo] || modulo.default;
    if (!handler) return json({ error: 'método não permitido' }, 405);

    const temCorpo = metodo !== 'GET' && metodo !== 'HEAD';
    const corpo = temCorpo ? (opcoes.body ?? (pedido ? await pedido.text() : undefined)) : undefined;
    const req = new Request(url.href, { method: metodo, headers: opcoes.headers || pedido?.headers, body: corpo });
    try {
      return await handler(req);
    } catch (e) {
      console.error(metodo, url.pathname, e);
      return json({ error: 'Erro interno na demo.' }, 500);
    }
  };

  // Um aviso discreto, para ninguém confundir os dados com reais.
  document.addEventListener('DOMContentLoaded', () => {
    const aviso = document.createElement('div');
    aviso.textContent = 'Demo · dados fictícios';
    aviso.title = 'Todos os nomes, contactos e mensagens são inventados. As alterações ficam só neste separador e desaparecem ao recarregar.';
    aviso.setAttribute('role', 'note');
    // No fundo da barra lateral, por cima do estado do Close: não tapa nenhum botão.
    aviso.style.cssText = 'position:fixed;left:16px;bottom:44px;z-index:2147483647;'
      + 'background:rgba(17,24,39,.88);color:#fff;font:12px/1.4 system-ui,sans-serif;padding:5px 11px;border-radius:999px;cursor:help;';
    document.body.appendChild(aviso);
  });
})();
