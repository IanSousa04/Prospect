// Simulação de atendimentos completos com personas variadas (ver
// tasks/0073-simulacao_personas_atendimento.md) — complementar ao gabarito
// (eval/gabarito.ts, casos de 1 turno) e ao simulador de UI (tarefa 0012).
// Roda separado do `npm run eval` porque é mais caro/lento: cada cenário é
// uma conversa real de vários turnos com LLM de verdade dos dois lados
// (cliente simulado + IA de atendimento), mais um LLM-juiz ao final.
//
// Uso: npm run -w apps/ai-orchestrator simular-conversas
import "dotenv/config";
import { env } from "../../lib/env.js";
import { resetUsoAcumulado, lerUsoAcumulado } from "../../llm/client.js";
import { CENARIOS_PERSONAS } from "./definicoes.js";
import { rodarCenarioPersona } from "./cenarios.js";

function formatarUso(uso: { promptTokens: number; completionTokens: number }): string {
  return `${(uso.promptTokens + uso.completionTokens).toLocaleString("pt-BR")} tokens (${uso.promptTokens.toLocaleString("pt-BR")} prompt + ${uso.completionTokens.toLocaleString("pt-BR")} completion)`;
}

async function main(): Promise<void> {
  let falhas = 0;
  const usoTotal = { promptTokens: 0, completionTokens: 0 };

  console.log(`== Simulação de atendimentos com personas (empresa ${env.empresaId}) ==\n`);

  for (const def of CENARIOS_PERSONAS) {
    process.stdout.write(`▶ ${def.persona.nome}... `);
    resetUsoAcumulado();
    try {
      const resultado = await rodarCenarioPersona(def);
      const usoCenario = lerUsoAcumulado();
      usoTotal.promptTokens += usoCenario.promptTokens;
      usoTotal.completionTokens += usoCenario.completionTokens;

      if (resultado.ok) {
        console.log(`✓ (${resultado.turnos.length} turnos, ${formatarUso(usoCenario)})`);
      } else {
        falhas++;
        console.log(`✗ (${resultado.turnos.length} turnos, ${formatarUso(usoCenario)})`);
        for (const motivo of resultado.motivosFalha) {
          console.log(`    - ${motivo}`);
        }
        console.log("    Transcrição:");
        for (const turno of resultado.turnos) {
          console.log(`      CLIENTE: ${turno.cliente}`);
          console.log(`      IA (${turno.acao}): ${turno.ia ?? "(sem resposta automática — handoff)"}`);
        }
      }
    } catch (erro) {
      const usoCenario = lerUsoAcumulado();
      usoTotal.promptTokens += usoCenario.promptTokens;
      usoTotal.completionTokens += usoCenario.completionTokens;
      falhas++;
      console.log(`✗ erro ao rodar: ${erro instanceof Error ? erro.message : erro}`);
    }
  }

  const total = CENARIOS_PERSONAS.length;
  console.log(`\n${total - falhas}/${total} cenários passaram.`);
  console.log(`Uso total de tokens (DeepSeek): ${formatarUso(usoTotal)}.`);
  if (falhas > 0) {
    process.exitCode = 1;
  }
}

main().catch((erro) => {
  console.error("[simular-conversas] falha fatal:", erro);
  process.exitCode = 1;
});
