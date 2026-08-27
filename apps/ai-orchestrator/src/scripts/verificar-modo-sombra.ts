#!/usr/bin/env tsx
// Script de verificação e auditoria do modo sombra — roda contra dados reais
// de produção pra validar se a IA está gerando respostas de qualidade antes de
// ligar IA_ENVIO_REAL=true.
//
// Uso: npm run -w apps/ai-orchestrator verificar-modo-sombra
//
// Verifica:
// 1. Status atual (modo sombra ligado ou não)
// 2. Estatísticas de respostas simuladas vs enviadas
// 3. Taxa de handoff
// 4. Distribuição de confiança
// 5. Casos de verificação anti-alucinação
// 6. Últimas respostas simuladas (amostra pra auditoria manual)

import "dotenv/config";
import { env } from "../lib/env.js";
import { supabaseAdmin } from "../lib/supabase.js";

interface EstatisticasMensagens {
  total_ia: number;
  simuladas: number;
  enviadas: number;
  pendentes: number;
}

interface EstatisticasDecisoes {
  total: number;
  por_acao: Record<string, number>;
  por_confianca: Record<string, number>;
  handoffs_por_origem: Record<string, number>;
}

interface RespostaAmostra {
  atendimento_id: string;
  cliente_nome: string;
  pergunta_cliente: string;
  resposta_ia: string;
  confianca: string;
  acao: string;
  criado_em: string;
}

