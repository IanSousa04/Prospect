import { useEffect, useMemo, useState } from "react";
import type { Produto, ProdutoDetalhado, TipoEntrega, FormaPagamento } from "@prospect/shared";
import { api, type CriarPedidoBody } from "../lib/api.js";
import "./PedidoBuilder.css";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const IconX = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

interface CartItem {
  produto_id: string;
  nome: string;
  preco_unitario: number;
  quantidade: number;
  opcoes: Array<{ opcao_id: string; nome: string; preco_adicional: number }>;
}

export default function PedidoBuilder(props: {
  clienteId: string;
  atendimentoId: string;
  onFechar: () => void;
  onCriado: () => void;
}) {
  const { clienteId, atendimentoId, onFechar, onCriado } = props;

  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [selecionado, setSelecionado] = useState<ProdutoDetalhado | null>(null);
  const [opcoesEscolhidas, setOpcoesEscolhidas] = useState<Set<string>>(new Set());
  const [qtd, setQtd] = useState(1);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [tipoEntrega, setTipoEntrega] = useState<TipoEntrega>("entrega");
  const [rua, setRua] = useState("");
  const [numero, setNumero] = useState("");
  const [bairro, setBairro] = useState("");
  const [taxaEntrega, setTaxaEntrega] = useState(0);
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento | "">("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.listarProdutos().then((lista) => setProdutos(lista.filter((p) => p.status === "ativo")));
  }, []);

  async function abrirProduto(id: string) {
    const detalhado = await api.buscarProduto(id);
    setSelecionado(detalhado);
    setOpcoesEscolhidas(new Set());
    setQtd(1);
  }

  function toggleOpcao(opcaoId: string) {
    setOpcoesEscolhidas((set) => {
      const novo = new Set(set);
      novo.has(opcaoId) ? novo.delete(opcaoId) : novo.add(opcaoId);
      return novo;
    });
  }

  function adicionarAoCarrinho() {
    if (!selecionado) return;
    const opcoes = selecionado.grupos_opcoes
      .flatMap((g) => g.opcoes)
      .filter((o) => opcoesEscolhidas.has(o.id))
      .map((o) => ({ opcao_id: o.id, nome: o.nome, preco_adicional: o.preco_adicional }));

    setCart((c) => [
      ...c,
      {
        produto_id: selecionado.id,
        nome: selecionado.nome,
        preco_unitario: selecionado.preco_promocional ?? selecionado.preco,
        quantidade: qtd,
        opcoes,
      },
    ]);
    setSelecionado(null);
  }

  function adicionarSugestao(produto: { id: string; nome: string; preco: number; preco_promocional: number | null }) {
    setCart((c) => [
      ...c,
      {
        produto_id: produto.id,
        nome: produto.nome,
        preco_unitario: produto.preco_promocional ?? produto.preco,
        quantidade: 1,
        opcoes: [],
      },
    ]);
  }

  function removerDoCarrinho(idx: number) {
    setCart((c) => c.filter((_, i) => i !== idx));
  }

  const subtotal = useMemo(
    () =>
      cart.reduce(
        (acc, item) =>
          acc + (item.preco_unitario + item.opcoes.reduce((a, o) => a + o.preco_adicional, 0)) * item.quantidade,
        0,
      ),
    [cart],
  );
  const total = subtotal + (tipoEntrega === "entrega" ? taxaEntrega : 0);

  async function salvar() {
    if (cart.length === 0) {
      setErro("Adicione pelo menos um item ao pedido.");
      return;
    }
    if (tipoEntrega === "entrega" && (!rua.trim() || !bairro.trim())) {
      setErro("Preencha o endereço de entrega.");
      return;
    }

    setErro(null);
    setSalvando(true);
    try {
      const body: CriarPedidoBody = {
        cliente_id: clienteId,
        atendimento_id: atendimentoId,
        tipo_entrega: tipoEntrega,
        endereco_json:
          tipoEntrega === "entrega" ? { rua, numero, bairro, cidade: "" } : null,
        taxa_entrega: tipoEntrega === "entrega" ? taxaEntrega : 0,
        forma_pagamento: formaPagamento || null,
        observacoes: null,
        itens: cart.map((item) => ({
          produto_id: item.produto_id,
          quantidade: item.quantidade,
          observacoes: null,
          opcoes: item.opcoes.map((o) => ({ opcao_id: o.opcao_id })),
        })),
      };
      await api.criarPedido(body);
      onCriado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao criar pedido");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="pb-overlay" onClick={onFechar}>
      <div className="pb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pb-head">
          <div className="pb-head-title">Novo pedido</div>
          <button className="pb-close" onClick={onFechar}>
            {IconX}
          </button>
        </div>

        <div className="pb-body">
          <div className="pb-col">
            {!selecionado ? (
              <>
                <div className="pb-col-title">Produtos</div>
                {produtos.map((p) => (
                  <button key={p.id} className="pb-produto-row" onClick={() => abrirProduto(p.id)}>
                    <span className="pb-produto-nome">{p.nome}</span>
                    <span className="pb-produto-preco">{currency.format(p.preco_promocional ?? p.preco)}</span>
                  </button>
                ))}
                {produtos.length === 0 && <div className="pb-empty">Nenhum produto ativo no catálogo.</div>}
              </>
            ) : (
              <div className="pb-picker">
                <div className="pb-picker-nome">{selecionado.nome}</div>

                {selecionado.grupos_opcoes.map((grupo) => (
                  <div className="pb-grupo" key={grupo.id}>
                    <div className="pb-grupo-nome">
                      {grupo.nome}
                      <span className="pb-grupo-regra">
                        {grupo.obrigatorio ? "obrigatório" : "opcional"} · min {grupo.minimo} · máx {grupo.maximo}
                      </span>
                    </div>
                    {grupo.opcoes.map((opcao) => (
                      <label className="pb-opcao-check" key={opcao.id}>
                        <input
                          type="checkbox"
                          checked={opcoesEscolhidas.has(opcao.id)}
                          onChange={() => toggleOpcao(opcao.id)}
                        />
                        {opcao.nome}
                        <span className="preco">
                          {opcao.preco_adicional > 0 ? `+${currency.format(opcao.preco_adicional)}` : "grátis"}
                        </span>
                      </label>
                    ))}
                  </div>
                ))}

                <div className="pb-qtd-row">
                  <button className="pb-qtd-btn" onClick={() => setQtd((q) => Math.max(1, q - 1))}>
                    −
                  </button>
                  <span className="pb-qtd-valor">{qtd}</span>
                  <button className="pb-qtd-btn" onClick={() => setQtd((q) => q + 1)}>
                    +
                  </button>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button className="pb-add-btn" onClick={adicionarAoCarrinho}>
                    Adicionar ao pedido
                  </button>
                  <button className="pb-btn-ghost" onClick={() => setSelecionado(null)}>
                    Cancelar
                  </button>
                </div>

                {selecionado.relacionados.length > 0 && (
                  <div className="pb-grupo">
                    <div className="pb-grupo-nome">Costuma combinar com</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {selecionado.relacionados.map((r) => (
                        <button
                          key={r.id}
                          className="pb-sugestao-chip"
                          onClick={() => adicionarSugestao(r.produto)}
                        >
                          + {r.produto.nome}
                          <span className="preco">
                            {currency.format(r.produto.preco_promocional ?? r.produto.preco)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pb-col">
            <div className="pb-col-title">Pedido</div>
            {cart.map((item, idx) => (
              <div className="pb-cart-item" key={idx}>
                <div className="pb-cart-item-top">
                  <span className="pb-cart-item-nome">
                    {item.quantidade}× {item.nome}
                  </span>
                  <span className="pb-cart-item-preco">
                    {currency.format(
                      (item.preco_unitario + item.opcoes.reduce((a, o) => a + o.preco_adicional, 0)) *
                        item.quantidade,
                    )}
                  </span>
                </div>
                {item.opcoes.length > 0 && (
                  <div className="pb-cart-item-opcoes">{item.opcoes.map((o) => o.nome).join(", ")}</div>
                )}
                <button className="pb-cart-remove" onClick={() => removerDoCarrinho(idx)}>
                  Remover
                </button>
              </div>
            ))}
            {cart.length === 0 && <div className="pb-empty">Nenhum item adicionado ainda.</div>}

            <div className="pb-field">
              <label>Entrega</label>
              <select value={tipoEntrega} onChange={(e) => setTipoEntrega(e.target.value as TipoEntrega)}>
                <option value="entrega">Entrega</option>
                <option value="retirada">Retirada no local</option>
              </select>
            </div>

            {tipoEntrega === "entrega" && (
              <>
                <div className="pb-field-row">
                  <div className="pb-field">
                    <label>Rua</label>
                    <input value={rua} onChange={(e) => setRua(e.target.value)} />
                  </div>
                  <div className="pb-field">
                    <label>Número</label>
                    <input value={numero} onChange={(e) => setNumero(e.target.value)} />
                  </div>
                </div>
                <div className="pb-field-row">
                  <div className="pb-field">
                    <label>Bairro</label>
                    <input value={bairro} onChange={(e) => setBairro(e.target.value)} />
                  </div>
                  <div className="pb-field">
                    <label>Taxa de entrega</label>
                    <input
                      type="number"
                      step="0.01"
                      value={taxaEntrega}
                      onChange={(e) => setTaxaEntrega(Number(e.target.value))}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="pb-field">
              <label>Forma de pagamento</label>
              <select value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value as FormaPagamento)}>
                <option value="">A combinar</option>
                <option value="pix">Pix</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="cartao_credito">Cartão de crédito</option>
                <option value="cartao_debito">Cartão de débito</option>
                <option value="outro">Outro</option>
              </select>
            </div>

            <div className="pb-total-row">
              <span>Subtotal</span>
              <span className="v">{currency.format(subtotal)}</span>
            </div>
            {tipoEntrega === "entrega" && (
              <div className="pb-total-row">
                <span>Taxa de entrega</span>
                <span className="v">{currency.format(taxaEntrega)}</span>
              </div>
            )}
            <div className="pb-total-row grand">
              <span>Total</span>
              <span className="v">{currency.format(total)}</span>
            </div>

            {erro && <div style={{ color: "var(--red)", fontSize: 12 }}>{erro}</div>}
          </div>
        </div>

        <div className="pb-foot">
          <button className="pb-btn-ghost" onClick={onFechar}>
            Cancelar
          </button>
          <button className="pb-btn-primary" onClick={salvar} disabled={salvando}>
            {salvando ? "Criando…" : "Criar pedido"}
          </button>
        </div>
      </div>
    </div>
  );
}
