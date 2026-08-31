// Ferramentas da IA e configuração de comportamento — ver
// docs/product/05-ia-conhecimento.md §5.6/§5.7. Permissões por ferramenta
// vivem na tabela `ia_permissoes` (ver ia-permissoes.ts), não aqui.
//
// Regra inviolável (CLAUDE.md #2): ausência de permissão = negado, nunca
// permitido por padrão. Isso é garantido em código: `isPermitido()` nunca
// usa `??` com fallback true, e uma ferramenta sem linha correspondente em
// `ia_permissoes` simplesmente não está no Map.

import { z } from "zod";
import { TIPOS_ENTREGA, FORMAS_PAGAMENTO } from "./pedidos.js";

/** Toda ferramenta que a IA pode chamar — ver §5.6. Nomes em snake_case,
 * sem acento (mesma convenção do resto do domínio de negócio no código).
 * Espelha exatamente o check constraint de `ia_permissoes.ferramenta`
 * (supabase/migrations/0010_ia_permissoes.sql, reescrito por migrations
 * posteriores conforme novas ferramentas entram — ver 0013_carrinho_ferramentas.sql,
 * 0014_definir_tipo_entrega.sql, 0015_endereco_cliente.sql, 0016_definir_forma_pagamento.sql)
 * — mudar aqui sem migrar o banco quebra a validação. */
export const NOMES_FERRAMENTAS = [
  // catálogo
  "buscar_produtos",
  "buscar_opcoes",
  "buscar_adicionais",
  "buscar_combos",
  "buscar_recomendacoes",
  // cliente (só leitura)
  "consultar_cliente",
  "consultar_historico",
  // pedido (só leitura — acompanhar, nunca alterar)
  "consultar_pedido",
  "consultar_status",
  // operação
  "consultar_horario",
  "consultar_taxa",
  "consultar_regiao",
  "consultar_politica",
  // conhecimento
  "buscar_conhecimento",
  // prazo de entrega (range fixo configurável, nunca calculado)
  "consultar_prazo_entrega",
  // configuração da própria empresa como evidência auditável —
  // o que a loja oferece de entrega e aceita de pagamento
  "consultar_opcoes_atendimento",
] as const;

export type NomeFerramenta = (typeof NOMES_FERRAMENTAS)[number];

export const ComportamentoJsonSchema = z
  .object({
    fazer_recomendacoes: z.boolean().optional(),
    oferecer_adicionais: z.boolean().optional(),
    oferecer_combos: z.boolean().optional(),
    personalizar_com_historico: z.boolean().optional(),
    upsell_cross_sell: z.boolean().optional(),
    recuperar_intencao_compra: z.boolean().optional(),
    pos_venda: z.boolean().optional(),
    confirmacao_pedido_obrigatoria: z.boolean().optional(),
    limite_itens_por_pedido_sem_confirmacao: z.number().int().positive().optional(),
  })
  .strict();

export type ComportamentoJson = z.infer<typeof ComportamentoJsonSchema>;

export const TONS_DE_VOZ = ["formal", "neutro", "amigavel", "descontraido"] as const;
export type TomDeVoz = (typeof TONS_DE_VOZ)[number];

/** Prazo de entrega: RANGE fixo configurável por empresa (default 60–90 min),
 * a ÚNICA fonte de verdade entre a IA (`consultar_prazo_entrega`) e a página
 * pública (GET /publico/:slug). A IA nunca calcula prazo — sempre lê o range
 * cadastrado (CLAUDE.md regra 1). */
export const PRAZO_ENTREGA_MIN_PADRAO = 60;
export const PRAZO_ENTREGA_MAX_PADRAO = 90;

/** Texto exibido pro cliente final ("60 a 90 min") — compartilhado entre IA
 * e página pública pra nunca divergirem na estimativa. */
export function formatarPrazoEntrega(minMinutos: number, maxMinutos: number): string {
  return minMinutos === maxMinutos ? `${minMinutos} min` : `${minMinutos} a ${maxMinutos} min`;
}

/** Motor de etapas do pedido (tasks/0056/0077/0078) — cada empresa configura
 * quais etapas fazem sentido pro próprio negócio, em vez de toda empresa ser
 * forçada a oferecer entrega E retirada e a sempre perguntar forma de
 * pagamento. Ausência de configuração (empresa nunca salvou nada) cai nos
 * defaults abaixo, que reproduzem o comportamento anterior a esta tarefa —
 * nunca muda o comportamento de uma empresa já em produção sem ação
 * explícita dela. Consumido por `informacoesPendentes()` (pedido-ia.ts). */
export const FluxoPedidoConfigSchema = z
  .object({
    tipos_entrega_oferecidos: z.array(z.enum(TIPOS_ENTREGA)).min(1),
    perguntar_forma_pagamento: z.boolean(),
    formas_pagamento_aceitas: z.array(z.enum(FORMAS_PAGAMENTO)).min(1),
  })
  .strict();

export type FluxoPedidoConfig = z.infer<typeof FluxoPedidoConfigSchema>;

export const FLUXO_PEDIDO_CONFIG_PADRAO: FluxoPedidoConfig = {
  tipos_entrega_oferecidos: [...TIPOS_ENTREGA],
  perguntar_forma_pagamento: true,
  formas_pagamento_aceitas: [...FORMAS_PAGAMENTO],
};

/** Corpo de `PUT /ia-configuracoes` — ver apps/api/src/routes/ia-configuracoes.ts
 * e docs/ROADMAP.md §1 "Fazer valer comportamento_json". `nome_assistente`
 * vazio (string em branco) normaliza pra null na rota — nunca salva string
 * vazia, sempre um nome real ou nada. */
export const AtualizarIaConfiguracaoSchema = z
  .object({
    tom_de_voz: z.enum(TONS_DE_VOZ),
    usa_emoji: z.boolean(),
    nome_assistente: z.string().trim().max(60).nullable(),
    comportamento_json: ComportamentoJsonSchema,
    prazo_entrega_min_minutos: z.number().int().positive(),
    prazo_entrega_max_minutos: z.number().int().positive(),
    fluxo_pedido: FluxoPedidoConfigSchema,
  })
  .strict();

export type AtualizarIaConfiguracaoInput = z.infer<typeof AtualizarIaConfiguracaoSchema>;
