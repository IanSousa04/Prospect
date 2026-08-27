// Tipos espelham 1:1 o schema de supabase/migrations/0007_fase2_catalogo.sql.
// Qualquer mudança de schema deve atualizar este arquivo na mesma alteração.

export type StatusCategoria = "ativo" | "arquivado";

export interface Categoria {
  id: string;
  empresa_id: string;
  nome: string;
  ordem: number;
  status: StatusCategoria;
  criado_em: string;
  atualizado_em: string;
}

export type TipoProduto = "produto" | "combo";
export type StatusProduto = "ativo" | "rascunho" | "arquivado";

export interface Produto {
  id: string;
  empresa_id: string;
  categoria_id: string | null;
  tipo: TipoProduto;

  nome: string;
  nome_curto: string | null;
  descricao: string | null;
  descricao_comercial: string | null;
  imagem_url: string | null;
  tags: string[];
  status: StatusProduto;

  preco: number;
  preco_promocional: number | null;
  disponivel: boolean;
  horario_inicio: string | null;
  horario_fim: string | null;
  quantidade_minima: number;
  quantidade_maxima: number | null;

  restricoes: string | null;

  criado_em: string;
  atualizado_em: string;
}

export interface Ingrediente {
  id: string;
  empresa_id: string;
  produto_id: string;
  nome: string;
  alergeno: boolean;
  ordem: number;
}

export type TipoGrupoOpcoes = "adicionar" | "remover" | "substituir" | "escolher";

export interface GrupoOpcoes {
  id: string;
  empresa_id: string;
  produto_id: string;
  nome: string;
  tipo: TipoGrupoOpcoes;
  obrigatorio: boolean;
  minimo: number;
  maximo: number;
  ordem: number;
}

export interface Opcao {
  id: string;
  empresa_id: string;
  grupo_opcoes_id: string;
  nome: string;
  preco_adicional: number;
  produto_referenciado_id: string | null;
  disponivel: boolean;
  ordem: number;
}

export type TipoRelacao = "combina_com" | "frequentemente_comprado_com" | "alternativa" | "similar";

export interface ProdutoRelacionado {
  id: string;
  empresa_id: string;
  produto_id: string;
  relacionado_id: string;
  tipo: TipoRelacao;
}

/** Grupo de opções com as opções já embutidas — forma que a API entrega pro
 * editor de produto montar tudo numa carga só. */
export interface GrupoOpcoesComOpcoes extends GrupoOpcoes {
  opcoes: Opcao[];
}

/** Produto completo com tudo que o editor e a camada semântica da IA
 * precisam — composição do payload de GET /produtos/:id. */
export interface ProdutoDetalhado extends Produto {
  categoria: Categoria | null;
  ingredientes: Ingrediente[];
  grupos_opcoes: GrupoOpcoesComOpcoes[];
  relacionados: (ProdutoRelacionado & {
    produto: Pick<Produto, "id" | "nome" | "imagem_url" | "preco" | "preco_promocional">;
  })[];
}
