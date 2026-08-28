// Matriz de risco genérica pra qualquer tool de escrita da IA (tarefa 0023)
// — generaliza o gate pontual que a tarefa 0055 criou só pra `criar_pedido`
// (ver pedido-criacao.ts, `avaliarRiscoCriarPedido`, que agora delega pra
// cá). Lê os campos de `ia_permissoes` que existem desde a migration 0010
// mas continuavam mortos: `condicoes_json.status_permitidos` e
// `campos_permitidos` — só `exige_confirmacao_humana`/
// `valor_maximo_sem_handoff` já eram consumidos, e só por `criar_pedido`.
// CLAUDE.md regra 6: ações irreversíveis exigem confiança alta + baixo
// risco + permissão explícita — ausência de configuração é permissiva
// (mesmo padrão de `comportamento_json`), só bloqueia o que a empresa
// configurou explicitamente.

export interface ConfiguracaoRiscoAcao {
  exige_confirmacao_humana: boolean | null;
  valor_maximo_sem_handoff: number | null;
  condicoes_json: { status_permitidos?: string[] } | null;
}

export type MotivoBloqueioAcao =
  | "empresa_exige_confirmacao_humana"
  | "valor_acima_do_limite_sem_handoff"
  | "status_pedido_nao_permitido";

export type ResultadoAvaliacaoRisco =
  | { bloqueado: false }
  | { bloqueado: true; motivo: MotivoBloqueioAcao };

/**
 * Gate de risco real pra qualquer tool de escrita. `valorFinanceiro` e
 * `statusAtual` são opcionais — uma tool sem conceito de valor (ex.:
 * `atualizar_cliente`) ou sem conceito de status prévio (ex.: `criar_pedido`,
 * que não tem pedido anterior) simplesmente não passa o parâmetro
 * correspondente, e aquela checagem não se aplica.
 */
export function avaliarRiscoAcao(params: {
  permissao: ConfiguracaoRiscoAcao | undefined;
  valorFinanceiro?: number | null;
  statusAtual?: string | null;
}): ResultadoAvaliacaoRisco {
  const { permissao, valorFinanceiro, statusAtual } = params;

  if (permissao?.exige_confirmacao_humana === true) {
    return { bloqueado: true, motivo: "empresa_exige_confirmacao_humana" };
  }

  if (
    valorFinanceiro != null &&
    permissao?.valor_maximo_sem_handoff != null &&
    valorFinanceiro > permissao.valor_maximo_sem_handoff
  ) {
    return { bloqueado: true, motivo: "valor_acima_do_limite_sem_handoff" };
  }

  const statusPermitidos = permissao?.condicoes_json?.status_permitidos;
  if (statusAtual != null && statusPermitidos != null && !statusPermitidos.includes(statusAtual)) {
    return { bloqueado: true, motivo: "status_pedido_nao_permitido" };
  }

  return { bloqueado: false };
}

export interface ResultadoFiltroCampos {
  permitido: boolean;
  camposNegados: string[];
}

/**
 * Enforcement de `campos_permitidos` — a outra coluna de `ia_permissoes`
 * que nunca teve nenhum consumidor. `null`/ausente continua permissivo
 * (mesmo padrão do resto do arquivo); se configurado, aponta quais campos
 * da tentativa de alteração não estão na lista, pra a tool decidir se
 * bloqueia a operação inteira ou só ignora os campos negados.
 */
export function filtrarCamposPermitidos(
  camposAlterados: string[],
  camposPermitidos: string[] | null | undefined,
): ResultadoFiltroCampos {
  if (camposPermitidos == null) return { permitido: true, camposNegados: [] };

  const camposNegados = camposAlterados.filter((campo) => !camposPermitidos.includes(campo));
  return { permitido: camposNegados.length === 0, camposNegados };
}
