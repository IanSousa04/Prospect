// Modo teste com whitelist de números — ver docs/ROADMAP.md §3 e
// supabase/migrations/0011_modo_teste_whitelist.sql.

import { z } from "zod";

export const AtualizarModoTesteSchema = z.object({ modo_teste: z.boolean() }).strict();
export type AtualizarModoTesteInput = z.infer<typeof AtualizarModoTesteSchema>;

export const CriarNumeroWhitelistSchema = z
  .object({ telefone: z.string().trim().regex(/^\d{10,15}$/, "telefone deve conter só dígitos (DDI+DDD+número)") })
  .strict();
export type CriarNumeroWhitelistInput = z.infer<typeof CriarNumeroWhitelistSchema>;

export const AtualizarNumeroWhitelistSchema = z.object({ ativo: z.boolean() }).strict();
export type AtualizarNumeroWhitelistInput = z.infer<typeof AtualizarNumeroWhitelistSchema>;
