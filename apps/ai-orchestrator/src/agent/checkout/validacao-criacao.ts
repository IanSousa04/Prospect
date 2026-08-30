// Reexport — a regra em si vive em `packages/shared` desde a tarefa 0043,
// porque a página pública de pedido cria pedidos pelo mesmo carrinho e o
// gate de autorização não pode ter uma versão por canal. Este arquivo
// permanece como o caminho de import conhecido do orquestrador e dos
// gabaritos determinísticos.
export {
  validarPreRequisitosDeCriacao,
  type MotivoRecusaCriacao,
  type ResultadoValidacaoCriacao,
} from "@prospect/shared";
