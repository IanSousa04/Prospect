import "dotenv/config";
import { NOMES_FERRAMENTAS, type IaPermissao, type NomeFerramenta } from "@prospect/shared";
import { env } from "./lib/env.js";
import { getToolsForEmpresa } from "./tools/index.js";
import { iniciarPoller } from "./poller.js";

function permissaoFalsa(nome: NomeFerramenta): IaPermissao {
  return {
    id: "self-check",
    empresa_id: "self-check",
    ferramenta: nome,
    permitido: true,
    exige_confirmacao_humana: null,
    valor_maximo_sem_handoff: null,
    condicoes_json: null,
    campos_permitidos: null,
    criado_em: "",
    atualizado_em: "",
  };
}

// Auto-verificação de segurança no boot — se algum dia um `?? true` for
// introduzido por engano em isPermitido()/registry, o processo se recusa a
// subir em vez de silenciosamente violar CLAUDE.md regra 2.
const todasPermitidas = new Map(NOMES_FERRAMENTAS.map((nome) => [nome, permissaoFalsa(nome)]));
const nenhumaPermitida = getToolsForEmpresa(new Map());

if (nenhumaPermitida.length !== 0) {
  throw new Error(
    "REGRESSÃO DE SEGURANÇA: getToolsForEmpresa(Map vazio) retornou tool(s) sem permissão explícita — CLAUDE.md regra 2 violada.",
  );
}

console.log(`[ai-orchestrator] iniciando — empresa ${env.empresaId}`);
console.log(
  `[ai-orchestrator] ${getToolsForEmpresa(todasPermitidas).length} ferramentas de leitura disponíveis: ` +
    getToolsForEmpresa(todasPermitidas)
      .map((t) => t.nome)
      .join(", "),
);
console.log(
  "[ai-orchestrator] lembrete: a entrega real ao WhatsApp depende de IA_ENVIO_REAL no whatsapp-worker — " +
    "enquanto false, respostas ficam em modo sombra (geradas e auditadas, nunca enviadas de verdade).",
);

iniciarPoller();

console.log(`[ai-orchestrator] polling ativo a cada ${env.pollingIntervaloMs}ms`);
