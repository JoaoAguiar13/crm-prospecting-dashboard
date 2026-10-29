// Webhook do Close (lead/contacto criado, alterado, apagado) → regrava o cache dos leads. Fora do gate de sessão (middleware); a auth é a assinatura.
// Assinatura: sha256 HMAC(signature_key em hex, close-sig-timestamp + body) — https://developer.close.com/resources/webhook-subscriptions/
// ponytail: rajadas (ex.: leads geocodados de seguida) coalescem — o 1.º evento agenda 1 refresh para daqui a 4 s, os seguintes só devolvem 200.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { refreshLeads } from '../lib/leads.js';

export const maxDuration = 60;

function valid(req, body) {
  const key = process.env.CLOSE_WEBHOOK_KEY; if (!key) return false;
  const sig = req.headers.get('close-sig-hash') || '';
  const h = createHmac('sha256', Buffer.from(key, 'hex')).update((req.headers.get('close-sig-timestamp') || '') + body).digest('hex');
  return sig.length === h.length && timingSafeEqual(Buffer.from(sig), Buffer.from(h));
}

/*
 * O coalescer, sem o cache do Vercel: num processo só, uma variável chega e é
 * mais honesta do que fingir estado distribuído. O `waitUntil` também não faz
 * falta — o servidor não é serverless e não desliga depois de responder.
 */
let pendente = null;

export async function POST(req) {
  const body = await req.text();
  if (!valid(req, body)) return new Response('assinatura inválida', { status: 401 });
  if (pendente) return new Response('coalesced');
  pendente = setTimeout(async () => {
    pendente = null;
    await refreshLeads().catch((e) => console.error('refresh após webhook Close', e));
  }, 4000);
  // Não segura o processo se não houver mais nada a correr.
  pendente.unref?.();
  return new Response('ok');
}
