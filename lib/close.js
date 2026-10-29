// Close CRM por API direta (chave em CLOSE_API_KEY). Campos custom usados pelas campanhas.
// Os ids dos campos custom são da conta do Close: definir CLOSE_CF_* no ambiente.
import { DEMO, closeDemo } from './demo.js';
export const CF = {
  etapa: 'custom.' + (process.env.CLOSE_CF_ETAPA || 'cf_Exemplo0001'),
  tipo: 'custom.' + (process.env.CLOSE_CF_TIPO || 'cf_Exemplo0002'),
  campanha: 'custom.' + (process.env.CLOSE_CF_CAMPANHA || 'cf_Exemplo0003'),
  variante: 'custom.' + (process.env.CLOSE_CF_VARIANTE || 'cf_Exemplo0004'),
  // Usados ao criar um lead a partir da plataforma (api/lead.js).
  lat: 'custom.' + (process.env.CLOSE_CF_LAT || 'cf_Exemplo0005'),      // Latitude
  lng: 'custom.' + (process.env.CLOSE_CF_LNG || 'cf_Exemplo0006'),      // Longitude
  fase: 'custom.' + (process.env.CLOSE_CF_FASE || 'cf_Exemplo0007'),     // Fase Prospeção
  segmento: 'custom.' + (process.env.CLOSE_CF_SEGMENTO || 'cf_Exemplo0008'), // SEGMENTO - CLIENT
  tipoInst: 'custom.' + (process.env.CLOSE_CF_TIPO_INST || 'cf_Exemplo0009'), // Tipo de Instituição
};
export const CAMPANHA_FIELD = CF.campanha.replace('custom.', '');

/*
 * Tempo-limite. O `fetch` do Node não tem nenhum por omissão: se o Close
 * aceitar a ligação e nunca responder, o pedido fica pendurado para sempre — e
 * com ele um socket e a memória de quem esperava. Num processo só, uma manhã
 * de pedidos presos come o servidor sem ninguém perceber porquê.
 *
 * Vinte segundos: a leitura em massa dos leads faz páginas de 100 e a mais
 * lenta que medi levou 2,8 s.
 */
const LIMITE_MS = 20_000;

export async function close(path, { method = 'GET', body } = {}) {
  if (DEMO) return closeDemo(path, { method, body }); // modo demo: Close simulado (lib/demo.js)
  const key = process.env.CLOSE_API_KEY; if (!key) throw new Error('CLOSE_API_KEY em falta');
  let r;
  try {
    r = await fetch('https://api.close.com/api/v1' + path, {
      method, headers: { authorization: 'Basic ' + Buffer.from(key + ':').toString('base64'), 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(LIMITE_MS),
    });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Error(`O Close não respondeu em ${LIMITE_MS / 1000} s.`);
    throw e;
  }
  const text = await r.text(); let d; try { d = JSON.parse(text); } catch { d = { raw: text }; }
  if (!r.ok) throw new Error(`Close ${r.status}: ${(d.error || d.errors || d.raw || text || '').toString().slice(0, 300)}`);
  return d;
}

/*
 * As escolhas do campo «Etapa Outreach», lidas do Close e guardadas para o
 * resto do processo.
 *
 * O mapa é por PREFIXO numérico («2 - WhatsApp 1 enviado» → 2) e não pela
 * frase inteira, porque quem mexer nos rótulos no Close mexe na frase e não no
 * número. Assim renomear uma etapa lá não parte isto aqui.
 *
 * Isto vivia dentro do `api/lead-status.js`. Passou para aqui quando o
 * `api/email.js` precisou da mesma coisa: duas cópias da leitura e da cache
 * são duas cópias que podem discordar sobre o que é a etapa 1, e a etapa é o
 * que conta os «Enviados» das campanhas.
 */
let escolhas = null;

async function lerEscolhas() {
  const campo = await close(`/custom_field/lead/${CF.etapa.replace('custom.', '')}/`);
  const mapa = new Map();
  for (const c of campo.choices || []) {
    const m = /^\s*(\d+)\s*-/.exec(c);
    if (m) mapa.set(Number(m[1]), c);
  }
  if (!mapa.size) throw new Error('O campo «Etapa Outreach» do Close não tem escolhas numeradas.');
  return mapa;
}

export async function escolhaDaEtapa(n) {
  if (!escolhas) escolhas = await lerEscolhas();
  /*
   * Uma etapa que falta na cópia pode ter sido acrescentada no Close depois de
   * o processo a ter lido — foi o caso da 7, «Cliente / Parceiro». Relê-se uma
   * vez antes de dizer que não existe; sem isto, só um reinício do serviço a
   * fazia aparecer.
   */
  if (!escolhas.has(n)) escolhas = await lerEscolhas();
  return escolhas.get(n);
}

/** Só para os testes: esquece o que foi lido do Close. */
export const esquecerEtapas = () => { escolhas = null; };
