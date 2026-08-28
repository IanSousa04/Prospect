// Simula a fala do "cliente" via LLM, dado um perfil de personalidade — usa
// o mesmo ChatModel/provedor da pipeline real (llm/client.ts), mas em um
// papel totalmente separado: aqui o LLM interpreta o CLIENTE, nunca a IA de
// atendimento. Ver eval/personas/cenarios.ts pro loop que alterna entre este
// simulador e `processarMensagem` real.
import { getChatModel } from "../../llm/client.js";
import type { ChatMessage } from "../../llm/types.js";

export const MARCADOR_FIM = "[[FIM]]";

export interface Persona {
  nome: string;
  /** Instrui o LLM a atuar como esse cliente — tom, forma de escrever,
   * padrões de comportamento (curto/ríspido, repete perguntas, muda de
   * ideia, etc). */
  promptSistema: string;
  /** O que o cliente quer alcançar nesta conversa — usado tanto pra guiar o
   * simulador quanto como critério pro LLM-juiz avaliar se a IA ajudou o
   * cliente a chegar lá. */
  objetivo: string;
  /** Limite de turnos do cliente antes de encerrar a simulação à força,
   * mesmo sem o marcador de fim — evita loop/custo descontrolado. */
  maxTurnos: number;
}

function promptDoSimulador(persona: Persona): string {
  return `${persona.promptSistema}

Seu objetivo nesta conversa: ${persona.objetivo}

Você está trocando mensagens de WhatsApp com o atendimento (que pode ser IA ou humano) de uma hamburgueria/pizzaria. Escreva SOMENTE a próxima mensagem que você, como cliente, mandaria — nunca narre, nunca explique o que está fazendo, nunca fale como um assistente.

Quando você sentir que a conversa chegou a um fim natural (conseguiu o que queria, desistiu, ou foi transferido pra um humano), escreva sua última mensagem normalmente e adicione a marca ${MARCADOR_FIM} no final, sozinha, numa linha separada.`;
}

/** Inverte a perspectiva do histórico: o que foi `assistant` na pipeline real
 * (a IA de atendimento) é o que o "cliente" simulado OUVIU, ou seja, vira
 * `user` do ponto de vista deste LLM; o que foi `user` (fala do próprio
 * cliente) vira `assistant` daqui. */
function paraPerspectivaDoCliente(historico: ChatMessage[]): ChatMessage[] {
  return historico
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "user" ? "assistant" : "user",
      content: m.content,
    }));
}

export interface FalaGerada {
  texto: string;
  fim: boolean;
}

/** Gera a próxima fala do cliente simulado, dado o histórico já trocado (na
 * perspectiva real da conversa, role 'user' = cliente / 'assistant' = IA de
 * atendimento — igual ao histórico que `processarMensagem` já usa). */
export async function gerarProximaFalaCliente(persona: Persona, historico: ChatMessage[]): Promise<FalaGerada> {
  const modelo = getChatModel();
  const mensagens: ChatMessage[] = [
    { role: "system", content: promptDoSimulador(persona) },
    ...paraPerspectivaDoCliente(historico),
  ];
  // Precisa de pelo menos uma mensagem de abertura quando o histórico está
  // vazio (primeiro turno) — instrução explícita em vez de depender do
  // modelo preencher um histórico vazio sozinho.
  if (mensagens.length === 1) {
    mensagens.push({ role: "user", content: "(Inicie a conversa agora, mandando sua primeira mensagem pro atendimento.)" });
  }

  const resultado = await modelo.chatCompletion(mensagens, { temperature: 0.8, maxTokens: 300 });
  const bruto = (resultado.content ?? "").trim();
  const fim = bruto.includes(MARCADOR_FIM);
  const texto = bruto.replace(MARCADOR_FIM, "").trim();
  return { texto, fim };
}
