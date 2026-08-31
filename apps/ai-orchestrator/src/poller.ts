import {
  mapaDePermissoes,
  ComportamentoJsonSchema,
  FluxoPedidoConfigSchema,
  FLUXO_PEDIDO_CONFIG_PADRAO,
  type ComportamentoJson,
  type FluxoPedidoConfig,
  type IaPermissao,
  type NomeFerramenta,
} from "@prospect/shared";
import { supabaseAdmin } from "./lib/supabase.js";
import { env } from "./lib/env.js";
import { processarMensagem } from "./agent/orquestrador.js";
import type { ChatMessage } from "./llm/types.js";
import type { ToolContext } from "./tools/index.js";

const LIMITE_MENSAGENS_IA_POR_MINUTO = 5;
const JANELA_HISTORICO = 40;
/** Debounce de rajada — ver docs/ROADMAP.md §3 "Agrupar mensagens rápidas do
 * cliente antes de responder". Um atendimento só é processado quando passam
 * pelo menos esse tempo desde a última mensagem de cliente recebida nele;
 * enquanto isso, o poller espera (o timer reseta a cada nova mensagem), pra
 * tratar tudo que chegou na janela como um único turno em vez de responder
 * fragmentado. Precisa ser maior que `pollingIntervaloMs` (padrão 3s) pra
 * dar pelo menos um ciclo de folga real. */
const DEBOUNCE_RAJADA_MS = 8_000;

interface MensagemCliente {
  id: string;
  atendimento_id: string;
  conteudo: string;
  criado_em: string;
  metadata_json: Record<string, unknown> | null;
}

async function carregarConfigIa(empresaId: string): Promise<{
  permissoes: Map<NomeFerramenta, IaPermissao>;
  tomDeVoz: "formal" | "neutro" | "amigavel" | "descontraido";
  usaEmoji: boolean;
  nomeAssistente: string | null;
  comportamento: ComportamentoJson;
  fluxoPedido: FluxoPedidoConfig;
  linkPublico: string | null;
}> {
  const [{ data: config }, { data: permissoesRows }, { data: empresa }] = await Promise.all([
    supabaseAdmin
      .from("ia_configuracoes")
      .select("tom_de_voz, usa_emoji, nome_assistente, comportamento_json, fluxo_pedido_json")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    supabaseAdmin.from("ia_permissoes").select("*").eq("empresa_id", empresaId),
    supabaseAdmin.from("empresas").select("slug").eq("id", empresaId).maybeSingle(),
  ]);

  // Nunca confia no shape cru do banco (pode estar vazio/desatualizado em
  // linhas antigas) — sempre valida com o schema antes de usar, mesmo
  // espírito de `isPermitido` nunca usar `?? true` (CLAUDE.md regra 2, ver
  // packages/shared/src/types.ts comentário em IaConfiguracao).
  const comportamentoParseado = ComportamentoJsonSchema.safeParse(config?.comportamento_json ?? {});
  const fluxoPedidoParseado = FluxoPedidoConfigSchema.safeParse(config?.fluxo_pedido_json ?? {});

  const slug = empresa?.slug ?? null;
  // A página pública do pedido vive em /delivery/:slug (apps/web/src/App.tsx) —
  // sem esse segmento o link apontaria pra uma rota que não existe.
  const linkPublico = slug && env.publicoBaseUrl ? `${env.publicoBaseUrl.replace(/\/+$/, "")}/delivery/${slug}` : null;

  return {
    // sem linha em ia_permissoes pra uma ferramenta = nenhuma permissão —
    // nunca `?? true` (CLAUDE.md regra 2).
    permissoes: mapaDePermissoes((permissoesRows ?? []) as IaPermissao[]),
    tomDeVoz: config?.tom_de_voz ?? "amigavel",
    usaEmoji: config?.usa_emoji ?? true,
    nomeAssistente: config?.nome_assistente ?? null,
    comportamento: comportamentoParseado.success ? comportamentoParseado.data : {},
    fluxoPedido: fluxoPedidoParseado.success ? fluxoPedidoParseado.data : FLUXO_PEDIDO_CONFIG_PADRAO,
    linkPublico,
  };
}

async function jaProcessada(mensagemId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("ia_decisoes")
    .select("id")
    .eq("mensagem_id", mensagemId)
    .maybeSingle();
  return !!data;
}

