// O portão: quem entra e com que nível.
import { verify } from './session.js';
import { readAccess, isAllowed, isAdmin } from './access.js';

/*
 * A sessão vale se a assinatura bater E se a pessoa ainda estiver na lista.
 *
 * Antes bastava a assinatura. O cookie dura 30 dias, e a lista de acessos só
 * era lida no login e na página de admin — portanto tirar alguém da lista não
 * lhe tirava nada: o botão «Remover» não removia. Quem saísse da equipa
 * continuava a ler os leads com nomes, emails e telefones, a ler as
 * conversas de WhatsApp, e a escrever no Close, até o cookie expirar.
 *
 * O `admin` também se recalcula aqui, pela mesma razão: o cookie diz o que era
 * verdade no dia do login, e despromover alguém não pode esperar um mês.
 *
 * ponytail: lê o ficheiro dos acessos a cada pedido com portão. São uns
 * poucos KB de um volume local, e o /api/access já o fazia a cada chamada. Se
 * um dia isto pesar, cache com invalidação no writeAccess.
 */
export async function sessaoValida(cabecalhoCookie) {
  const m = String(cabecalhoCookie || '').match(/(?:^|;\s*)session=([^;]+)/);
  if (!m) return null;
  const p = await verify(m[1]);
  if (!p?.email) return null;
  const acl = await readAccess();
  if (!isAllowed(acl, p.email)) return null;
  return { ...p, admin: isAdmin(acl, p.email) };
}

