// Leads do Close, em cache.
//
// Era o Runtime Cache do Vercel. Aqui é memória do processo + um ficheiro no
// volume: a memória serve os pedidos, o ficheiro sobrevive a reinícios e a
// deploys. É o mesmo contrato de antes (`get`/`set`), portanto quem chama não
// muda.
//
// ponytail: um processo só, que é como isto corre. Com várias instâncias cada
// uma teria a sua memória — o ficheiro no volume partilhado continua a ser a
// verdade. Upgrade: Redis, quando houver mais do que uma.
import { readJson, writeJson } from './store.js';
import { lerLeadsDoClose } from './leads-close.js';
import { DEMO, coordenadasDemo } from './demo.js';
import { close, CF } from './close.js';

const FICHEIRO = 'leads-cache.json';
const TTL_MS = 7 * 24 * 3600 * 1000;

let memoria = null;

async function ler() {
  if (memoria) return memoria;
  const d = await readJson(FICHEIRO, null);
  // Um cache velho de mais vale menos do que ir buscar de novo.
  if (d?.at && Date.now() - d.at < TTL_MS) memoria = d;
  return memoria;
}

export const cache = () => ({
  async get(chave) {
    const d = await ler();
    return d ? (chave === 'at' ? d.at : d.text) : null;
  },
});

/*
 * Só para os testes: esquece a cópia que está em memória.
 *
 * O `memoria` vive no módulo e sobrevive de teste para teste. Sem isto, o
 * teste que diz «sem cópia nenhuma, tenta na mesma» corria com a cópia que um
 * teste anterior tinha deixado lá, e passava por essa razão e não pela que
 * afirma. Medido a 20/09/2026, a mutar o ramo do `Infinity`: ninguém reparava.
 */
export const esquecerCopia = () => { memoria = null; };

/**
 * Refresca a lista, lendo direto do Close.
 *
 * Isto tentava primeiro o webhook `get-close-leads` do n8n e só caía para o
 * Close quando ele falhava. A ordem fazia sentido enquanto o n8n era a fonte:
 * era ele que filtrava e enriquecia.
 *
 * Deixou de fazer. O fluxo está desligado desde algures antes de 09/09/2026, e
 * a 19/09 confirmei na própria instância que o `get-close-leads` não está
 * registado — e que o workflow que o servia está parado. Ou seja: cada
 * refresco, um de cinco em cinco minutos pelo `manterFresco`, gastava uma ida
 * e volta a um webhook que responde 404 e escrevia um aviso no registo, antes
 * de fazer o que funciona.
 *
 * Pior do que o desperdício: quando as DUAS fontes falhavam, a frase que
 * chegava ao ecrã era a do n8n — «A automação do Close respondeu 404» — sobre
 * uma automação que já não existe. Quem vende ia à procura de um fluxo para
 * arranjar, em vez de olhar para o Close.
 *
 * A equivalência das duas fontes foi medida a 10/09/2026, leads campo a
 * campo (ver o cabeçalho de `lib/leads-close.js`), e em todas as diferenças
 * era o Close que tinha o dado mais fresco ou mais completo.
 */
export async function refreshLeads() {
  const d = await lerLeadsDoClose();
  const at = Date.now(), text = JSON.stringify(d);
  memoria = { at, text };
  // O disco não pode fazer falhar o pedido: a memória já tem o que interessa.
  writeJson(FICHEIRO, memoria).catch((e) => console.error('cache de leads não gravou:', e.message));
  return { text, at, fonte: 'close' };
}

/**
 * Muda o `status` de um lead na cópia em cache, sem tocar na idade dela.
 *
 * Quem escreve no Close é o `api/lead-status.js`; isto é só a parte de o ecrã
 * não voltar atrás. Sem isto a mudança ia ao Close e a lista continuava a
 * mostrar o valor antigo, porque o `get-close-leads` está desligado e o cache
 * nunca mais era relido — pareceria que o botão não funcionou.
 *
 * A idade (`at`) fica como estava de propósito: os outros campos continuam a
 * ser os de há cinco dias, e o rodapé tem de continuar a dizê-lo.
 *
 * Devolve `true` se encontrou o lead. `false` quer dizer que o lead não está
 * na cópia — o Close já foi escrito, e quem chama tem de o dizer em vez de
 * fingir que correu tudo bem.
 */
