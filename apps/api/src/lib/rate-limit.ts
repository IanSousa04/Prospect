// Rate limit em memória para as rotas SEM autenticação (`/publico`, tarefa
// 0043). Em memória de propósito: o objetivo é conter abuso barato (script
// pedindo código de verificação em loop, força bruta de 6 dígitos), e a API
// roda como processo único. Se um dia houver mais de uma instância, isto
// precisa virar contador no banco/Redis — o limite por TELEFONE, que é o que
// custa mensagem real de WhatsApp, já é reforçado no banco pela janela de
// reenvio, então uma reinicialização não abre a porta pra spam de envio.
interface Janela {
  contagem: number;
  reiniciaEm: number;
}

const janelas = new Map<string, Janela>();

/** Remove janelas vencidas — sem isso o Map cresceria indefinidamente com
 * um IP novo a cada visitante. */
function limpar(agora: number): void {
  for (const [chave, janela] of janelas) {
    if (janela.reiniciaEm <= agora) janelas.delete(chave);
  }
}

let ultimaLimpeza = 0;
const INTERVALO_LIMPEZA_MS = 60_000;

export interface ResultadoRateLimit {
  permitido: boolean;
  /** Segundos até a janela reiniciar — vira `Retry-After` na resposta. */
  esperarSegundos: number;
}

export function consumirRateLimit(chave: string, limite: number, janelaSegundos: number): ResultadoRateLimit {
  const agora = Date.now();

  if (agora - ultimaLimpeza > INTERVALO_LIMPEZA_MS) {
    limpar(agora);
    ultimaLimpeza = agora;
  }

  const atual = janelas.get(chave);
  if (!atual || atual.reiniciaEm <= agora) {
    janelas.set(chave, { contagem: 1, reiniciaEm: agora + janelaSegundos * 1000 });
    return { permitido: true, esperarSegundos: 0 };
  }

  atual.contagem += 1;
  if (atual.contagem > limite) {
    return { permitido: false, esperarSegundos: Math.ceil((atual.reiniciaEm - agora) / 1000) };
  }
  return { permitido: true, esperarSegundos: 0 };
}
