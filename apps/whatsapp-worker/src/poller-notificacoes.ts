import type { Client } from "whatsapp-web.js";
import { supabaseAdmin } from "./lib/supabase.js";
import { env } from "./lib/env.js";

const INTERVALO_MS = 3000;
/** Notificações de status são raras por natureza (uma por transição
 * operacional do card) — lote pequeno só cresce se algo enfileirar em massa,
 * que é exatamente o caso em que não se quer despejar tudo de uma vez. */
const LOTE = 20;
/** Teto de tentativas por notificação, mesmo motivo de
 * `poller-verificacao.ts`: uma exceção de `sendMessage` NÃO prova que a
 * mensagem não saiu (timeout depois do envio é caso real do
 * whatsapp-web.js) — sem teto, um erro persistente viraria dezenas de
 * mensagens iguais no telefone de um cliente (CLAUDE.md regra 7). */
const MAX_TENTATIVAS_ENVIO = 3;

/**
 * Envia ao WhatsApp as notificações de progresso do pedido (status do card
 * movido pra "Na cozinha"/"Pronto"). Poller separado de `mensagens` de
 * propósito: estas mensagens NUNCA entram no histórico da conversa —
 * `mensagens` é o que a IA lê a cada turno e o que o painel exibe como
 * conversa; uma notificação automática ali seria texto que nenhum humano
 * escreveu, poluindo o contexto do modelo (mesma decisão de
 * `verificacoes_telefone`, ver migration 0026).
 *
 * Vale a regra 7 do CLAUDE.md: `enviado_em` só é gravado depois de
 * confirmação real da API do WhatsApp, nunca antes. Falha fica em
 * `erro_envio` e a notificação tenta de novo até esgotar `MAX_TENTATIVAS_ENVIO`.
 */
export function iniciarPollerNotificacoes(client: Client): NodeJS.Timeout {
  return setInterval(async () => {
    const { data: pendentes, error } = await supabaseAdmin
      .from("notificacoes_pedido")
      .select("id, conteudo, tentativas_envio, clientes(whatsapp_id, telefone)")
      .eq("empresa_id", env.empresaId)
      .is("enviado_em", null)
      .lt("tentativas_envio", MAX_TENTATIVAS_ENVIO)
      .order("criado_em", { ascending: true })
      .limit(LOTE);

    if (error) {
      console.error(
        "[poller-notificacoes] erro ao buscar notificações pendentes:",
        error.message,
      );
      return;
    }

    for (const notificacao of pendentes ?? []) {
      const cliente = (notificacao as any).clientes;
      const destino: string | undefined =
        cliente?.whatsapp_id ?? cliente?.telefone;

      if (!destino) {
        console.warn(
          `[poller-notificacoes] notificação ${notificacao.id} sem destino de WhatsApp resolvido, pulando`,
        );
        continue;
      }

      // Marca a tentativa ANTES de enviar: se o processo morrer entre o envio
      // e a gravação do resultado, a tentativa continua contada — o contrário
      // reenviaria uma mensagem que talvez já tenha chegado.
      const { data: reservado } = await supabaseAdmin
        .from("notificacoes_pedido")
        .update({ tentativas_envio: notificacao.tentativas_envio + 1 })
        .eq("id", notificacao.id)
        .eq("tentativas_envio", notificacao.tentativas_envio)
        .select("id")
        .maybeSingle();

      // Update condicional vazio = outra rodada já pegou esta notificação.
      if (!reservado) continue;

      try {
        await client.sendMessage(
          destino.includes("@") ? destino : `${destino}@c.us`,
          notificacao.conteudo,
        );

        await supabaseAdmin
          .from("notificacoes_pedido")
          .update({
            enviado_em: new Date().toISOString(),
            erro_envio: null,
          })
          .eq("id", notificacao.id);
      } catch (sendError) {
        const mensagem =
          sendError instanceof Error ? sendError.message : String(sendError);
        console.error(
          `[poller-notificacoes] falha ao enviar notificação ${notificacao.id}:`,
          mensagem,
        );
        await supabaseAdmin
          .from("notificacoes_pedido")
          .update({ erro_envio: mensagem.slice(0, 300) })
          .eq("id", notificacao.id);
      }
    }
  }, INTERVALO_MS);
}