export async function marcarEstadoNaCopia(leadId, status) {
  const d = await ler();
  if (!d?.text) return false;
  let dados;
  try {
    dados = JSON.parse(d.text);
  } catch {
    return false;
  }
  let achou = false;
  for (const grupo of ['escolas', 'empresas']) {
    for (const r of dados[grupo] || []) {
      if (r.id === leadId) {
        r.status = status;
        achou = true;
      }
    }
  }
  if (!achou) return false;
  memoria = { at: d.at, text: JSON.stringify(dados) };
  /*
   * Aqui espera-se pela gravação, ao contrário do caminho de leitura acima.
   * Ali o disco não pode atrasar um pedido que já tem a resposta em memória;
   * aqui é uma escrita que a pessoa pediu, e quando esta função devolve `true`
   * tem de ser verdade que o ficheiro mudou. O `catch` fica: um disco a falhar
   * não desfaz o que já foi escrito no Close.
   */
  await writeJson(FICHEIRO, memoria).catch((e) => console.error('cache de leads não gravou:', e.message));
  return true;
}

/**
 * Coordenadas de uma cidade, a partir dos leads que já lá temos.
 *
 * Não há geocodificador nenhum nisto: parte dos leads já trazem latitude e
 * longitude, o que dá 198 cidades conhecidas. Para uma cidade nova, a média das
 * que lá estão é boa o suficiente para um pin no mapa — e melhor do que pedir
 * uma dependência externa para um caso que quase não acontece.
 *
 * Quando há morada, manda o `coordenadasDaMorada` (abaixo); isto é o recurso,
 * e a referência para ver se o que o Photon devolveu é da cidade certa.
 *
 * Devolve `null` quando a cidade não é conhecida — e quem chama tem de o dizer,
 * em vez de inventar um pin no meio do Atlântico.
 */
export async function coordenadasDaCidade(cidade) {
  const d = await ler();
  if (!d?.text) return null;
  let dados;
  try {
    dados = JSON.parse(d.text);
  } catch {
    return null;
  }
  return mediaDaCidade([...(dados.escolas || []), ...(dados.empresas || [])], cidade);
}

function mediaDaCidade(leads, cidade) {
  const alvo = String(cidade || '').trim().toLowerCase();
  if (!alvo) return null;
  let n = 0, la = 0, ln = 0;
  for (const r of leads) {
    if (String(r.city || '').trim().toLowerCase() !== alvo) continue;
    const a = parseFloat(r.lat), b = parseFloat(r.lng);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    n++; la += a; ln += b;
  }
  return n ? { lat: +(la / n).toFixed(6), lng: +(ln / n).toFixed(6), aPartirDe: n } : null;
}

/**
 * Coordenadas de uma morada, pelo Photon (OpenStreetMap, sem chave).
 *
 * A média da cidade deixou de chegar a 23/09/2026: o comercial criou três escolas
 * com a morada escrita — três escolas profissionais — e as três ficaram no mesmo
 * pin no centro do Porto, uma delas em Matosinhos. «Quando insiro uma morada
 * para a lead, a lead não está a aparecer nessa morada no mapa.» O Photon
 * acertou nas três tal como ele as escreveu. É o mesmo serviço que o backend
 * usa desde a PR #320.
 *
 * Só resultados em Portugal (sem o filtro, uma «Rua Direita» qualquer vinha de
 * Espanha), e só a menos de LONGE_KM da `perto` quando há uma: um pin na rua
 * errada a 200 km é pior do que o pin da cidade, porque parece certo.
 *
 * Devolve `null` quando não há morada ou o Photon não a encontra. Quando o
 * Photon FALHA (rede, tempo, 5xx), atira: são coisas diferentes. A 28/09/2026,
 * num ensaio, três pedidos seguidos esgotaram o tempo e a passagem de fundo
 * tomou-os por «não existe» — escreveu a média da cidade e deu o assunto por
 * arrumado. Duas moradas que o Photon encontra à rua ficariam no centro da
 * cidade até alguém lhes mudar a morada.
 */
