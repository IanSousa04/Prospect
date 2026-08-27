// Gabarito/eval da camada de IA — rede de segurança de regressão (ver
// docs/ROADMAP.md §1, "Passo 7 do plano da camada de IA"). Roda os casos
// determinísticos (código, grátis, instantâneo) e depois os de ponta a
// ponta (LLM de verdade, custa tokens). Saída não-zero se algo falhar.
//
// Uso: npm run -w apps/ai-orchestrator eval
import "dotenv/config";
import { env } from "../lib/env.js";
import { CASOS_DETERMINISTICOS } from "./deterministicos.js";
import { montarCasosE2E, rodarCasoE2E } from "./casos-e2e.js";

async function main(): Promise<void> {
  let falhas = 0;

  console.log("== Casos determinísticos (código, sem LLM) ==");
  for (const caso of CASOS_DETERMINISTICOS) {
    const motivo = caso.rodar();
    if (motivo) {
      falhas++;
      console.log(`✗ ${caso.nome}\n    ${motivo}`);
    } else {
      console.log(`✓ ${caso.nome}`);
    }
  }

  console.log("\n== Casos de ponta a ponta (LLM real, empresa " + env.empresaId + ") ==");
  const casosE2E = await montarCasosE2E(env.empresaId);
  for (const caso of casosE2E) {
    try {
      const resultado = await rodarCasoE2E(caso);
      if (resultado.ok) {
        console.log(`✓ ${caso.nome}`);
      } else {
        falhas++;
        console.log(`✗ ${caso.nome}\n    ${resultado.motivo}`);
      }
    } catch (erro) {
      falhas++;
      console.log(`✗ ${caso.nome}\n    erro ao rodar: ${erro instanceof Error ? erro.message : erro}`);
    }
  }

  const total = CASOS_DETERMINISTICOS.length + casosE2E.length;
  console.log(`\n${total - falhas}/${total} casos passaram.`);
  if (falhas > 0) {
    process.exitCode = 1;
  }
}

main().catch((erro) => {
  console.error("[gabarito] falha fatal:", erro);
  process.exitCode = 1;
});
