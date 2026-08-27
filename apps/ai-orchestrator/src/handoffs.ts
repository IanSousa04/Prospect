import { CriarHandoffSchema, type CriarHandoffInput } from "@prospect/shared";
import { supabaseAdmin } from "./lib/supabase.js";
import { estaEmModoTeste } from "./lib/modo-teste.js";

const ORIGENS_LEGIVEIS: Record<CriarHandoffInput["origem"], string> = {
  cliente_solicitou: "cliente pediu atendente",
  ia_solicitou: "IA solicitou",
  regra_operacional: "regra operacional",
  falha_conhecimento: "falha de conhecimento",
  acao_sem_permissao: "ação sem permissão",
  alto_risco: "alto risco",
};

/**
 * Só existe pra facilitar teste manual via WhatsApp, sem depender do painel
 * (ver docs/ROADMAP.md §3, "modo teste"). Montada em código a partir dos
 * mesmos campos estruturados do handoff (nunca por um LLM) — mesmo espírito
 * de nunca deixar o Atendente redigir algo que já existe como dado real.
 */
function descreverHandoffParaTeste(input: CriarHandoffInput): string {
  const linhas = [
    "🧪 _[modo teste] handoff registrado_",
    `Origem: ${ORIGENS_LEGIVEIS[input.origem]}`,
    `Prioridade: ${input.prioridade}`,
    `Motivo: ${input.motivo}`,
    `Resumo: ${input.resumo}`,
  ];
  if (input.acao_sugerida) {
    linhas.push(`Ação sugerida: ${input.acao_sugerida}`);
  }
  return linhas.join("\n");
}

/**
 * Cria um handoff direto via supabaseAdmin — mesmo schema Zod que
 * `POST /handoffs` em apps/api usa pro caminho humano (ver plano da camada
 * de IA, "Handoff estruturado": os dois caminhos nunca podem divergir de
 * contrato). O orquestrador não faz round-trip HTTP porque já roda como
 * processo confiável, igual ao whatsapp-worker.
 */
export async function criarHandoff(empresaId: string, input: CriarHandoffInput): Promise<void> {
  const validado = CriarHandoffSchema.parse(input);

  const { error } = await supabaseAdmin.from("handoffs").insert({ ...validado, empresa_id: empresaId });
  if (error) {
    throw new Error(`erro_ao_criar_handoff: ${error.message}`);
  }

  const novoStatus = validado.origem === "cliente_solicitou" ? "cliente_solicitou_humano" : "ia_solicitou_humano";
  await supabaseAdmin
    .from("atendimentos")
    .update({ status: novoStatus })
    .eq("id", validado.atendimento_id)
    .eq("empresa_id", empresaId);

  // Modo teste: manda a descrição estruturada do handoff de volta pro
  // WhatsApp — reaproveita o mesmo caminho de envio de qualquer mensagem de
  // IA (mensagens.remetente='ia', entregue pelo poller do whatsapp-worker),
  // nunca um canal de envio paralelo (CLAUDE.md regra 7).
  if (await estaEmModoTeste()) {
    await supabaseAdmin.from("mensagens").insert({
      empresa_id: empresaId,
      atendimento_id: validado.atendimento_id,
      remetente: "ia",
      conteudo: descreverHandoffParaTeste(validado),
      metadata_json: {},
    });
  }
}
