import type { Client } from "whatsapp-web.js";
import { textoMensagemVerificacao } from "@prospect/shared";
import { supabaseAdmin } from "./lib/supabase.js";
import { env } from "./lib/env.js";

const INTERVALO_MS = 2000;
/** Lote pequeno: código de verificação é raro por natureza (um por login).
 * Um lote grande aqui só existiria se algo estivesse gerando código em
 * massa, que é exatamente o caso em que NÃO se quer enviar tudo de uma vez. */
const LOTE = 5;
/** Teto de tentativas por código. Uma exceção de `sendMessage` NÃO prova que
 * a mensagem não saiu (timeout depois do envio é um caso real do
 * whatsapp-web.js) — sem teto, um erro persistente viraria uma dezena de
 * mensagens iguais no telefone de um cliente (CLAUDE.md regra 7: nunca
 * enviar em loop). Esgotadas as tentativas, `erro_envio` fica gravado e a
 * página pública diz honestamente que não conseguiu enviar. */
const MAX_TENTATIVAS_ENVIO = 3;

/**
 * Envia os códigos de verificação da página pública de pedido (tarefa 0043).
 *
 * Poller separado do de `mensagens` de propósito: o código de verificação
 * NUNCA entra no histórico da conversa. `mensagens` é o que a IA lê a cada
 * turno pra montar o contexto — um código de acesso ali seria credencial
 * exposta ao modelo (e ao lastro, e ao prompt) sem nenhuma razão de negócio,
 * além de aparecer no painel como se fosse conversa com o cliente.
 *
 * Vale a mesma regra 7 do CLAUDE.md do outro poller: `enviado_em` só é
 * gravado depois de confirmação real da API do WhatsApp, nunca antes. Uma
 * falha fica registrada em `erro_envio` e a página mostra isso ao cliente em
 * vez de dizer "enviamos" sem ter enviado.
 */
export function iniciarPollerVerificacao(client: Client): NodeJS.Timeout {
  return setInterval(async () => {
    const agora = new Date().toISOString();

    const { data: pendentes, error } = await supabaseAdmin
      .from("verificacoes_telefone")
      .select(
        "id, telefone, codigo_envio, tentativas_envio, empresa_id, empresas(nome)",
      )
      .eq("empresa_id", env.empresaId)
      .is("enviado_em", null)
      .not("codigo_envio", "is", null)
      .lt("tentativas_envio", MAX_TENTATIVAS_ENVIO)
      // Código já expirado não é enviado: chegaria depois de morrer e só
      // confundiria o cliente, que tentaria usá-lo.
      .gt("expira_em", agora)
      .order("criado_em", { ascending: true })
      .limit(LOTE);

    if (error) {
      console.error(
        "[poller-verificacao] erro ao buscar códigos pendentes:",
        error.message,
      );
      return;
    }

    for (const verificacao of pendentes ?? []) {
      const nomeEmpresa = (verificacao as any).empresas?.nome ?? "nossa loja";
      const destino = `${verificacao.telefone}@c.us`;

      // Marca a tentativa ANTES de enviar: se o processo morrer entre o envio
      // e a gravação do resultado, a tentativa continua contada — o contrário
      // reenviaria uma mensagem que talvez já tenha chegado.
      const { data: reservado } = await supabaseAdmin
        .from("verificacoes_telefone")
        .update({ tentativas_envio: verificacao.tentativas_envio + 1 })
        .eq("id", verificacao.id)
        .eq("tentativas_envio", verificacao.tentativas_envio)
        .select("id")
        .maybeSingle();

      // Update condicional vazio = outra rodada já pegou este código.
      if (!reservado) continue;

      try {
        await client.sendMessage(
          destino,
          textoMensagemVerificacao(verificacao.codigo_envio!),
        );

        await supabaseAdmin
          .from("verificacoes_telefone")
          // O código em claro é apagado no mesmo update do envio — a partir
          // daqui só o hash sobrevive, e só quem recebeu a mensagem sabe o
          // número.
          .update({
            enviado_em: new Date().toISOString(),
            codigo_envio: null,
            erro_envio: null,
          })
          .eq("id", verificacao.id);
      } catch (sendError) {
        const mensagem =
          sendError instanceof Error ? sendError.message : String(sendError);
        console.error(
          `[poller-verificacao] falha ao enviar código ${verificacao.id}:`,
          mensagem,
        );
        // `enviado_em` continua null — a próxima rodada tenta de novo até o
        // código expirar. `erro_envio` é o que a página pública mostra pro
        // cliente ("não conseguimos enviar"), em vez de deixá-lo esperando
        // uma mensagem que nunca vai chegar.
        await supabaseAdmin
          .from("verificacoes_telefone")
          .update({ erro_envio: mensagem.slice(0, 300) })
          .eq("id", verificacao.id);
      }
    }
  }, INTERVALO_MS);
}
