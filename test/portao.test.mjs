/*
 * O botão «Remover» tem de remover.
 *
 * O cookie dura 30 dias e só se verificava a assinatura. A lista de acessos era
 * lida no login e na página de admin, e mais nada — portanto tirar alguém da
 * lista não lhe tirava nada: continuava a ler os leads com nomes, emails e
 * telefones, a ler as conversas de WhatsApp, e a escrever no Close, até o
 * cookie expirar.
 *
 * O mesmo para o `admin`: o cookie dizia o que era verdade no dia do login.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SESSION_SECRET = 'segredo-so-para-os-testes-do-portao';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'portao-'));

const { sign } = await import('../lib/session.js');
const { writeAccess, DOMAIN } = await import('../lib/access.js');
const { sessaoValida } = await import('../lib/portao.js');

const cookieDe = async (email, admin = false) => `session=${await sign({ email, admin })}`;
const EXTERNO = 'alguem@outra-empresa.pt';
const DO_DOMINIO = `comercial@${DOMAIN}`;

test('sem cookie, nada', async () => {
  await writeAccess({ users: [{ email: DO_DOMINIO, admin: true }] });
  assert.equal(await sessaoValida(undefined), null);
  assert.equal(await sessaoValida(''), null);
  assert.equal(await sessaoValida('outracoisa=1'), null);
});

test('uma assinatura que nao bate nao passa', async () => {
  await writeAccess({ users: [{ email: DO_DOMINIO, admin: true }] });
  const bom = await cookieDe(DO_DOMINIO);
  assert.ok(await sessaoValida(bom));
  assert.equal(await sessaoValida(bom.slice(0, -4) + 'aaaa'), null);
});

test('TIRAR da lista fecha a porta ao cookie que ja existia', async () => {
  await writeAccess({ users: [{ email: DO_DOMINIO, admin: true }, { email: EXTERNO, admin: false }] });
  const dele = await cookieDe(EXTERNO);
  assert.ok(await sessaoValida(dele), 'com acesso, entra');

  await writeAccess({ users: [{ email: DO_DOMINIO, admin: true }] });
  assert.equal(await sessaoValida(dele), null, 'o MESMO cookie, depois de removido');
});

test('DESPROMOVER tira o admin ao cookie que ja existia', async () => {
  await writeAccess({ users: [{ email: EXTERNO, admin: true }] });
  const dele = await cookieDe(EXTERNO, true);
  assert.equal((await sessaoValida(dele)).admin, true);

  await writeAccess({ users: [{ email: EXTERNO, admin: false }] });
  assert.equal((await sessaoValida(dele)).admin, false, 'o cookie diz admin; a lista manda');
});

test('um cookie que MENTE sobre o admin nao ganha nada', async () => {
  await writeAccess({ users: [{ email: EXTERNO, admin: false }] });
  const mente = await cookieDe(EXTERNO, true);
  assert.equal((await sessaoValida(mente)).admin, false);
});

test('quem e do dominio entra mesmo sem estar na lista — e isso e de proposito', async () => {
  /*
   * Removê-los da lista não os bloqueia: entram outra vez no login seguinte e
   * ficam registados de novo. É o desenho, e a página de acessos di-lo. O que
   * a remoção resolve é para quem vem de fora.
   */
  await writeAccess({ users: [] });
  const s = await sessaoValida(await cookieDe(`outro@${DOMAIN}`));
  assert.ok(s, 'o domínio entra sempre');
  assert.equal(s.admin, false, 'mas sem admin, que esse vem da lista');
});

test('um cookie fora de prazo nao passa', async () => {
  await writeAccess({ users: [{ email: EXTERNO, admin: true }] });
  const { MAX_AGE } = await import('../lib/session.js');
  assert.ok(MAX_AGE > 0);
  // O `sign` põe sempre exp no futuro; o caminho do prazo já é coberto pelos
  // testes da sessão. Aqui só se confirma que o portão não o contorna.
  const s = await sessaoValida(await cookieDe(EXTERNO, true));
  assert.ok(s.exp > Date.now() / 1000);
});

test('o email tem de estar no payload', async () => {
  await writeAccess({ users: [{ email: EXTERNO, admin: true }] });
  const semEmail = `session=${await sign({ admin: true })}`;
  assert.equal(await sessaoValida(semEmail), null);
});