const LONGE_KM = 30;
export async function coordenadasDaMorada(morada, cidade, perto = null) {
  const m = String(morada || '').trim();
  if (!m) return null;
  if (DEMO) return coordenadasDemo(m, cidade, perto); // modo demo: sem pedidos ao Photon
  const q = new URLSearchParams({ q: [m, cidade].filter(Boolean).join(', '), limit: '5', lat: '39.5', lon: '-8', zoom: '6' });
  const r = await fetch(`https://photon.komoot.io/api/?${q}`, {
    headers: { 'user-agent': 'unilinkr-prospecting' },
    // O Photon público demora 1–3 s (medido a 28/09/2026), e às vezes passa dos
    // 8. Com 4 s de tecto a primeira chamada, a frio, perdeu uma das moradas.
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`o Photon respondeu ${r.status}`);
  const d = await r.json();
  const km = (a, b) => 111 * Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180));
  for (const f of d?.features || []) {
    if (f.properties?.countrycode !== 'PT') continue;
    const [lng, lat] = f.geometry?.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const c = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
    if (perto && km(c, perto) > LONGE_KM) continue;
    return c;
  }
  return null;
}

/**
 * Pins que acompanham a morada, venha ela de onde vier.
 *
 * O `lead-novo` geocodifica, mas quem escreve a morada DIRECTAMENTE no Close
 * nunca ganhava pin, e quem a corrigia lá via o pin ficar onde estava. A
 * 28/09/2026, quatro leads tinham morada ou cidade e não tinham pin nenhum; é a
 * mesma frase do comercial — «quando insiro uma morada para a lead, a lead não está
 * a aparecer nessa morada no mapa» — por outro caminho.
 *
 * Corre sobre a cópia, a cada volta do `manterFresco`. Mexe em dois casos:
 *   - lead sem pin, com morada ou cidade que ainda não se tentou;
 *   - lead com pin cuja morada MUDOU desde a última vez que se viu.
 *
 * Dos leads que já têm pin, a primeira volta (sem `moradas-vistas.json`) só
 * toma nota da morada. Os pins de agosto vieram da auditoria (sites, registo
 * comercial, sede) e são melhores do que o Photon; um lead desses só volta a
 * ser geocodificado quando alguém lhe muda a morada.
 *
 * Uma morada que o Photon não encontra fica registada e não se volta a pedir
 * até mudar. Um Photon em baixo ou uma escrita que o Close recusa não ficam:
 * tenta-se na volta seguinte. Sem morada mas com cidade, um lead sem pin fica na média da cidade,
 * como no «Novo lead».
 *
 * ponytail: `maximo` por volta, em série — o Photon é público e partilhado.
 * Com um lote grande (uma importação), os pins vão aparecendo de cinco em
 * cinco minutos em vez de todos de uma vez.
 */
const VISTAS = 'moradas-vistas.json';
const chaveMorada = (r) => [r.address, r.zipcode, r.city].map((x) => String(x || '').trim().toLowerCase()).join('|');
const temPin = (r) => Number.isFinite(parseFloat(r.lat)) && Number.isFinite(parseFloat(r.lng));
const escreverPin = (id, c) => close(`/lead/${encodeURIComponent(id)}/`, { method: 'PUT', body: { [CF.lat]: c.lat, [CF.lng]: c.lng } });

export async function acertarPins({ maximo = 20, escrever = escreverPin } = {}) {
  const d = await ler();
  if (!d?.text) return [];
  let dados;
  try {
    dados = JSON.parse(d.text);
  } catch {
    return [];
  }
  const todos = [...(dados.escolas || []), ...(dados.empresas || [])];
  const vistas = { ...((await readJson(VISTAS, null)) || {}) };
  const aFazer = [];
  for (const r of todos) {
    const k = chaveMorada(r);
    const semPin = !temPin(r);
    const mudou = r.id in vistas && vistas[r.id] !== k;
    // Sem morada nem cidade não há o que pedir, e não pode gastar o `maximo`.
    if (k !== '||' && (semPin ? vistas[r.id] !== k : mudou)) aFazer.push(r);
    else vistas[r.id] = k;
  }

  const feitos = [];
  for (const r of aFazer.slice(0, maximo)) {
    const media = mediaDaCidade(todos, r.city);
    let naMorada;
    try {
      naMorada = await coordenadasDaMorada([r.address, r.zipcode].filter(Boolean).join(' '), r.city, media);
    } catch (e) {
      // O Photon em baixo não diz nada sobre a morada: sem nota, e sem insistir
      // nesta volta com os que faltam.
      console.error(`Photon indisponível (${e.message}); os pins ficam para a próxima volta.`);
      break;
    }
    const c = naMorada || (!temPin(r) && media ? { lat: media.lat, lng: media.lng } : null);
    if (c) {
      try {
        await escrever(r.id, c);
      } catch (e) {
        console.error(`pin de ${r.name} não gravou no Close:`, e.message);
        continue; // sem tomar nota: tenta-se na volta seguinte
      }
      feitos.push({ id: r.id, name: r.name, ...c });
      console.log(`pin de ${r.name} → ${c.lat}, ${c.lng}`);
    }
    vistas[r.id] = chaveMorada(r);
  }
  await writeJson(VISTAS, vistas);

  /*
   * Corrigir a cópia que estiver em memória AGORA, não a que se leu no início:
   * um refresco pode tê-la trocado enquanto se esperava pelo Photon.
   */
  if (feitos.length) {
    const atual = await ler();
    try {
      const dd = JSON.parse(atual.text);
      const porId = new Map(feitos.map((f) => [f.id, f]));
      for (const r of [...(dd.escolas || []), ...(dd.empresas || [])]) {
        const f = porId.get(r.id);
        if (f) { r.lat = f.lat; r.lng = f.lng; }
      }
      memoria = { at: atual.at, text: JSON.stringify(dd) };
      await writeJson(FICHEIRO, memoria);
    } catch (e) {
      console.error('cópia não corrigida com os pins novos:', e.message);
    }
  }
  return feitos;
}

