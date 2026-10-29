/*
 * Os erros do Twilio em português, com o que fazer a seguir.
 *
 * Um sales manager não sabe o que é um 63024, e o ecrã mostrava exactamente
 * isso: «· erro 63024». Cada código aqui tem uma frase curta para a bolha da
 * mensagem e uma frase inteira que diz o passo seguinte.
 *
 * A lista saiu do registo real da conta — 30 dias lidos a 09/09/2026,
 * uma amostra de mensagens e falhas, cinco códigos distintos. Não é especulação:
 * `Messages.json?DateSent>=<data>` agrupado por `error_code`. Um código que
 * ainda não aconteceu não está aqui de propósito; a alternativa cai numa frase
 * que continua a dizer o que fazer.
 *
 * ponytail: mapa fixo, não a API de erros do Twilio. Se um dia forem muitos,
 * a lista completa está em twilio.com/docs/api/errors.
 */

const ERROS = {
  // 59 em 30 dias (56 na prospeção, 3 no bot das empresas). É a falha mais
  // comum da conta e a UI já a evita no texto livre — ver waWindowOpen().
  63016: {
    curto: 'janela de 24 h fechada',
    frase: 'A janela de 24 horas fechou. O WhatsApp só deixa escrever texto livre até 24 horas depois da última mensagem desta pessoa. Envia um template aprovado, ou espera que ela responda.',
  },
  // 21 em 30 dias, todas do bot dos estudantes, 17 números distintos.
  63024: {
    curto: 'número sem WhatsApp',
    frase: 'Este número não recebe WhatsApp. Pode estar errado, ou a pessoa nunca aceitou os termos da aplicação. Confirma o número no Close e usa email ou telefone.',
  },
  // 5 em 30 dias. A plataforma passou a preencher as variáveis que cada
  // template declara (08/09), mas o backend também envia templates.
  21656: {
    curto: 'faltou preencher o template',
    frase: 'O template foi enviado com uma variável vazia ou a mais. O WhatsApp exige todas preenchidas. Envia outra vez e preenche todos os campos que a plataforma pedir.',
  },
  // 1 em 30 dias.
  21655: {
    curto: 'template já não existe',
    frase: 'Este template já não existe nesta conta Twilio — foi apagado ou pertence a outra conta. Escolhe outro template na campanha, ou pede que seja criado de novo.',
  },
  // 17 em 30 dias, todas em mensagens RECEBIDAS. A mensagem está cá; o que
  // falhou foi a entrega ao n8n, que é quem escreve a etapa no Close.
  12300: {
    curto: 'o Close não foi actualizado',
    frase: 'Esta resposta chegou à plataforma, mas o automatismo que escreve no Close não a recebeu. A etapa deste lead não mudou sozinha — muda-a à mão.',
  },
};

/*
 * Devolve sempre alguma coisa. Um código desconhecido continua a ter de dizer
 * o que fazer, senão volta o problema por outra porta.
 */
export function explicarTwilio(codigo) {
  if (!codigo) return null;
  const e = ERROS[Number(codigo)];
  if (e) return { codigo: Number(codigo), ...e };
  return {
    codigo: Number(codigo),
    curto: 'o WhatsApp recusou',
    frase: `O WhatsApp recusou esta mensagem (código ${codigo}). Tenta outra vez; se repetir, guarda a hora e avisa quem trata do Twilio.`,
  };
}

export const CODIGOS_CONHECIDOS = Object.keys(ERROS).map(Number);

/*
 * Os estados de entrega do Twilio, em português.
 *
 * A bolha mostrava `read`, `undelivered`, `queued` a cru. Vivem aqui, ao lado
 * dos códigos de erro, porque é o mesmo problema: uma palavra do Twilio que
 * chega ao ecrã de quem vende sem ter sido traduzida.
 *
 * O `failed` e o `undelivered` não dizem porquê — isso é o que o
 * `explicarTwilio` acrescenta ao lado, a partir do `error_code`.
 */
const ESTADOS = {
  queued: 'na fila',
  accepted: 'aceite',
  scheduled: 'agendada',
  sending: 'a enviar',
  sent: 'enviada',
  delivered: 'entregue',
  read: 'lida',
  receiving: 'a receber',
  received: 'recebida',
  failed: 'falhou',
  undelivered: 'não entregue',
  canceled: 'cancelada',
};

/** Um estado desconhecido devolve-se como veio, em vez de desaparecer. */
export function estadoEmPortugues(estado) {
  if (!estado) return '';
  return ESTADOS[String(estado).toLowerCase()] || String(estado);
}
