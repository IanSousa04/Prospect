import { supabaseAdmin } from "./supabase.js";
import { env } from "./env.js";

export interface MidiaMensagem {
  tipo: "imagem" | "audio" | "video" | "documento";
  mimetype: string;
  storage_path: string;
  tamanho_bytes: number;
}

/** Quando o download da mídia falha (ver lib/media.ts — depende de API
 * interna do WhatsApp Web, pode falhar mesmo com retentativa) — só o tipo,
 * sem storage_path nenhum. Existe pra UI mostrar um indicativo visual claro
 * de "chegou mídia" mesmo sem preview, nunca deixando isso implícito só no
 * texto (pedido explícito do usuário). */
export interface MidiaFalhaMensagem {
  tipo: "imagem" | "audio" | "video" | "documento";
}

export interface MensagemIngerida {
  atendimentoId: string;
  mensagemId: string;
}

/**
 * Garante o cliente e um atendimento aberto para o telefone, e grava a
 * mensagem recebida. Esta é a única porta de entrada de mensagem do cliente
 * no sistema — mantém o schema consistente independente de quem chama.
 *
 * IMPORTANTE (escopo da Fase 1): este worker só ingere mensagens; não gera
 * resposta de IA. A geração de resposta (orquestrador/atendente, ver
 * docs/product/05-ia-conhecimento.md e a referência ao Eddy em
 * docs/product/01-visao-e-principios.md §1.5) é escopo de uma fase seguinte
 * e não deve ser simulada aqui.
 *
 * `midia`: quando presente, referencia um objeto já enviado ao Storage (ver
 * lib/media.ts) — nunca a IA processa isso, só fica disponível pro painel
 * (ver docs/ROADMAP.md §1 "Cliente manda imagem/áudio").
 */
export async function ingerirMensagemCliente(params: {
  telefone: string;
  whatsappId: string;
  nome: string | null;
  conteudo: string;
  midia?: MidiaMensagem;
  midiaFalha?: MidiaFalhaMensagem;
}): Promise<MensagemIngerida> {
  const { telefone, whatsappId, nome, conteudo, midia, midiaFalha } = params;

  const { data: cliente, error: clienteError } = await supabaseAdmin
    .from("clientes")
    .upsert(
      {
        empresa_id: env.empresaId,
        telefone,
        whatsapp_id: whatsappId,
        nome,
        ultima_interacao_em: new Date().toISOString(),
      },
      { onConflict: "empresa_id,telefone" },
    )
    .select()
    .single();

  if (clienteError || !cliente) {
    throw clienteError ?? new Error("falha ao upsertar cliente");
  }

  const { data: atendimentoAberto, error: atendimentoAbertoError } = await supabaseAdmin
    .from("atendimentos")
    .select("id")
    .eq("empresa_id", env.empresaId)
    .eq("cliente_id", cliente.id)
    .neq("status", "resolvido")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Nunca trata erro de consulta como "não achou" — isso criaria um
  // atendimento duplicado por baixo de um problema real (ex.: mais de uma
  // linha não-resolvida pro mesmo cliente, o que .maybeSingle() rejeitaria).
  if (atendimentoAbertoError) {
    throw atendimentoAbertoError;
  }

  let atendimentoId = atendimentoAberto?.id as string | undefined;

  if (!atendimentoId) {
    const { data: novoAtendimento, error: atendimentoError } = await supabaseAdmin
      .from("atendimentos")
      .insert({
        empresa_id: env.empresaId,
        cliente_id: cliente.id,
        status: "ia_atendendo",
      })
      .select("id")
      .single();

    if (atendimentoError || !novoAtendimento) {
      throw atendimentoError ?? new Error("falha ao criar atendimento");
    }
    atendimentoId = novoAtendimento.id;
  }

  const { data: mensagem, error: mensagemError } = await supabaseAdmin
    .from("mensagens")
    .insert({
      empresa_id: env.empresaId,
      atendimento_id: atendimentoId,
      remetente: "cliente",
      conteudo,
      metadata_json: midia ? { midia } : midiaFalha ? { midia_falha: midiaFalha } : {},
    })
    .select("id")
    .single();

  if (mensagemError || !mensagem) {
    throw mensagemError ?? new Error("falha ao inserir mensagem");
  }

  await supabaseAdmin
    .from("atendimentos")
    .update({ ultima_mensagem_em: new Date().toISOString() })
    .eq("id", atendimentoId);

  return { atendimentoId: atendimentoId!, mensagemId: mensagem.id };
}
