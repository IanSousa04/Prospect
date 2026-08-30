// Autenticação do CLIENTE FINAL na página pública de pedido (tarefa 0043).
// Nada aqui tem relação com `lib/auth.ts`, que autentica USUÁRIO DE PAINEL
// via Supabase Auth: são dois mundos separados de propósito. Uma sessão
// pública só existe pra rotas `/publico/*` e nunca vira acesso ao painel.
//
// Segredos guardados só como hash (`sha256`): o banco nunca guarda um código
// de verificação nem um token de sessão em claro — a única exceção é
// `verificacoes_telefone.codigo_envio`, que existe enquanto o whatsapp-worker
// não enviou a mensagem e é apagado no envio.
import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  TAMANHO_CODIGO_VERIFICACAO,
  VALIDADE_SESSAO_HORAS,
  MAX_TENTATIVAS_CODIGO,
} from "@prospect/shared";
import { supabaseAdmin } from "./supabase.js";

export interface SessaoPublicaContext {
  sessaoId: string;
  empresaId: string;
  clienteId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    sessaoPublica?: SessaoPublicaContext;
  }
}

export function hashSegredo(valor: string): string {
  return createHash("sha256").update(valor).digest("hex");
}

/** Comparação de hashes em tempo constante — o custo é irrelevante e evita
 * que o tempo de resposta vire um canal lateral pra adivinhar o código. */
export function hashesIguais(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Código de 6 dígitos com `randomInt` (CSPRNG), nunca `Math.random`: é
 * credencial de acesso, ainda que curta e de vida curta. */
export function gerarCodigoVerificacao(): string {
  const maximo = 10 ** TAMANHO_CODIGO_VERIFICACAO;
  return String(randomInt(0, maximo)).padStart(TAMANHO_CODIGO_VERIFICACAO, "0");
}

export function gerarTokenSessao(): string {
  return randomBytes(32).toString("base64url");
}

export { MAX_TENTATIVAS_CODIGO };

/** Cria a sessão do cliente e devolve o token em claro — que é a ÚNICA vez
 * que ele existe fora do navegador dele. */
export async function criarSessaoPublica(
  empresaId: string,
  clienteId: string,
): Promise<{ token: string; expiraEm: string }> {
  const token = gerarTokenSessao();
  const expiraEm = new Date(Date.now() + VALIDADE_SESSAO_HORAS * 3600_000).toISOString();

  const { error } = await supabaseAdmin.from("sessoes_publicas").insert({
    empresa_id: empresaId,
    cliente_id: clienteId,
    token_hash: hashSegredo(token),
    expira_em: expiraEm,
  });

  if (error) throw new Error(`erro_ao_criar_sessao_publica: ${error.message}`);
  return { token, expiraEm };
}

const INTERVALO_REGISTRO_USO_MS = 5 * 60_000;

/**
 * preHandler das rotas `/publico` que exigem cliente identificado. Resolve
 * `empresa_id` e `cliente_id` A PARTIR DA SESSÃO, nunca do corpo ou da URL
 * (CLAUDE.md regra 5) — é por isso que nenhuma rota autenticada da página
 * pública recebe `slug`: o tenant vem do token, não do que o navegador diz.
 */
export async function requireSessaoPublica(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    return reply.code(401).send({ error: "sessao_ausente" });
  }

  const { data, error } = await supabaseAdmin
    .from("sessoes_publicas")
    .select("id, empresa_id, cliente_id, expira_em, ultimo_uso_em")
    .eq("token_hash", hashSegredo(token))
    .maybeSingle();

  if (error) {
    request.log.error(error);
    return reply.code(500).send({ error: "erro_ao_validar_sessao" });
  }
  if (!data) {
    return reply.code(401).send({ error: "sessao_invalida" });
  }
  if (new Date(data.expira_em).getTime() <= Date.now()) {
    // Sessão expirada é apagada na hora: não há nada de útil em manter um
    // token morto por perto, e a página trata 401 pedindo o telefone de novo.
    await supabaseAdmin.from("sessoes_publicas").delete().eq("id", data.id);
    return reply.code(401).send({ error: "sessao_expirada" });
  }

  // Registro de uso amortizado — sem isso seria um UPDATE por request numa
  // rota que a página chama a cada item adicionado ao carrinho.
  if (Date.now() - new Date(data.ultimo_uso_em).getTime() > INTERVALO_REGISTRO_USO_MS) {
    await supabaseAdmin
      .from("sessoes_publicas")
      .update({ ultimo_uso_em: new Date().toISOString() })
      .eq("id", data.id);
  }

  request.sessaoPublica = {
    sessaoId: data.id,
    empresaId: data.empresa_id,
    clienteId: data.cliente_id,
  };
}
