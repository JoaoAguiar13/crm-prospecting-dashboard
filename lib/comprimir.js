import { gzipSync } from 'node:zlib';

/*
 * Comprime o que vale a pena comprimir.
 *
 * Medido a 11/09/2026: o `/api/leads` são 0,75 MB de JSON e saíam sem
 * compressão nenhuma. No fio, depois: 783 KB → 213 KB (27%), e a página
 * 309 KB → 143 KB (46%). São 736 KB a menos por cada abertura do ecrã
 * principal.
 *
 * CORRECÇÃO ao que escrevi primeiro: atribuí a isto umas leituras de 8 a 40
 * segundos que tinha medido. Não era o tamanho — repeti a medição sem
 * compressão depois de publicar e deu 0,3 s. Aquilo foi o contentor sob
 * carga, logo a seguir a um deploy.
 *
 * O ganho a sério é em bytes, não em segundos na minha ligação: 0,07-0,34 s
 * com gzip contra 0,10-0,63 s sem. Onde 736 KB pesam é num telemóvel ou numa
 * ligação má, e a equipa comercial tem isto aberto o dia todo.
 *
 * `gzipSync` e não um stream porque o corpo já está todo em memória quando
 * chegamos aqui: não há nada a ganhar em passá-lo a pedaços, e há a perder
 * em complexidade. Abaixo do limiar não se comprime, porque o cabeçalho
 * custa mais do que poupa.
 *
 * ponytail: gzip e não brotli. O brotli comprime ~15% melhor e demora
 * bastante mais a comprimir; para um corpo que se serve a cada leitura,
 * isso troca o problema de sítio. Trocar quando houver cache do comprimido.
 */
const MINIMO_PARA_COMPRIMIR = 1024;
const COMPRIMIVEL = /^(text\/|application\/(json|javascript|xml)|image\/svg)/;

export function talvezComprimir(req, res, headers, corpo) {
  const aceita = String(req.headers['accept-encoding'] || '');
  const tipo = String(headers['content-type'] || headers['Content-Type'] || '');
  if (corpo.length < MINIMO_PARA_COMPRIMIR || !/\bgzip\b/.test(aceita) || !COMPRIMIVEL.test(tipo)) {
    return { headers, corpo };
  }
  const comprimido = gzipSync(corpo);
  /*
   * Se comprimir não encolher — já vem comprimido, ou é ruído — manda-se o
   * original. Gastar CPU para mandar mais bytes seria o pior dos dois.
   */
  if (comprimido.length >= corpo.length) return { headers, corpo };
  return { headers: { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' }, corpo: comprimido };
}