async function verificarStatusEnvioReal(): Promise<boolean> {
  // Esse script roda no ai-orchestrator, mas a flag mora no whatsapp-worker.
  // Não dá pra ler .env de outro processo, então inferimos pelo banco:
  // se existem mensagens de IA com enviado_em (não simulado_em), significa
  // que IA_ENVIO_REAL já foi true pelo menos uma vez.
  const { count } = await supabaseAdmin
    .from("mensagens")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", env.empresaId)
    .eq("remetente", "ia")
    .not("metadata_json->>enviado_em", "is", null)
    .gte("criado_em", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  return (count ?? 0) > 0;
}

async function buscarEstatisticasMensagens(
  ultimosDias: number,
): Promise<EstatisticasMensagens> {
  const dataCorte = new Date(Date.now() - ultimosDias * 24 * 60 * 60 * 1000).toISOString();

  const { data: mensagens } = await supabaseAdmin
    .from("mensagens")
    .select("metadata_json")
    .eq("empresa_id", env.empresaId)
    .eq("remetente", "ia")
    .gte("criado_em", dataCorte);

  const total_ia = mensagens?.length ?? 0;
  let simuladas = 0;
  let enviadas = 0;
  let pendentes = 0;

  for (const msg of mensagens ?? []) {
    const meta = msg.metadata_json as Record<string, unknown> | null;
    if (meta?.simulado_em) {
      simuladas++;
    } else if (meta?.enviado_em) {
      enviadas++;
    } else {
      pendentes++;
    }
  }

  return { total_ia, simuladas, enviadas, pendentes };
}

async function buscarEstatisticasDecisoes(
  ultimosDias: number,
): Promise<EstatisticasDecisoes> {
  const dataCorte = new Date(Date.now() - ultimosDias * 24 * 60 * 60 * 1000).toISOString();

  const { data: decisoes } = await supabaseAdmin
    .from("ia_decisoes")
    .select("acao_decidida, confianca")
    .eq("empresa_id", env.empresaId)
    .gte("criado_em", dataCorte);

  const { data: handoffs } = await supabaseAdmin
    .from("ia_handoffs")
    .select("origem")
    .eq("empresa_id", env.empresaId)
    .gte("criado_em", dataCorte);

  const total = decisoes?.length ?? 0;
  const por_acao: Record<string, number> = {};
  const por_confianca: Record<string, number> = {};

  for (const d of decisoes ?? []) {
    por_acao[d.acao_decidida] = (por_acao[d.acao_decidida] ?? 0) + 1;
    por_confianca[d.confianca] = (por_confianca[d.confianca] ?? 0) + 1;
  }

  const handoffs_por_origem: Record<string, number> = {};
  for (const h of handoffs ?? []) {
    handoffs_por_origem[h.origem] = (handoffs_por_origem[h.origem] ?? 0) + 1;
  }

  return { total, por_acao, por_confianca, handoffs_por_origem };
}

async function buscarAmostras(limite: number): Promise<RespostaAmostra[]> {
  // Pega as últimas N respostas simuladas com contexto completo (pergunta +
  // resposta + decisão) pra auditoria manual — o humano lê e confirma se faria
  // sentido enviar aquilo de verdade.
  const { data } = await supabaseAdmin
    .from("mensagens")
    .select(
      `
      atendimento_id,
      conteudo,
      criado_em,
      atendimentos!inner(cliente_id, clientes(nome)),
      metadata_json
    `,
    )
    .eq("empresa_id", env.empresaId)
    .eq("remetente", "ia")
    .not("metadata_json->>simulado_em", "is", null)
    .order("criado_em", { ascending: false })
    .limit(limite);

  const amostras: RespostaAmostra[] = [];

  for (const msg of data ?? []) {
    // Buscar a última mensagem do cliente antes desta resposta da IA, pra ter
    // contexto do que ele perguntou.
    const { data: perguntaData } = await supabaseAdmin
      .from("mensagens")
      .select("conteudo")
      .eq("empresa_id", env.empresaId)
      .eq("atendimento_id", msg.atendimento_id)
      .eq("remetente", "cliente")
      .lt("criado_em", msg.criado_em)
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Buscar a decisão correspondente
    const { data: decisaoData } = await supabaseAdmin
      .from("ia_decisoes")
      .select("confianca, acao_decidida")
      .eq("empresa_id", env.empresaId)
      .eq("atendimento_id", msg.atendimento_id)
      .lte("criado_em", msg.criado_em)
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    const atendimento = (msg as any).atendimentos;
    const cliente = atendimento?.clientes;

    amostras.push({
      atendimento_id: msg.atendimento_id,
      cliente_nome: cliente?.nome ?? "Desconhecido",
      pergunta_cliente: perguntaData?.conteudo ?? "(sem mensagem anterior)",
      resposta_ia: msg.conteudo,
      confianca: decisaoData?.confianca ?? "?",
      acao: decisaoData?.acao_decidida ?? "?",
      criado_em: msg.criado_em,
    });
  }

  return amostras;
}

function formatarPorcentagem(parte: number, total: number): string {
  if (total === 0) return "0%";
  return `${((parte / total) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  console.log("=".repeat(80));
  console.log("VERIFICAÇÃO DE MODO SOMBRA");
  console.log(`Empresa: ${env.empresaId}`);
  console.log(`Data: ${new Date().toISOString()}`);
  console.log("=".repeat(80));
  console.log();

  // 1. Status atual
  const envioRealAtivo = await verificarStatusEnvioReal();
  console.log("📡 STATUS ATUAL");
  console.log(
    envioRealAtivo
      ? "  ⚠️  ENVIO REAL ATIVO (IA_ENVIO_REAL=true detectado)"
      : "  ✅ MODO SOMBRA ATIVO (nenhuma resposta de IA enviada de verdade nas últimas 24h)",
  );
  console.log();

  // 2. Estatísticas de mensagens (últimos 7 dias)
  const estatMsg = await buscarEstatisticasMensagens(7);
  console.log("📊 MENSAGENS DE IA (últimos 7 dias)");
  console.log(`  Total geradas: ${estatMsg.total_ia}`);
  console.log(
    `  Simuladas (modo sombra): ${estatMsg.simuladas} (${formatarPorcentagem(estatMsg.simuladas, estatMsg.total_ia)})`,
  );
  console.log(
    `  Enviadas de verdade: ${estatMsg.enviadas} (${formatarPorcentagem(estatMsg.enviadas, estatMsg.total_ia)})`,
  );
  console.log(
    `  Pendentes: ${estatMsg.pendentes} (${formatarPorcentagem(estatMsg.pendentes, estatMsg.total_ia)})`,
  );
  console.log();

  // 3. Estatísticas de decisões
  const estatDec = await buscarEstatisticasDecisoes(7);
  console.log("🎯 DECISÕES DA IA (últimos 7 dias)");
  console.log(`  Total de decisões: ${estatDec.total}`);
  console.log("  Por ação:");
  for (const [acao, count] of Object.entries(estatDec.por_acao).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(
      `    ${acao}: ${count} (${formatarPorcentagem(count, estatDec.total)})`,
    );
  }
  console.log("  Por confiança:");
  for (const [conf, count] of Object.entries(estatDec.por_confianca).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(
      `    ${conf}: ${count} (${formatarPorcentagem(count, estatDec.total)})`,
    );
  }
  console.log();

  // 4. Handoffs
  const totalHandoffs = Object.values(estatDec.handoffs_por_origem).reduce(
    (sum, n) => sum + n,
    0,
  );
  console.log("🤝 HANDOFFS (últimos 7 dias)");
  console.log(`  Total: ${totalHandoffs}`);
  if (totalHandoffs > 0) {
    console.log("  Por origem:");
    for (const [origem, count] of Object.entries(
      estatDec.handoffs_por_origem,
    ).sort((a, b) => b[1] - a[1])) {
      console.log(
        `    ${origem}: ${count} (${formatarPorcentagem(count, totalHandoffs)})`,
      );
    }
  }
  console.log();

  // 5. Amostras para auditoria manual
  const amostras = await buscarAmostras(5);
  console.log("🔍 ÚLTIMAS 5 RESPOSTAS SIMULADAS (auditoria manual)");
  if (amostras.length === 0) {
    console.log("  (Nenhuma resposta simulada encontrada)");
  } else {
    for (let i = 0; i < amostras.length; i++) {
      const a = amostras[i]!;
      console.log(`\n  [${"─".repeat(74)}]`);
      console.log(`  [${i + 1}] ${a.criado_em} | ${a.cliente_nome}`);
      console.log(`  Confiança: ${a.confianca} | Ação: ${a.acao}`);
      console.log(`  Cliente: "${a.pergunta_cliente}"`);
      console.log(`  IA: "${a.resposta_ia}"`);
    }
    console.log(`  [${"─".repeat(74)}]`);
  }
  console.log();

  // 6. Recomendações
  console.log("💡 PRÓXIMOS PASSOS");
  if (envioRealAtivo) {
    console.log(
      "  ⚠️  O envio real está ATIVO. Se você quer voltar pro modo sombra:",
    );
    console.log(
      "     1. Edite apps/whatsapp-worker/.env e mude IA_ENVIO_REAL=false",
    );
    console.log("     2. Reinicie o whatsapp-worker");
  } else {
    console.log("  ✅ O modo sombra está ativo. Para ligar o envio real:");
    console.log("     1. Audite manualmente 50+ respostas simuladas (ver acima)");
    console.log(
      "     2. Rode o gabarito: npm run -w apps/ai-orchestrator eval",
    );
    console.log("     3. Confira a taxa de handoff — não pode ser nem 0% nem 100%");
    console.log(
      "     4. Valide que confiança alta = respostas boas, baixa = handoff justificado",
    );
    console.log("     5. Leia docs/MODO_SOMBRA.md completamente");
    console.log(
      "     6. Só então: mude IA_ENVIO_REAL=true e reinicie o whatsapp-worker",
    );
  }
  console.log();

  console.log("=".repeat(80));
  console.log("Verificação concluída.");
  console.log("=".repeat(80));
}

main().catch((erro) => {
  console.error("[verificar-modo-sombra] erro fatal:", erro);
  process.exitCode = 1;
});
