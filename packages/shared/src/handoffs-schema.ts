// Schema de criação de handoff — único, compartilhado entre a rota humana
// (POST /handoffs em apps/api) e o ai-orchestrator (que insere direto via
// supabaseAdmin, ver plano da camada de IA). Os dois caminhos nunca podem
// divergir de contrato (CLAUDE.md regra 4: handoff sempre estruturado).

import { z } from "zod";

export const CriarHandoffSchema = z.object({
  atendimento_id: z.string().uuid(),
  origem: z.enum([
    "cliente_solicitou",
    "ia_solicitou",
    "regra_operacional",
    "falha_conhecimento",
    "acao_sem_permissao",
    "alto_risco",
  ]),
  motivo: z.string().min(1),
  resumo: z.string().min(1),
  acao_sugerida: z.string().nullable().optional(),
  prioridade: z.enum(["baixa", "normal", "alta"]).default("normal"),
});

export type CriarHandoffInput = z.infer<typeof CriarHandoffSchema>;