/** Acrescenta um lead novo à cópia em cache, para aparecer sem esperar. */
export async function juntarLeadNaCopia(grupo, lead) {
  const d = await ler();
  if (!d?.text) return false;
  let dados;
  try {
    dados = JSON.parse(d.text);
  } catch {
    return false;
  }
  if (!Array.isArray(dados[grupo])) return false;
  if (dados[grupo].some((r) => r.id === lead.id)) return true;
  dados[grupo].push(lead);
  memoria = { at: d.at, text: JSON.stringify(dados) };
  await writeJson(FICHEIRO, memoria).catch((e) => console.error('cache de leads não gravou:', e.message));
  return true;
}

/**
 * Mantém a lista fresca sem ninguém carregar em nada.
 *
 * Até aqui o `refreshLeads` só corria quando alguém carregava em «Atualizar»,
 * ou quando o webhook do Close disparava — e o webhook não dispara, porque
 * falta a `CLOSE_WEBHOOK_KEY`. Resultado medido a 10/09: a lista tinha cinco
 * dias e não havia caminho nenhum para a refrescar sozinha.
 *
 * Isto fecha esse buraco: de tempos a tempos, se a cópia estiver velha, vai
 * buscar de novo. Uma leitura completa ao Close leva 8 segundos e são 14
 * pedidos; a cada quarto de hora dá menos de 1400 pedidos por dia, que é nada
 * para a conta.
 *
 * ponytail: um `setInterval` num processo só. Com várias instâncias, todas
 * refrescavam — aí, um lock no volume ou um cron externo.
 */
export function manterFresco({ deVezEmQuando = 5 * 60_000, velhaAoFimDe = 15 * 60_000 } = {}) {
  let aCorrer = false;

  const talvez = async () => {
    if (aCorrer) return;
    aCorrer = true;
    try {
      const d = await ler();
      const idade = d?.at ? Date.now() - d.at : Infinity;
      if (idade >= velhaAoFimDe) {
        const t0 = Date.now();
        try {
          await refreshLeads();
          console.log(`lista refrescada sozinha (tinha ${Math.round(idade / 60_000)} min) em ${Date.now() - t0} ms`);
        } catch (e) {
          // Não é fatal: continua a servir-se a cópia velha, e o rodapé diz a idade.
          console.error('a lista não refrescou sozinha:', e.message);
        }
      }
      // Os pins andam a cada volta, esteja a cópia fresca ou não: quem carrega em
      // «Atualizar» mantém-na sempre fresca, e o refresco acima nunca correria.
      // Sem chave, cada escrita falhava e voltava a pedir ao Photon a cada volta.
      if (process.env.CLOSE_API_KEY) await acertarPins().catch((e) => console.error('pins não acertados:', e.message));
    } finally {
      aCorrer = false;
    }
  };

  const t = setInterval(talvez, deVezEmQuando);
  t.unref?.(); // não segura o processo se alguém quiser fechá-lo
  talvez(); // e uma vez ao arrancar, que é quando a cópia costuma estar mais velha
  return () => clearInterval(t);
}
