// Ferramentas da IA e configuração de comportamento — ver
// docs/product/05-ia-conhecimento.md §5.6/§5.7. Permissões por ferramenta
// vivem na tabela `ia_permissoes` (ver ia-permissoes.ts), não aqui.
//
// Regra inviolável (CLAUDE.md #2): ausência de permissão = negado, nunca
// permitido por padrão. Isso é garantido em código: `isPermitido()` nunca
// usa `??` com fallback true, e uma ferramenta sem linha correspondente em
// `ia_permissoes` simplesmente não está no Map.

import { z } from "zod";

/** Toda ferramenta que a IA pode chamar — ver §5.6. Nomes em snake_case,
 * sem acento (mesma convenção do resto do domínio de negócio no código).
 * Espelha exatamente o check constraint de `ia_permissoes.ferramenta`
 * (supabase/migrations/0010_ia_permissoes.sql) — mudar aqui sem migrar o
 * banco quebra a validação. */
export const NOMES_FERRAMENTAS = [
  // catálogo
  "buscar_produtos",
  "buscar_opcoes",
  "buscar_adicionais",
  "buscar_combos",
  "buscar_recomendacoes",
  // cliente
  "consultar_cliente",
  "consultar_historico",
  "atualizar_cliente",
  // pedido
  "consultar_pedido",
  "criar_pedido",
  "adicionar_item",
  "alterar_item",
  "cancelar_pedido",
  "consultar_status",
  // operação
  "consultar_horario",
  "consultar_taxa",
  "consultar_regiao",
  "consultar_politica",
  // conhecimento
  "buscar_conhecimento",
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
  })
  .strict();

export type AtualizarIaConfiguracaoInput = z.infer<typeof AtualizarIaConfiguracaoSchema>;