/** Marca as mensagens mais antigas de uma rajada como "resolvidas dentro da
 * pergunta de outra mensagem" — sem isso, elas nunca ganham linha própria em
 * `ia_decisoes` (só a mais nova da rajada, usada como gatilho, ganha) e
 * ficariam sendo recandidatadas a processamento pra sempre. */
async function marcarComoAgrupada(mensagemId: string, gatilhoId: string): Promise<void> {
  await supabaseAdmin
    .from("mensagens")
    .update({ metadata_json: { agrupada_em: gatilhoId } })
    .eq("id", mensagemId);
}

async function atendimentoElegivel(atendimentoId: string, empresaId: string): Promise<{ id: string; cliente_id: string } | null> {
  const { data } = await supabaseAdmin
    .from("atendimentos")
    .select("id, status, cliente_id")
    .eq("id", atendimentoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (!data || data.status !== "ia_atendendo") return null;
  return { id: data.id, cliente_id: data.cliente_id };
}

/** Nunca empilha uma segunda resposta de IA enquanto a anterior ainda não
 * foi entregue (nem de verdade, nem em modo sombra) — evita a IA "atropelar"
 * a própria resposta se o polling rodar mais rápido que o envio. */
async function existeRespostaIaPendente(atendimentoId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("mensagens")
    .select("id")
    .eq("empresa_id", env.empresaId)
    .eq("atendimento_id", atendimentoId)
    .eq("remetente", "ia")
    .is("metadata_json->>enviado_em", null)
    .is("metadata_json->>simulado_em", null)
    .maybeSingle();
  return !!data;
}

/** Limite duro de mensagens de IA por atendimento por minuto — proteção
 * contra loop de geração (bug no orquestrador não deve virar spam de
 * mensagem, CLAUDE.md regra 7). */
async function excedeuLimiteDeTaxa(atendimentoId: string): Promise<boolean> {
  const umMinutoAtras = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabaseAdmin
    .from("mensagens")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", env.empresaId)
    .eq("atendimento_id", atendimentoId)
    .eq("remetente", "ia")
    .gte("criado_em", umMinutoAtras);
  return (count ?? 0) >= LIMITE_MENSAGENS_IA_POR_MINUTO;
}

async function montarHistorico(atendimentoId: string, antesDe: string): Promise<ChatMessage[]> {
  const { data } = await supabaseAdmin
    .from("mensagens")
    .select("remetente, conteudo, criado_em")
    .eq("empresa_id", env.empresaId)
    .eq("atendimento_id", atendimentoId)
    .lt("criado_em", antesDe)
    .order("criado_em", { ascending: true })
    .limit(JANELA_HISTORICO);

  return (data ?? []).map((m) => ({
    role: m.remetente === "cliente" ? "user" : "assistant",
    content: m.conteudo,
  }));
}

/**
 * Processa uma rajada inteira (uma ou mais mensagens de cliente acumuladas
 * dentro da janela de debounce) como um único turno — ver
 * DEBOUNCE_RAJADA_MS. `rajada` já vem em ordem cronológica; a mais recente é
 * o gatilho (dona do `mensagem_id` em `ia_decisoes`) e o corte do histórico
 * usa o horário da mais antiga, pra não duplicar as próprias mensagens da
 * rajada (que entram como `pergunta`) dentro do histórico carregado.
 */
async function processarUmaMensagem(rajada: MensagemCliente[]): Promise<void> {
  const gatilho = rajada[rajada.length - 1]!;
  const maisAntiga = rajada[0]!;

  const atendimento = await atendimentoElegivel(gatilho.atendimento_id, env.empresaId);
  if (!atendimento) return;

  if (await existeRespostaIaPendente(atendimento.id)) return;
  if (await excedeuLimiteDeTaxa(atendimento.id)) {
    console.warn(`[ai-orchestrator] limite de mensagens/min atingido no atendimento ${atendimento.id} — pulando ciclo`);
    return;
  }

  const [config, historico] = await Promise.all([
    carregarConfigIa(env.empresaId),
    montarHistorico(atendimento.id, maisAntiga.criado_em),
  ]);

  const ctx: ToolContext = {
    empresaId: env.empresaId,
    atendimentoId: atendimento.id,
    clienteId: atendimento.cliente_id,
    permissoes: config.permissoes,
    mensagemId: gatilho.id,
    comportamento: config.comportamento,
    fluxoPedido: config.fluxoPedido,
  };

  // Rajada vira um único turno — todas as mensagens acumuladas na janela de
  // silêncio são tratadas como uma pergunta só (ver docs/ROADMAP.md §3).
  const pergunta = rajada.map((m) => m.conteudo).join("\n");

  const resultado = await processarMensagem({
    pergunta,
    historico,
    ctx,
    tomDeVoz: config.tomDeVoz,
    usaEmoji: config.usaEmoji,
    nomeAssistente: config.nomeAssistente,
    comportamento: config.comportamento,
    linkPublico: config.linkPublico,
  });

  // As mensagens mais antigas da rajada não geram linha própria em
  // ia_decisoes (só o gatilho gera, via ctx.mensagemId acima) — marca todas
  // como agrupadas nele pra não ficarem sendo recandidatadas todo ciclo.
  await Promise.all(rajada.slice(0, -1).map((m) => marcarComoAgrupada(m.id, gatilho.id)));

  if (!resultado.respostaTexto) {
    // orquestrador já criou o handoff estruturado e moveu o atendimento —
    // nada mais a fazer aqui. Note que handoff NEM SEMPRE implica ausência
    // de resposta: o handoff por pedido explícito do cliente ("quero
    // atendente") sempre carrega uma confirmação de transferência (texto
    // fixo, ver agent/deteccao.ts) — esse caminho passa direto.
    return;
  }

  await supabaseAdmin.from("mensagens").insert({
    empresa_id: env.empresaId,
    atendimento_id: atendimento.id,
    remetente: "ia",
    conteudo: resultado.respostaTexto,
    metadata_json: {},
  });

  await supabaseAdmin
    .from("atendimentos")
    .update({ ultima_mensagem_em: new Date().toISOString() })
    .eq("id", atendimento.id);
}

let emExecucao = false;

export function iniciarPoller(): void {
  setInterval(async () => {
    if (emExecucao) return; // nunca sobrepõe um ciclo ainda em andamento
    emExecucao = true;
    try {
      // Busca as mensagens de cliente MAIS RECENTES (não as mais antigas —
      // senão, depois de acumular volume, o poller nunca alcançaria
      // mensagem nova nenhuma) e ordena de volta pra processar da mais
      // antiga pra mais nova dentro desse lote.
      const { data: candidatos, error } = await supabaseAdmin
        .from("mensagens")
        .select("id, atendimento_id, conteudo, criado_em, metadata_json")
        .eq("empresa_id", env.empresaId)
        .eq("remetente", "cliente")
        .order("criado_em", { ascending: false })
        .limit(50);

      if (error) {
        console.error("[ai-orchestrator] erro ao buscar mensagens novas:", error.message);
        return;
      }

      const ordenadas = ((candidatos ?? []) as MensagemCliente[]).reverse();

      // Mensagem já com decisão própria (é o gatilho de uma rajada já
      // processada) ou já dobrada dentro da rajada de outra mensagem — não
      // é candidata a um novo turno.
      const pendentes: MensagemCliente[] = [];
      for (const msg of ordenadas) {
        if (msg.metadata_json?.agrupada_em) continue;
        if (await jaProcessada(msg.id)) continue;
        pendentes.push(msg);
      }

      const porAtendimento = new Map<string, MensagemCliente[]>();
      for (const msg of pendentes) {
        const grupo = porAtendimento.get(msg.atendimento_id) ?? [];
        grupo.push(msg);
        porAtendimento.set(msg.atendimento_id, grupo);
      }

      for (const [atendimentoId, rajada] of porAtendimento) {
        const ultima = rajada[rajada.length - 1]!;
        const silencioMs = Date.now() - new Date(ultima.criado_em).getTime();
        if (silencioMs < DEBOUNCE_RAJADA_MS) {
          // Ainda dentro da janela de rajada — pode chegar mais mensagem do
          // cliente; espera o próximo ciclo em vez de responder fragmentado.
          continue;
        }

        try {
          await processarUmaMensagem(rajada);
        } catch (erro) {
          console.error(`[ai-orchestrator] falha ao processar rajada do atendimento ${atendimentoId}:`, erro);
        }
      }
    } finally {
      emExecucao = false;
    }
  }, env.pollingIntervaloMs);
}
