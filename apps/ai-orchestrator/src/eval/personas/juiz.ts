// LLM-juiz: avalia a transcrição completa de um atendimento simulado contra
// os critérios de produto (CLAUDE.md) que são difíceis de checar por regex —
// tom apropriado à personalidade do cliente, se a IA "perdeu o fio" da
// conversa, se a indecisão foi conduzida sem parecer robótica. Nunca decide
// sozinho se algo é handoff indevido ou dado inventado — isso já é checado
// deterministicamente em cenarios.ts; o juiz cobre só o que sobra.
import { getChatModel } from "../../llm/client.js";
import type { ChatMessage } from "../../llm/types.js";

export interface VeredictoJuiz {
  passou: boolean;
  motivo: string;
}

const PROMPT_SISTEMA_JUIZ = `Você é um avaliador de qualidade de atendimento ao cliente via WhatsApp para uma hamburgueria/pizzaria. Vai receber a transcrição completa de uma conversa entre um cliente (com uma personalidade específica) e a IA de atendimento da empresa, junto com o objetivo do cliente naquela conversa.

Avalie SOMENTE:
1. A IA conduziu a conversa de forma apropriada ao jeito daquele cliente (ex.: mais direta com cliente apressado/nervoso, mais paciente com cliente confuso/indeciso)?
2. A IA manteve o fio da conversa (não se contradisse, não esqueceu o que já tinha sido dito, não repetiu a mesma pergunta sem necessidade)?
3. A IA ajudou o cliente a progredir em direção ao objetivo dele (mesmo que o objetivo inclua mudar de ideia várias vezes)?

NÃO avalie se houve handoff, se algum preço bate com o catálogo, ou se algum dado foi inventado — isso já é verificado por outro processo. Ignore completamente esses pontos na sua nota.

Responda APENAS com um JSON no formato: {"passou": true ou false, "motivo": "explicação curta em português"}`;

export async function julgarConducaoDaConversa(params: {
  nomePersona: string;
  objetivo: string;
  transcricao: ChatMessage[];
}): Promise<VeredictoJuiz> {
  const modelo = getChatModel();
  const transcricaoTexto = params.transcricao
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "CLIENTE" : "IA"}: ${m.content}`)
    .join("\n");

  const mensagens: ChatMessage[] = [
    { role: "system", content: PROMPT_SISTEMA_JUIZ },
    {
      role: "user",
      content: `Personalidade do cliente: ${params.nomePersona}\nObjetivo do cliente: ${params.objetivo}\n\nTranscrição:\n${transcricaoTexto}`,
    },
  ];

  const resultado = await modelo.chatCompletion(mensagens, { temperature: 0, jsonMode: true, maxTokens: 300 });
  try {
    const dados = JSON.parse(resultado.content ?? "{}") as { passou?: unknown; motivo?: unknown };
    if (typeof dados.passou !== "boolean") {
      return { passou: false, motivo: "juiz não retornou um veredicto booleano válido" };
    }
    return { passou: dados.passou, motivo: typeof dados.motivo === "string" ? dados.motivo : "" };
  } catch {
    return { passou: false, motivo: `juiz retornou JSON inválido: ${resultado.content}` };
  }
}
