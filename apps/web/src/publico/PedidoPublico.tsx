import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type {
  CatalogoPublico,
  ClientePublico,
  EnderecoEntrega,
  FormaPagamento,
  LojaPublica,
  PedidoPublicoResumo,
  ProdutoPublico,
  ResumoPedidoIa,
  TipoEntrega,
} from "@prospect/shared";
import { formatarPrazoEntrega } from "@prospect/shared";
import { apiPublica, apagarToken, lerToken, mensagemDeErro, salvarToken } from "./apiPublico.js";
import { aparenciaClasse, aparenciaVars } from "./aparencia.js";
import Identificacao from "./Identificacao.js";
import ModalProduto from "./ModalProduto.js";
import { ROTULO_ENTREGA, ROTULO_PAGAMENTO, ROTULO_STATUS_PEDIDO, moeda } from "./formato.js";
import "./PedidoPublico.css";

type Painel = "cardapio" | "carrinho" | "checkout" | "revisao";

const ENDERECO_VAZIO: EnderecoEntrega = { rua: "", numero: "", complemento: "", bairro: "", cidade: "", referencia: "" };

export default function PedidoPublico() {
  const { slug = "" } = useParams();

  const [loja, setLoja] = useState<LojaPublica | null>(null);
  const [catalogo, setCatalogo] = useState<CatalogoPublico | null>(null);
  const [carregandoLoja, setCarregandoLoja] = useState(true);
  const [erroLoja, setErroLoja] = useState<string | null>(null);

  const [token, setToken] = useState<string | null>(() => lerToken(slug));
  const [cliente, setCliente] = useState<ClientePublico | null>(null);
  const [carrinho, setCarrinho] = useState<ResumoPedidoIa | null>(null);
  const [pedido, setPedido] = useState<PedidoPublicoResumo | null>(null);
  const [restaurandoSessao, setRestaurandoSessao] = useState(!!lerToken(slug));

  const [painel, setPainel] = useState<Painel>("cardapio");
  const [produtoAberto, setProdutoAberto] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Rascunho local do checkout — só vira estado do pedido quando o cliente
  // avança, e é sempre relido do servidor depois (o carrinho no banco é a
  // fonte de verdade, nunca este formulário).
  const [endereco, setEndereco] = useState<EnderecoEntrega>(ENDERECO_VAZIO);
  const [nome, setNome] = useState("");
  const [revisao, setRevisao] = useState<{ hash: string; carrinho: ResumoPedidoIa } | null>(null);

  const timerAviso = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mostrarAviso = useCallback((texto: string) => {
    setAviso(texto);
    if (timerAviso.current) clearTimeout(timerAviso.current);
    timerAviso.current = setTimeout(() => setAviso(null), 4000);
  }, []);

  // Uma sessão morta não é erro do cliente — a página volta pro começo em vez
  // de mostrar mensagem técnica em cima do cardápio.
  const tratarErro = useCallback(
    (e: unknown) => {
      const codigo = (e as any)?.codigo;
      if (codigo === "sessao_expirada" || codigo === "sessao_invalida" || codigo === "sessao_ausente") {
        apagarToken(slug);
        setToken(null);
        setCliente(null);
        setCarrinho(null);
        setPainel("cardapio");
      }
      mostrarAviso(mensagemDeErro(e));
    },
    [slug, mostrarAviso],
  );

  useEffect(() => {
    let ativo = true;
    Promise.all([apiPublica.loja(slug), apiPublica.catalogo(slug)])
      .then(([l, c]) => {
        if (!ativo) return;
        setLoja(l);
        setCatalogo(c);
      })
      .catch((e) => ativo && setErroLoja(mensagemDeErro(e)))
      .finally(() => ativo && setCarregandoLoja(false));
    return () => {
      ativo = false;
    };
  }, [slug]);

  // Sessão guardada no navegador: o cliente volta e continua de onde parou,
  // com o carrinho que já estava montado no servidor.
  useEffect(() => {
    if (!token) {
      setRestaurandoSessao(false);
      return;
    }
    let ativo = true;
    apiPublica
      .sessao(token)
      .then((estado) => {
        if (!ativo) return;
        setCliente(estado.cliente);
        setCarrinho(estado.carrinho);
        setPedido(estado.pedido_ativo);
        setNome(estado.cliente.nome ?? "");
        if (estado.cliente.endereco_json) setEndereco(estado.cliente.endereco_json);
      })
      .catch((e) => {
        if (!ativo) return;
        apagarToken(slug);
        setToken(null);
        if ((e as any)?.codigo?.startsWith?.("sessao") !== true) mostrarAviso(mensagemDeErro(e));
      })
      .finally(() => ativo && setRestaurandoSessao(false));
    return () => {
      ativo = false;
    };
  }, [token, slug, mostrarAviso]);

  const totalItens = useMemo(
    () => (carrinho?.itens ?? []).reduce((soma, item) => soma + item.quantidade, 0),
    [carrinho],
  );

  const produtosPorCategoria = useMemo(() => {
    if (!catalogo) return [];
    const grupos = catalogo.categorias.map((categoria) => ({
      categoria,
      produtos: catalogo.produtos.filter((p) => p.categoria_id === categoria.id),
    }));
    const semCategoria = catalogo.produtos.filter((p) => !p.categoria_id);
    if (semCategoria.length > 0) {
      grupos.push({ categoria: { id: "sem-categoria", nome: "Outros", ordem: 999 }, produtos: semCategoria });
    }
    return grupos.filter((g) => g.produtos.length > 0);
  }, [catalogo]);

  /** Toda mutação de carrinho passa por aqui: o servidor devolve o carrinho
   * inteiro recalculado e ele SUBSTITUI o estado local. A tela nunca soma
   * item por conta própria — o preço que aparece é sempre o que o backend
   * calculou a partir do catálogo real. */
  async function mutarCarrinho(operacao: (t: string) => Promise<ResumoPedidoIa>) {
    if (!token || ocupado) return;
    setOcupado(true);
    try {
      setCarrinho(await operacao(token));
    } catch (e) {
      tratarErro(e);
      throw e;
    } finally {
      setOcupado(false);
    }
  }

  async function definirEntrega(tipo: TipoEntrega) {
    await mutarCarrinho((t) =>
      apiPublica.definirEntrega(t, {
        tipo_entrega: tipo,
        endereco: tipo === "entrega" ? (carrinho?.endereco ?? cliente?.endereco_json ?? null) : null,
      }),
    );
  }

  async function salvarEndereco() {
    await mutarCarrinho((t) => apiPublica.definirEntrega(t, { tipo_entrega: "entrega", endereco: endereco }));
    mostrarAviso("Endereço salvo.");
  }

  async function abrirRevisao() {
    if (!token) return;
    setOcupado(true);
    try {
      if (nome.trim() && nome.trim() !== cliente?.nome) {
        setCliente(await apiPublica.salvarNome(token, nome.trim()));
      }
      const resposta = await apiPublica.revisarPedido(token);
      setRevisao({ hash: resposta.hash, carrinho: resposta.carrinho });
      setCarrinho(resposta.carrinho);
      setPainel("revisao");
    } catch (e) {
      tratarErro(e);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarPedido() {
    if (!token || !revisao || ocupado) return;
    setOcupado(true);
    try {
      const resposta = await apiPublica.confirmarPedido(token, revisao.hash);
      setPedido(resposta.pedido);
      setRevisao(null);
      setCarrinho(null);
      setPainel("cardapio");
    } catch (e) {
      const codigo = (e as any)?.codigo;
      // O carrinho mudou entre ver o resumo e confirmar (outra aba, ou a IA
      // mexendo na conversa em paralelo). Refaz a revisão em vez de insistir
      // num pedido que já não é o que ele leu.
      if (codigo === "carrinho_mudou" || codigo === "confirmacao_expirada_ou_invalida") {
        mostrarAviso(mensagemDeErro(e));
        await abrirRevisao();
        return;
      }
      if (codigo === "pedido_ja_em_andamento") {
        const emAndamento = (e as any)?.corpo?.pedido as PedidoPublicoResumo | undefined;
        if (emAndamento) setPedido(emAndamento);
        setRevisao(null);
      }
      tratarErro(e);
    } finally {
      setOcupado(false);
    }
  }

  // Acompanhamento: enquanto há pedido em andamento, a página busca o status
  // real de tempos em tempos. É o mesmo status que o Kanban mostra — "Sendo
  // preparado" aqui é o card na coluna "Na cozinha" lá.
  useEffect(() => {
    if (!token || !pedido) return;
    const id = setInterval(async () => {
      try {
        setPedido(await apiPublica.pedidoAtual(token));
      } catch (e) {
        // 404 = o pedido saiu do fluxo ativo (entregue/cancelado). A tela
        // então volta pro cardápio, pronta pra um pedido novo.
        if ((e as any)?.codigo === "pedido_nao_encontrado") setPedido(null);
      }
    }, 20_000);
    return () => clearInterval(id);
  }, [token, pedido]);

  if (carregandoLoja) {
    return <div className="pp-tela-neutra">Carregando cardápio…</div>;
  }
  if (erroLoja || !loja || !catalogo) {
    return <div className="pp-tela-neutra">{erroLoja ?? "Loja indisponível."}</div>;
  }
  if (restaurandoSessao) {
    return <div className="pp-tela-neutra">Carregando seu pedido…</div>;
  }

  if (!token || !cliente) {
    return (
      <Identificacao
        loja={loja}
        aoAutenticar={(sessao) => {
          salvarToken(slug, sessao.token);
          setToken(sessao.token);
          setCliente(sessao.cliente);
          setNome(sessao.cliente.nome ?? "");
          if (sessao.cliente.endereco_json) setEndereco(sessao.cliente.endereco_json);
        }}
      />
    );
  }

  const pendencias = carrinho?.pendencias ?? [];
  const faltaSoConfirmar = pendencias.length === 1 && pendencias[0] === "confirmacao_final";
  const oferecerTipoEntrega = loja.fluxo_pedido.tipos_entrega_oferecidos.length > 1;

  return (
    <div className={`pp ${aparenciaClasse(loja.aparencia)}`} style={aparenciaVars(loja.aparencia)}>
      <header className="pp-topo">
        <div className="pp-topo-conteudo">
          <div className="pp-topo-marca">
            <span className="pp-ident-inicial">{loja.nome.slice(0, 1).toUpperCase()}</span>
            <div>
              <h1 className="pp-topo-loja">{loja.nome}</h1>
              <p className="pp-topo-prazo">
                Entrega em {formatarPrazoEntrega(loja.prazo_entrega_min_minutos, loja.prazo_entrega_max_minutos)}
              </p>
            </div>
          </div>
          <button
            className="pp-btn-texto"
            onClick={async () => {
              if (token) await apiPublica.encerrarSessao(token).catch(() => undefined);
              apagarToken(slug);
              setToken(null);
              setCliente(null);
              setCarrinho(null);
            }}
          >
            Sair
          </button>
        </div>
      </header>

      {pedido && (
        <section className="pp-acompanhamento" aria-live="polite">
          <div>
            <p className="pp-acomp-titulo">Pedido #{pedido.numero}</p>
            <p className="pp-acomp-status">{ROTULO_STATUS_PEDIDO[pedido.status]}</p>
          </div>
          <p className="pp-acomp-total">{moeda(pedido.total)}</p>
        </section>
      )}

      <main className="pp-corpo">
        <section className="pp-cardapio" aria-label="Cardápio">
          {produtosPorCategoria.length === 0 && (
            <p className="pp-vazio">Esta loja ainda não publicou itens no cardápio.</p>
          )}

          {produtosPorCategoria.map(({ categoria, produtos }) => (
            <div className="pp-categoria" key={categoria.id}>
              <h2 className="pp-categoria-nome">{categoria.nome}</h2>
              <ul className="pp-produtos">
                {produtos.map((produto) => (
                  <ItemCardapio
                    key={produto.id}
                    produto={produto}
                    aoAbrir={() => produto.disponivel && setProdutoAberto(produto.id)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </section>

        <aside className={`pp-lateral ${painel !== "cardapio" ? "pp-lateral-aberta" : ""}`}>
          <div className="pp-lateral-cabecalho">
            <h2>{painel === "checkout" ? "Fechar pedido" : painel === "revisao" ? "Confira seu pedido" : "Seu carrinho"}</h2>
            <button className="pp-btn-texto pp-so-mobile" onClick={() => setPainel("cardapio")}>
              Fechar
            </button>
          </div>

          <div className="pp-lateral-conteudo">
            {(!carrinho || carrinho.itens.length === 0) && (
              <p className="pp-vazio">Seu carrinho está vazio. Escolha um item do cardápio.</p>
            )}

            {carrinho && carrinho.itens.length > 0 && painel !== "revisao" && (
              <ul className="pp-linhas">
                {carrinho.itens.map((item) => (
                  <li className="pp-linha" key={item.linha_id}>
                    <div className="pp-linha-info">
                      <p className="pp-linha-nome">{item.nome_produto}</p>
                      {item.opcoes.length > 0 && (
                        <p className="pp-linha-opcoes">{item.opcoes.map((o) => o.nome_opcao).join(", ")}</p>
                      )}
                      {item.observacoes && <p className="pp-linha-obs">{item.observacoes}</p>}
                    </div>
                    <div className="pp-linha-acoes">
                      <div className="pp-stepper pp-stepper-pequeno">
                        <button
                          type="button"
                          aria-label={`Diminuir ${item.nome_produto}`}
                          disabled={ocupado}
                          onClick={() =>
                            item.quantidade <= 1
                              ? mutarCarrinho((t) => apiPublica.removerItem(t, item.linha_id)).catch(() => undefined)
                              : mutarCarrinho((t) =>
                                  apiPublica.atualizarItem(t, item.linha_id, { quantidade: item.quantidade - 1 }),
                                ).catch(() => undefined)
                          }
                        >
                          −
                        </button>
                        <span>{item.quantidade}</span>
                        <button
                          type="button"
                          aria-label={`Aumentar ${item.nome_produto}`}
                          disabled={ocupado}
                          onClick={() =>
                            mutarCarrinho((t) =>
                              apiPublica.atualizarItem(t, item.linha_id, { quantidade: item.quantidade + 1 }),
                            ).catch(() => undefined)
                          }
                        >
                          +
                        </button>
                      </div>
                      <p className="pp-linha-preco">
                        {moeda(
                          (item.preco_unitario + item.opcoes.reduce((s, o) => s + o.preco_adicional, 0)) *
                            item.quantidade,
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {painel === "checkout" && carrinho && carrinho.itens.length > 0 && (
              <div className="pp-checkout">
                <label className="pp-label" htmlFor="pp-nome">
                  Seu nome
                </label>
                <input
                  id="pp-nome"
                  className="pp-input"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Como podemos te chamar?"
                  maxLength={80}
                />

                {oferecerTipoEntrega && (
                  <>
                    <p className="pp-label">Como você quer receber?</p>
                    <div className="pp-escolhas">
                      {loja.fluxo_pedido.tipos_entrega_oferecidos.map((tipo) => (
                        <button
                          key={tipo}
                          type="button"
                          className={`pp-escolha ${carrinho.tipo_entrega === tipo ? "pp-escolha-ativa" : ""}`}
                          disabled={ocupado}
                          onClick={() => definirEntrega(tipo).catch(() => undefined)}
                        >
                          {ROTULO_ENTREGA[tipo]}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {carrinho.tipo_entrega === "entrega" && (
                  <div className="pp-endereco">
                    <p className="pp-label">Endereço de entrega</p>
                    <div className="pp-endereco-grade">
                      <input
                        className="pp-input pp-col-2"
                        placeholder="Rua"
                        value={endereco.rua}
                        onChange={(e) => setEndereco({ ...endereco, rua: e.target.value })}
                      />
                      <input
                        className="pp-input"
                        placeholder="Número"
                        value={endereco.numero}
                        onChange={(e) => setEndereco({ ...endereco, numero: e.target.value })}
                      />
                      <input
                        className="pp-input"
                        placeholder="Complemento"
                        value={endereco.complemento ?? ""}
                        onChange={(e) => setEndereco({ ...endereco, complemento: e.target.value })}
                      />
                      <input
                        className="pp-input"
                        placeholder="Bairro"
                        value={endereco.bairro}
                        onChange={(e) => setEndereco({ ...endereco, bairro: e.target.value })}
                      />
                      <input
                        className="pp-input"
                        placeholder="Cidade"
                        value={endereco.cidade}
                        onChange={(e) => setEndereco({ ...endereco, cidade: e.target.value })}
                      />
                      <input
                        className="pp-input pp-col-2"
                        placeholder="Ponto de referência (opcional)"
                        value={endereco.referencia ?? ""}
                        onChange={(e) => setEndereco({ ...endereco, referencia: e.target.value })}
                      />
                    </div>
                    <button
                      className="pp-btn-secundario"
                      type="button"
                      disabled={ocupado || !endereco.rua.trim() || !endereco.numero.trim() || !endereco.bairro.trim() || !endereco.cidade.trim()}
                      onClick={() => salvarEndereco().catch(() => undefined)}
                    >
                      Salvar endereço
                    </button>
                  </div>
                )}

                {loja.fluxo_pedido.perguntar_forma_pagamento && (
                  <>
                    <p className="pp-label">Forma de pagamento</p>
                    <div className="pp-escolhas">
                      {loja.fluxo_pedido.formas_pagamento_aceitas.map((forma) => (
                        <button
                          key={forma}
                          type="button"
                          className={`pp-escolha ${carrinho.forma_pagamento === forma ? "pp-escolha-ativa" : ""}`}
                          disabled={ocupado}
                          onClick={() =>
                            mutarCarrinho((t) => apiPublica.definirPagamento(t, forma as FormaPagamento)).catch(
                              () => undefined,
                            )
                          }
                        >
                          {ROTULO_PAGAMENTO[forma]}
                        </button>
                      ))}
                    </div>
                    <p className="pp-ajuda">O pagamento é feito na entrega ou na retirada.</p>
                  </>
                )}
              </div>
            )}

            {painel === "revisao" && revisao && (
              <div className="pp-revisao">
                <ul className="pp-revisao-itens">
                  {revisao.carrinho.itens.map((item) => (
                    <li key={item.linha_id}>
                      <span>
                        {item.quantidade}× {item.nome_produto}
                        {item.opcoes.length > 0 && (
                          <em className="pp-linha-opcoes"> {item.opcoes.map((o) => o.nome_opcao).join(", ")}</em>
                        )}
                      </span>
                      <span>
                        {moeda(
                          (item.preco_unitario + item.opcoes.reduce((s, o) => s + o.preco_adicional, 0)) *
                            item.quantidade,
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <dl className="pp-revisao-dados">
                  {revisao.carrinho.tipo_entrega && (
                    <>
                      <dt>Entrega</dt>
                      <dd>{ROTULO_ENTREGA[revisao.carrinho.tipo_entrega]}</dd>
                    </>
                  )}
                  {revisao.carrinho.endereco && (
                    <>
                      <dt>Endereço</dt>
                      <dd>
                        {revisao.carrinho.endereco.rua}, {revisao.carrinho.endereco.numero} —{" "}
                        {revisao.carrinho.endereco.bairro}
                      </dd>
                    </>
                  )}
                  {revisao.carrinho.forma_pagamento && (
                    <>
                      <dt>Pagamento</dt>
                      <dd>{ROTULO_PAGAMENTO[revisao.carrinho.forma_pagamento]}</dd>
                    </>
                  )}
                </dl>
                <p className="pp-ajuda">
                  Ao confirmar, seu pedido é enviado para a loja. Ela confirma e começa a preparar.
                </p>
              </div>
            )}
          </div>

          {carrinho && carrinho.itens.length > 0 && (
            <div className="pp-lateral-rodape">
              <div className="pp-total">
                <span>Total</span>
                <strong>{moeda(carrinho.subtotal)}</strong>
              </div>

              {painel === "revisao" ? (
                <>
                  <button className="pp-btn-primario" disabled={ocupado} onClick={confirmarPedido}>
                    {ocupado ? "Confirmando…" : "Confirmar pedido"}
                  </button>
                  <button className="pp-btn-texto" onClick={() => setPainel("checkout")} disabled={ocupado}>
                    Voltar e ajustar
                  </button>
                </>
              ) : painel === "checkout" ? (
                <button
                  className="pp-btn-primario"
                  disabled={ocupado || !faltaSoConfirmar || !!pedido}
                  onClick={() => abrirRevisao()}
                >
                  {pedido ? "Você já tem um pedido em andamento" : faltaSoConfirmar ? "Revisar pedido" : "Complete os dados acima"}
                </button>
              ) : (
                <button className="pp-btn-primario" onClick={() => setPainel("checkout")} disabled={ocupado}>
                  Continuar
                </button>
              )}
            </div>
          )}
        </aside>
      </main>

      {carrinho && carrinho.itens.length > 0 && painel === "cardapio" && (
        <button className="pp-barra-carrinho pp-so-mobile" onClick={() => setPainel("carrinho")}>
          <span>
            {totalItens} {totalItens === 1 ? "item" : "itens"}
          </span>
          <span>Ver carrinho</span>
          <strong>{moeda(carrinho.subtotal)}</strong>
        </button>
      )}

      {produtoAberto && (
        <ModalProduto
          slug={slug}
          produtoId={produtoAberto}
          aoFechar={() => setProdutoAberto(null)}
          aoAdicionar={async (body) => {
            await mutarCarrinho((t) => apiPublica.adicionarItem(t, body));
            setProdutoAberto(null);
            mostrarAviso("Item adicionado ao carrinho.");
          }}
        />
      )}

      {aviso && (
        <div className="pp-aviso" role="status">
          {aviso}
        </div>
      )}
    </div>
  );
}

function ItemCardapio(props: { produto: ProdutoPublico; aoAbrir: () => void }) {
  const { produto, aoAbrir } = props;
  const promocional = produto.preco_promocional != null && produto.preco_promocional < produto.preco;

  return (
    <li>
      <button
        className={`pp-produto ${produto.disponivel ? "" : "pp-produto-indisponivel"}`}
        onClick={aoAbrir}
        disabled={!produto.disponivel}
      >
        <div className="pp-produto-texto">
          <p className="pp-produto-nome">{produto.nome}</p>
          {(produto.descricao_comercial || produto.descricao) && (
            <p className="pp-produto-descricao">{produto.descricao_comercial || produto.descricao}</p>
          )}
          <p className="pp-produto-preco">
            {promocional && <s>{moeda(produto.preco)}</s>}
            <strong>{moeda(produto.preco_promocional ?? produto.preco)}</strong>
          </p>
          {!produto.disponivel && <span className="pp-tag-indisponivel">Indisponível agora</span>}
        </div>
        {produto.imagem_url && <img className="pp-produto-imagem" src={produto.imagem_url} alt="" loading="lazy" />}
      </button>
    </li>
  );
}
