import { useEffect, useMemo, useState } from "react";
import type { GrupoOpcoesComOpcoes, ProdutoPublicoDetalhado } from "@prospect/shared";
import { apiPublica, mensagemDeErro } from "./apiPublico.js";
import { moeda } from "./formato.js";

/** Grupo de escolha única quando o máximo é 1 — vira rádio em vez de
 * checkbox. É o mesmo limite que `montarItensComSnapshot` aplica no servidor;
 * a UI só impede o cliente de montar algo que seria recusado depois. */
function escolhaUnica(grupo: GrupoOpcoesComOpcoes): boolean {
  return grupo.maximo === 1;
}

export default function ModalProduto(props: {
  slug: string;
  produtoId: string;
  aoFechar: () => void;
  aoAdicionar: (body: {
    produto_id: string;
    quantidade: number;
    observacoes: string | null;
    opcoes: Array<{ opcao_id: string }>;
  }) => Promise<void>;
}) {
  const { slug, produtoId, aoFechar, aoAdicionar } = props;

  const [produto, setProduto] = useState<ProdutoPublicoDetalhado | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set());
  const [quantidade, setQuantidade] = useState(1);
  const [observacoes, setObservacoes] = useState("");

  useEffect(() => {
    let ativo = true;
    apiPublica
      .produto(slug, produtoId)
      .then((p) => {
        if (!ativo) return;
        setProduto(p);
        setQuantidade(Math.max(1, p.quantidade_minima));
      })
      .catch((e) => ativo && setErro(mensagemDeErro(e)))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [slug, produtoId]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  function alternar(grupo: GrupoOpcoesComOpcoes, opcaoId: string) {
    setEscolhidas((atual) => {
      const novo = new Set(atual);
      if (novo.has(opcaoId)) {
        novo.delete(opcaoId);
        return novo;
      }

      const idsDoGrupo = grupo.opcoes.map((o) => o.id);
      const jaEscolhidasNoGrupo = idsDoGrupo.filter((id) => novo.has(id));

      if (escolhaUnica(grupo)) {
        for (const id of jaEscolhidasNoGrupo) novo.delete(id);
      } else if (jaEscolhidasNoGrupo.length >= grupo.maximo) {
        // Estourou o máximo do grupo — a escolha é simplesmente ignorada,
        // com o contador do grupo já indicando "3 de 3" na tela.
        return atual;
      }

      novo.add(opcaoId);
      return novo;
    });
  }

  /** Grupos que ainda impedem adicionar o item. Mesma regra do servidor
   * (obrigatório e mínimo), calculada aqui só pra desabilitar o botão e dizer
   * o que falta — nunca como substituto da validação real. */
  const pendencias = useMemo(() => {
    if (!produto) return [];
    return produto.grupos_opcoes
      .filter((g) => {
        const escolhidasNoGrupo = g.opcoes.filter((o) => escolhidas.has(o.id)).length;
        if (g.obrigatorio && escolhidasNoGrupo === 0) return true;
        return escolhidasNoGrupo < g.minimo;
      })
      .map((g) => g.nome);
  }, [produto, escolhidas]);

  const precoTotal = useMemo(() => {
    if (!produto) return 0;
    const base = produto.preco_promocional ?? produto.preco;
    const adicionais = produto.grupos_opcoes
      .flatMap((g) => g.opcoes)
      .filter((o) => escolhidas.has(o.id))
      .reduce((soma, o) => soma + Number(o.preco_adicional), 0);
    return (base + adicionais) * quantidade;
  }, [produto, escolhidas, quantidade]);

  async function adicionar() {
    if (!produto || pendencias.length > 0 || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      await aoAdicionar({
        produto_id: produto.id,
        quantidade,
        observacoes: observacoes.trim() || null,
        opcoes: [...escolhidas].map((opcao_id) => ({ opcao_id })),
      });
    } catch (e) {
      setErro(mensagemDeErro(e));
      setSalvando(false);
    }
  }

  const maximo = produto?.quantidade_maxima ?? 99;
  const minimo = Math.max(1, produto?.quantidade_minima ?? 1);

  return (
    <div className="pp-overlay" onClick={aoFechar} role="presentation">
      <div
        className="pp-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={produto?.nome ?? "Produto"}
      >
        <button className="pp-modal-fechar" onClick={aoFechar} aria-label="Fechar">
          ✕
        </button>

        {carregando && <div className="pp-modal-carregando">Carregando…</div>}

        {!carregando && !produto && (
          <div className="pp-modal-carregando">{erro ?? "Não foi possível abrir este item."}</div>
        )}

        {produto && (
          <>
            <div className="pp-modal-conteudo">
              {produto.imagem_url && (
                <img className="pp-modal-imagem" src={produto.imagem_url} alt="" loading="lazy" />
              )}

              <h2 className="pp-modal-titulo">{produto.nome}</h2>
              {(produto.descricao_comercial || produto.descricao) && (
                <p className="pp-modal-descricao">{produto.descricao_comercial || produto.descricao}</p>
              )}

              {produto.ingredientes.length > 0 && (
                <p className="pp-modal-ingredientes">
                  {produto.ingredientes.map((i) => (i.alergeno ? `${i.nome} (alérgeno)` : i.nome)).join(", ")}
                </p>
              )}

              {produto.restricoes && <p className="pp-modal-restricoes">{produto.restricoes}</p>}

              {produto.grupos_opcoes.map((grupo) => {
                const escolhidasNoGrupo = grupo.opcoes.filter((o) => escolhidas.has(o.id)).length;
                return (
                  <fieldset className="pp-grupo" key={grupo.id}>
                    <legend className="pp-grupo-cabecalho">
                      <span className="pp-grupo-nome">{grupo.nome}</span>
                      <span className={grupo.obrigatorio ? "pp-tag-obrigatorio" : "pp-tag-opcional"}>
                        {grupo.obrigatorio ? "Obrigatório" : "Opcional"}
                      </span>
                      <span className="pp-grupo-contador">
                        {escolhaUnica(grupo) ? "Escolha 1" : `${escolhidasNoGrupo} de ${grupo.maximo}`}
                      </span>
                    </legend>

                    {grupo.opcoes
                      .filter((o) => o.disponivel)
                      .map((opcao) => (
                        <label className="pp-opcao" key={opcao.id}>
                          <input
                            type={escolhaUnica(grupo) ? "radio" : "checkbox"}
                            name={grupo.id}
                            checked={escolhidas.has(opcao.id)}
                            onChange={() => alternar(grupo, opcao.id)}
                          />
                          <span className="pp-opcao-nome">{opcao.nome}</span>
                          {Number(opcao.preco_adicional) > 0 && (
                            <span className="pp-opcao-preco">+ {moeda(Number(opcao.preco_adicional))}</span>
                          )}
                        </label>
                      ))}
                  </fieldset>
                );
              })}

              <label className="pp-label" htmlFor="pp-obs">
                Alguma observação?
              </label>
              <textarea
                id="pp-obs"
                className="pp-input pp-textarea"
                rows={2}
                maxLength={200}
                placeholder="Ex.: sem cebola"
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
              />
            </div>

            <div className="pp-modal-rodape">
              <div className="pp-stepper">
                <button
                  type="button"
                  onClick={() => setQuantidade((q) => Math.max(minimo, q - 1))}
                  disabled={quantidade <= minimo}
                  aria-label="Diminuir quantidade"
                >
                  −
                </button>
                <span aria-live="polite">{quantidade}</span>
                <button
                  type="button"
                  onClick={() => setQuantidade((q) => Math.min(maximo, q + 1))}
                  disabled={quantidade >= maximo}
                  aria-label="Aumentar quantidade"
                >
                  +
                </button>
              </div>

              <button
                className="pp-btn-primario pp-btn-adicionar"
                onClick={adicionar}
                disabled={pendencias.length > 0 || salvando}
              >
                {salvando ? "Adicionando…" : `Adicionar • ${moeda(precoTotal)}`}
              </button>
            </div>

            {(pendencias.length > 0 || erro) && (
              <p className={erro ? "pp-erro pp-modal-aviso" : "pp-ajuda pp-modal-aviso"} role="alert">
                {erro ?? `Escolha as opções de: ${pendencias.join(", ")}.`}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
