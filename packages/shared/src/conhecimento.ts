// Base de conhecimento da empresa (`conhecimento_itens`) — o texto livre que
// a IA pode citar quando o cliente pergunta algo que não é produto.
//
// O ponto delicado desta tabela é a CATEGORIA. Ela não é um rótulo
// organizacional: é o que decide qual ferramenta da IA enxerga o item. Cada
// tool de operação (`tools/operacao.ts`) lê uma categoria fixa, e um item
// cadastrado na categoria errada fica invisível para a pergunta que deveria
// responder.
//
// Isso não é hipotético: numa empresa real, o item "Área de entrega" estava
// na categoria `entrega`, enquanto `consultar_regiao` só lê `regiao`. A
// consulta voltava vazia e a IA respondia como se a informação não
// existisse. O mapa abaixo é a fonte única desse vínculo — as tools o
// consomem, e a UI usa o inverso dele pra explicar ao dono, na hora do
// cadastro, qual pergunta cada categoria responde.
import { z } from "zod";
import type { CategoriaConhecimento } from "./types.js";

export const CATEGORIAS_CONHECIMENTO = [
  "faq",
  "politica",
  "procedimento",
  "entrega",
  "pagamento",
  "cancelamento",
  "promocao",
  "horario",
  "regiao",
  "outro",
] as const;

export const STATUS_CONHECIMENTO = ["ativo", "rascunho", "arquivado"] as const;
export type StatusConhecimento = (typeof STATUS_CONHECIMENTO)[number];

/** Ferramentas de operação que leem uma categoria fixa. Fonte única do
 * vínculo — `tools/operacao.ts` importa daqui em vez de repetir a string,
 * pra tool e UI nunca divergirem sobre qual categoria alimenta o quê. */
export const CATEGORIA_DA_FERRAMENTA = {
  consultar_horario: "horario",
  consultar_taxa: "entrega",
  consultar_regiao: "regiao",
  consultar_politica: "politica",
} as const satisfies Record<string, CategoriaConhecimento>;

export interface MetaCategoriaConhecimento {
  rotulo: string;
  /** Em que situação a IA vai buscar um item desta categoria — escrito na
   * linguagem do dono do negócio, não na do sistema. */
  quandoAIaUsa: string;
  /** `true` quando existe uma ferramenta dedicada lendo esta categoria. As
   * demais só aparecem na busca geral de conhecimento, que é menos precisa. */
  temFerramentaDedicada: boolean;
}

export const META_CATEGORIA_CONHECIMENTO: Record<CategoriaConhecimento, MetaCategoriaConhecimento> = {
  horario: {
    rotulo: "Horário de funcionamento",
    quandoAIaUsa: "Quando o cliente pergunta que horas a loja abre, fecha ou em que dias funciona.",
    temFerramentaDedicada: true,
  },
  entrega: {
    rotulo: "Entrega (taxa e condições)",
    quandoAIaUsa:
      "Quando o cliente pergunta quanto custa a entrega, o valor mínimo do pedido ou as condições de entrega. Também é consultada nas perguntas sobre área de entrega.",
    temFerramentaDedicada: true,
  },
  regiao: {
    rotulo: "Região atendida",
    quandoAIaUsa:
      "Quando o cliente pergunta se a loja entrega no bairro ou endereço dele. Cadastre aqui os bairros, o raio de entrega e o que fica fora da área.",
    temFerramentaDedicada: true,
  },
  politica: {
    rotulo: "Políticas",
    quandoAIaUsa: "Quando o cliente pergunta sobre troca, garantia, reembolso ou qualquer regra da loja.",
    temFerramentaDedicada: true,
  },
  pagamento: {
    rotulo: "Pagamento (detalhes)",
    quandoAIaUsa:
      "Só como informação complementar. Quais formas de pagamento a loja aceita vem da configuração da IA, não daqui — um texto que contradiga a configuração não será usado.",
    temFerramentaDedicada: false,
  },
  cancelamento: {
    rotulo: "Cancelamento",
    quandoAIaUsa: "Quando o cliente pergunta como cancelar um pedido. Aparece na busca geral de conhecimento.",
    temFerramentaDedicada: false,
  },
  promocao: {
    rotulo: "Promoções",
    quandoAIaUsa: "Quando o cliente pergunta sobre promoções ou descontos. Aparece na busca geral de conhecimento.",
    temFerramentaDedicada: false,
  },
  procedimento: {
    rotulo: "Procedimentos",
    quandoAIaUsa: "Instruções internas e passo a passo de atendimento. Aparece na busca geral de conhecimento.",
    temFerramentaDedicada: false,
  },
  faq: {
    rotulo: "Perguntas frequentes",
    quandoAIaUsa: "Dúvidas comuns que não se encaixam nas outras categorias. Aparece na busca geral de conhecimento.",
    temFerramentaDedicada: false,
  },
  outro: {
    rotulo: "Outro",
    quandoAIaUsa: "Qualquer informação que não se encaixe nas demais. Aparece na busca geral de conhecimento.",
    temFerramentaDedicada: false,
  },
};

/** Corpo aceito por `POST /conhecimento` e `PATCH /conhecimento/:id`. Limite
 * de tamanho no conteúdo porque o texto vai inteiro pro contexto do modelo —
 * um item gigante empurraria os outros fatos pra fora da janela. */
export const ConhecimentoItemInputSchema = z
  .object({
    categoria: z.enum(CATEGORIAS_CONHECIMENTO),
    titulo: z.string().trim().min(1).max(120),
    conteudo: z.string().trim().min(1).max(4000),
    status: z.enum(STATUS_CONHECIMENTO).default("ativo"),
  })
  .strict();

export type ConhecimentoItemInput = z.infer<typeof ConhecimentoItemInputSchema>;

export const AtualizarConhecimentoItemSchema = ConhecimentoItemInputSchema.partial().strict();

export type AtualizarConhecimentoItemInput = z.infer<typeof AtualizarConhecimentoItemSchema>;
