// Runner só dos casos determinísticos — grátis, instantâneo, sem chamar LLM
// nem tocar em nenhuma tabela. Existe pra dar um ciclo de feedback curto
// durante o desenvolvimento: o gabarito completo (`npm run eval`) continua
// sendo o que valida prompt e integração de verdade, mas custa tokens e
// depende de rede.
//
// Uso: npm run -w apps/ai-orchestrator eval:rapido
import "dotenv/config";
import { CASOS_DETERMINISTICOS } from "./deterministicos.js";

async function main(): Promise<void> {
  const casos = [...CASOS_DETERMINISTICOS];
  let falhas = 0;

  for (const caso of casos) {
    try {
      const motivo = await caso.rodar();
      if (motivo) {
        falhas++;
        console.log(`✗ ${caso.nome}\n    ${motivo}`);
      } else {
        console.log(`✓ ${caso.nome}`);
      }
    } catch (erro) {
      falhas++;
      console.log(`✗ ${caso.nome}\n    erro ao rodar: ${erro instanceof Error ? erro.message : erro}`);
    }
  }

  console.log(`\n${casos.length - falhas}/${casos.length} casos determinísticos passaram.`);
  if (falhas > 0) process.exitCode = 1;
}

main().catch((erro) => {
  console.error("[eval:rapido] falha fatal:", erro);
  process.exitCode = 1;
});
