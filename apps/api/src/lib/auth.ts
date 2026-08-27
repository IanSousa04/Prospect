import type { FastifyReply, FastifyRequest } from "fastify";
import { supabaseAuth } from "./supabase.js";

export interface AuthContext {
  usuarioId: string;
  empresaId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/**
 * Extrai e valida o JWT do painel (Authorization: Bearer <token>) e resolve
 * empresa_id a partir de app_metadata — a mesma claim que a RLS usa (ver
 * supabase/migrations/0005_fase1_atendimento.sql, auth_empresa_id()).
 *
 * Regra inviolável (CLAUDE.md #5): nenhuma rota busca empresa_id de outro
 * lugar (query param, body, header) — sempre do token verificado.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    return reply.code(401).send({ error: "missing_token" });
  }

  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data.user) {
    return reply.code(401).send({ error: "invalid_token" });
  }

  const empresaId = data.user.app_metadata?.empresa_id;
  if (typeof empresaId !== "string") {
    return reply.code(403).send({ error: "usuario_sem_empresa" });
  }

  request.auth = { usuarioId: data.user.id, empresaId };
}
