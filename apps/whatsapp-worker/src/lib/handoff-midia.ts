import { CriarHandoffSchema, type CriarHandoffInput } from "@prospect/shared";
import { supabaseAdmin } from "./supabase.js";
import { env } from "./env.js";
import type { MidiaMensagem } from "./ingest.js";

const MOTIVO_POR_TIPO: Record<MidiaMensagem["tipo"], string> = {
  imagem: "Cliente enviou uma imagem, que a IA ainda não processa.",
  audio: "Cliente enviou um áudio, que a IA ainda não processa.",
  video: "Cliente enviou um vídeo, que a IA ainda não processa.",
  documento: "Cliente enviou um documento, que a IA ainda não processa.",
};

/**
 * Versão local e simplificada de `criarHandoff` (ver
 * apps/ai-orchestrator/src/handoffs.ts) — não dá pra importar aquele
 * diretamente porque depende de módulos locais do ai-orchestrator (inclusive
 * o aviso de mensagem em modo teste, que não faz sentido aqui: nenhuma
 * resposta de IA foi gerada, é uma regra determinística do worker). Reusa o
 * mesmo `CriarHandoffSchema` de `@prospect/shared` pra nunca divergir do
 * contrato estruturado do handoff (CLAUDE.md regra 4).
 */
export async function criarHandoffMidiaNaoSuportada(
  atendimentoId: string,
  tipo: MidiaMensagem["tipo"],
): Promise<void> {
  const input: CriarHandoffInput = CriarHandoffSchema.parse({
    atendimento_id: atendimentoId,
    origem: "regra_operacional",
    motivo: MOTIVO_POR_TIPO[tipo],
    resumo: `O cliente mandou um(a) ${tipo} pelo WhatsApp — a IA não processa esse tipo de conteúdo ainda, só texto.`,
    acao_sugerida: "Ver a mídia recebida no atendimento e responder manualmente.",
    prioridade: "normal",
  });

  const { error } = await supabaseAdmin.from("handoffs").insert({ ...input, empresa_id: env.empresaId });
  if (error) {
    throw new Error(`erro_ao_criar_handoff_midia: ${error.message}`);
  }

  await supabaseAdmin
    .from("atendimentos")
    .update({ status: "solicitou_humano" })
    .eq("id", atendimentoId)
    .eq("empresa_id", env.empresaId);
}
