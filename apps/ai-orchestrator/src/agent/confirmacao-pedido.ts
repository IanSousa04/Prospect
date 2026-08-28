// Mensagem de confirmação de pedido criado — texto FIXO, montado em código a
// partir só do retorno real de `criar_pedido` (tools/pedido.ts), NUNCA
// gerado pelo Atendente (LLM). Mesmo padrão de `agent/deteccao.ts`
// (mensagemDeTransferencia/mensagemSemTempoReal/mensagemDeIdentidade):
// quando uma alucinação de texto livre já teria consequência real (aqui,
// CLAUDE.md regra 6 — ação irreversível com impacto financeiro real), a
// mensagem não pode depender do LLM "se comportar bem" nem de uma checagem
// posterior "pegar a tempo" (ver `contemConfirmacaoDePedidoNaoVerificada`,
// agent/verificacao.ts, que continua existindo só como segunda camada de
// defesa pra qualquer caminho não coberto por esta função).
import type { EnderecoEntrega, FormaPagamento, TipoEntrega } from "@prospect/shared";

export interface ItemPedidoConfirmado {
  nome_produto: string;
  quantidade: number;
}

export interface ResumoPedidoConfirmado {
  itens: ItemPedidoConfirmado[];
  total: number;
  tipo_entrega: TipoEntrega | null;
  endereco: EnderecoEntrega | null;
  forma_pagamento: FormaPagamento | null;
}

const NOME_FORMA_PAGAMENTO: Record<FormaPagamento, string> = {
  dinheiro: "dinheiro",
  cartao_credito: "cartão de crédito",
  cartao_debito: "cartão de débito",
  pix: "Pix",
  outro: "combinado",
};

function formatarReal(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

function formatarEndereco(endereco: EnderecoEntrega): string {
  const complemento = endereco.complemento ? `, ${endereco.complemento}` : "";
  return `${endereco.rua}, ${endereco.numero}${complemento} - ${endereco.bairro}, ${endereco.cidade}`;
}

export function mensagemDePedidoConfirmado(resumo: ResumoPedidoConfirmado, usaEmoji: boolean): string {
  const linhasItens = resumo.itens.map((item) => `- ${item.quantidade}x *${item.nome_produto}*`).join("\n");

  const linhaEntrega =
    resumo.tipo_entrega === "entrega" && resumo.endereco
      ? `Entrega em: ${formatarEndereco(resumo.endereco)}`
      : resumo.tipo_entrega === "retirada"
        ? "Retirada no local"
        : null;

  const linhaPagamento = resumo.forma_pagamento ? `Pagamento: ${NOME_FORMA_PAGAMENTO[resumo.forma_pagamento]}` : null;

  const detalhes = [linhaEntrega, linhaPagamento].filter((l): l is string => l !== null).join("\n");

  const base = [
    "Pedido confirmado! Aqui está o resumo:",
    linhasItens,
    `Total: R$ ${formatarReal(resumo.total)}`,
    detalhes,
    "Já vai pra cozinha, qualquer coisa é só chamar!",
  ]
    .filter((bloco) => bloco.length > 0)
    .join("\n\n");

  return usaEmoji ? `${base} 🍔✅` : base;
}
