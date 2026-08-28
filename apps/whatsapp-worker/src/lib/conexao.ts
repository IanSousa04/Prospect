import type { WhatsappStatus } from "@prospect/shared";
import { supabaseAdmin } from "./supabase.js";
import { env } from "./env.js";

/**
 * Publica o status real observado nos eventos do whatsapp-web.js (qr/ready/
 * disconnected) em `whatsapp_conexoes`, pra aba WhatsApp do painel ler — o
 * worker é a única fonte de verdade sobre a conexão (nunca o painel afirma
 * status por conta própria, ver apps/api/src/routes/whatsapp.ts).
 */
export async function publicarStatus(
  status: WhatsappStatus,
  extra: { qr_code?: string | null; numero_conectado?: string | null } = {},
): Promise<void> {
  const { error } = await supabaseAdmin.from("whatsapp_conexoes").upsert(
    {
      empresa_id: env.empresaId,
      status,
      qr_code: extra.qr_code ?? null,
      numero_conectado: extra.numero_conectado ?? null,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: "empresa_id" },
  );
  if (error) {
    console.error("[conexao] falha ao publicar status:", error.message);
  }
}

const INTERVALO_MS = 3000;

/**
 * Consome o campo `comando` que a aba WhatsApp do painel escreve
 * (`POST /whatsapp/desconectar` ou `/reconectar`, ver apps/api) — mesmo
 * formato de fila simples via tabela já usado em src/poller.ts, sem
 * introduzir um sistema de filas novo. Roda desde o início do processo
 * (não só depois de "ready"): "reconectar" pode chegar enquanto ainda está
 * `aguardando_qr` ou até `desconectado` (ex.: usuário cancelou o logout
 * anterior e quer tentar de novo).
 */
export function iniciarPollerConexao(reconectar: () => Promise<void>, desconectar: () => Promise<void>): void {
  setInterval(async () => {
    const { data, error } = await supabaseAdmin
      .from("whatsapp_conexoes")
      .select("comando")
      .eq("empresa_id", env.empresaId)
      .maybeSingle();

    if (error) {
      console.error("[conexao] falha ao ler comando pendente:", error.message);
      return;
    }
    if (!data?.comando) return;

    // Limpa o comando ANTES de executar — evita reexecutar o mesmo comando
    // em ciclos seguintes se a ação demorar mais que INTERVALO_MS.
    await supabaseAdmin
      .from("whatsapp_conexoes")
      .update({ comando: null })
      .eq("empresa_id", env.empresaId);

    try {
      if (data.comando === "desconectar") {
        console.log(`[conexao] comando "desconectar" recebido para a empresa ${env.empresaId}`);
        await desconectar();
      } else if (data.comando === "reconectar") {
        console.log(`[conexao] comando "reconectar" recebido para a empresa ${env.empresaId}`);
        await reconectar();
      }
    } catch (comandoError) {
      console.error(`[conexao] falha ao executar comando "${data.comando}":`, comandoError);
    }
  }, INTERVALO_MS);
}
