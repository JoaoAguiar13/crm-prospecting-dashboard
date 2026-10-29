// Twilio, direto: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN.
//
// Havia um recurso: sem token, os pedidos iam por um proxy no n8n, que tinha a
// credencial guardada lá. Saiu a 20/09/2026, por duas razões.
//
// A primeira é que nunca corria: o `TWILIO_AUTH_TOKEN` está definido na
// Railway, portanto o caminho direto ganha sempre.
//
// A segunda é o que acontecia se não estivesse. O webhook `twilio-proxy` não
// está registado — confirmado na instância a 19/09 — e o workflow que o servia
// está parado. Faltar o token dava um 404 do n8n com uma frase sobre webhooks,
// em vez de «falta o TWILIO_AUTH_TOKEN». Um recurso que transforma uma
// variável em falta num mistério é pior do que não existir.
import { explicarTwilio } from './erros-twilio.js';
import { DEMO, twDemo } from './demo.js';
export const ACCOUNT = process.env.TWILIO_ACCOUNT_SID || '';

/*
 * Os três remetentes de WhatsApp da conta. Os dois bots são do produto e têm
 * webhooks próprios: uma resposta a esses números vai ao bot, e o bot pode
 * responder sozinho — a UI avisa. O envio valida a chave contra este mapa,
 * portanto não há como enviar de um número fora dele (o sandbox +12025550101,
 * OFFLINE, fica de fora de propósito).
 */
export const SENDERS = {
  prospecao: { wa: 'whatsapp:' + (process.env.TWILIO_FROM_PROSPECAO || '+12025550102'), rotulo: 'Prospeção', bot: false },
  empresas: { wa: 'whatsapp:' + (process.env.TWILIO_FROM_EMPRESAS || '+12025550103'), rotulo: 'Bot Empresas', bot: true },
  estudantes: { wa: 'whatsapp:' + (process.env.TWILIO_FROM_ESTUDANTES || '+12025550104'), rotulo: 'Bot Estudantes', bot: true },
};
export const WA_FROM = SENDERS.prospecao.wa;
export const MSG_URL = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages.json`;

export async function tw(url, { method, form, json } = {}) {
  if (DEMO) return twDemo(url, { method, form, json }); // modo demo: Twilio simulado (lib/demo.js)
  const token = process.env.TWILIO_AUTH_TOKEN;
  // Sem token não há caminho nenhum, e dizê-lo à cara poupa a quem for a seguir
  // o tempo que custa perceber um erro de autenticação do Twilio.
  if (!token) throw new Error('Falta o TWILIO_AUTH_TOKEN. Sem ele não dá para falar com o Twilio — o separador Conversas fica vazio.');

  method = method || (form || json ? 'POST' : 'GET');
  const headers = { authorization: 'Basic ' + Buffer.from(ACCOUNT + ':' + token).toString('base64') };
  let body;
  if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  else if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  const r = await fetch(url, { method, headers, body });

  const text = await r.text(); let d; try { d = JSON.parse(text); } catch { d = { raw: text }; }
  // O código do Twilio sozinho não diz nada a quem vende. A frase vem primeiro;
  // o número fica no fim, para quem tiver de abrir a consola do Twilio.
  if (d.code && d.message && d.status >= 400) {
    const e = explicarTwilio(d.code);
    throw new Error(`${e.frase} (Twilio ${d.code})`);
  }
  if (!r.ok) throw new Error(`Twilio HTTP ${r.status}: ${text.slice(0, 200)}`);
  return d;
}
