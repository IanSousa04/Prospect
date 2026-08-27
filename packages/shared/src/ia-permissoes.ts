// Permissões da IA — uma linha por empresa+ferramenta em `ia_permissoes`
// (ver supabase/migrations/0010_ia_permissoes.sql). Substitui o antigo
// `ia_configuracoes.permissoes_json`: uma UI de gerenciamento precisa de
// linhas reais (validação por campo, RLS granular), não de um blob jsonb.

import { z } from "zod";
import { NOMES_FERRAMENTAS, type NomeFerramenta } from "./ia-config.js";
import type { IaPermissao } from "./types.js";

export const CriarOuAtualizarPermissaoSchema = z
  .object({
    ferramenta: z.enum(NOMES_FERRAMENTAS),
    permitido: z.boolean(),
    exige_confirmacao_humana: z.boolean().nullable().optional(),
    valor_maximo_sem_handoff: z.number().nonnegative().nullable().optional(),
    condicoes_json: z
      .object({ status_permitidos: z.array(z.string()).optional() })
      .strict()
      .nullable()
      .optional(),
    campos_permitidos: z.array(z.string()).nullable().optional(),
  })
  .strict();

export type CriarOuAtualizarPermissaoInput = z.infer<typeof CriarOuAtualizarPermissaoSchema>;

/** Monta um Map por ferramenta a partir das linhas retornadas do banco —
 * forma conveniente de consultar permissão sem varrer array a cada checagem. */
export function mapaDePermissoes(linhas: IaPermissao[]): Map<NomeFerramenta, IaPermissao> {
  return new Map(linhas.map((linha) => [linha.ferramenta, linha]));
}

/**
 * Única fonte de verdade de "essa ferramenta pode rodar" — nunca
 * reimplementar essa checagem inline em outro lugar. Ausência de linha
 * (ferramenta nunca configurada) = negado, sempre. Nunca `??` com fallback true.
 */
export function isPermitido(permissoes: Map<NomeFerramenta, IaPermissao>, tool: NomeFerramenta): boolean {
  return permissoes.get(tool)?.permitido === true;
}
