import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  Categoria,
  GrupoOpcoesComOpcoes,
  Ingrediente,
  Produto,
  StatusProduto,
  TipoGrupoOpcoes,
  TipoRelacao,
} from "@prospect/shared";
import { api, type ProdutoFormBase } from "../lib/api.js";
import "./ProdutoEditor.css";

const IconBack = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const IconTrash = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
);
const IconPlus = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const IconX = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const STATUS_LABEL: Record<StatusProduto, { label: string; color: string; bg: string }> = {
  rascunho: { label: "Rascunho", color: "var(--amber)", bg: "var(--amber-bg)" },
  ativo: { label: "Ativo", color: "var(--blue)", bg: "var(--blue-bg)" },
  arquivado: { label: "Arquivado", color: "var(--gray)", bg: "var(--gray-bg)" },
};

type IngredienteForm = Pick<Ingrediente, "nome" | "alergeno" | "ordem">;
type GrupoForm = Omit<GrupoOpcoesComOpcoes, "id" | "empresa_id" | "produto_id" | "opcoes"> & {
  opcoes: Array<Omit<GrupoOpcoesComOpcoes["opcoes"][number], "id" | "empresa_id" | "grupo_opcoes_id">>;
};
type RelacionadoForm = { relacionado_id: string; tipo: TipoRelacao };

const FORM_VAZIO: ProdutoFormBase = {
  categoria_id: null,
  tipo: "produto",
  nome: "",
  nome_curto: null,
  descricao: null,
  descricao_comercial: null,
  imagem_url: null,
  tags: [],
  preco: 0,
  preco_promocional: null,
  disponivel: true,
  horario_inicio: null,
  horario_fim: null,
  quantidade_minima: 1,
  quantidade_maxima: null,
  tempo_preparo_minutos: null,
  restricoes: null,
};

export default function ProdutoEditor() {
  const { id } = useParams<{ id: string }>();
  const isNovo = id === "novo";
  const navigate = useNavigate();

  const [status, setStatus] = useState<StatusProduto>("rascunho");
  const [form, setForm] = useState<ProdutoFormBase>(FORM_VAZIO);
  const [ingredientes, setIngredientes] = useState<IngredienteForm[]>([]);
  const [grupos, setGrupos] = useState<GrupoForm[]>([]);
  const [relacionados, setRelacionados] = useState<RelacionadoForm[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [outrosProdutos, setOutrosProdutos] = useState<Produto[]>([]);
  const [novaTag, setNovaTag] = useState("");
  const [carregando, setCarregando] = useState(!isNovo);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api.listarCategorias().then(setCategorias);
    api.listarProdutos().then(setOutrosProdutos);

    if (!isNovo && id) {
      api.buscarProduto(id).then((p) => {
        setStatus(p.status);
        setForm({
          categoria_id: p.categoria_id,
          tipo: p.tipo,
          nome: p.nome,
          nome_curto: p.nome_curto,
          descricao: p.descricao,
          descricao_comercial: p.descricao_comercial,
          imagem_url: p.imagem_url,
          tags: p.tags,
          preco: p.preco,
          preco_promocional: p.preco_promocional,
          disponivel: p.disponivel,
          horario_inicio: p.horario_inicio,
          horario_fim: p.horario_fim,
          quantidade_minima: p.quantidade_minima,
          quantidade_maxima: p.quantidade_maxima,
          tempo_preparo_minutos: p.tempo_preparo_minutos,
          restricoes: p.restricoes,
        });
        setIngredientes(p.ingredientes.map((i) => ({ nome: i.nome, alergeno: i.alergeno, ordem: i.ordem })));
        setGrupos(
          p.grupos_opcoes.map((g) => ({
            nome: g.nome,
            tipo: g.tipo,
            obrigatorio: g.obrigatorio,
            minimo: g.minimo,
            maximo: g.maximo,
            ordem: g.ordem,
            opcoes: g.opcoes.map((o) => ({
              nome: o.nome,
              preco_adicional: o.preco_adicional,
              produto_referenciado_id: o.produto_referenciado_id,
              disponivel: o.disponivel,
              ordem: o.ordem,
            })),
          })),
        );
        setRelacionados(p.relacionados.map((r) => ({ relacionado_id: r.relacionado_id, tipo: r.tipo })));
        setCarregando(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function set<K extends keyof ProdutoFormBase>(key: K, value: ProdutoFormBase[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function adicionarTag() {
    const t = novaTag.trim();
    if (t && !form.tags.includes(t)) set("tags", [...form.tags, t]);
    setNovaTag("");
  }

  function adicionarIngrediente() {
    setIngredientes((list) => [...list, { nome: "", alergeno: false, ordem: list.length }]);
  }
  function atualizarIngrediente(idx: number, patch: Partial<IngredienteForm>) {
    setIngredientes((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removerIngrediente(idx: number) {
    setIngredientes((list) => list.filter((_, i) => i !== idx));
  }

  function adicionarGrupo() {
    setGrupos((list) => [
      ...list,
      { nome: "", tipo: "adicionar", obrigatorio: false, minimo: 0, maximo: 1, ordem: list.length, opcoes: [] },
    ]);
  }
  function atualizarGrupo(idx: number, patch: Partial<GrupoForm>) {
    setGrupos((list) => list.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  }
  function removerGrupo(idx: number) {
    setGrupos((list) => list.filter((_, i) => i !== idx));
  }
  function adicionarOpcao(grupoIdx: number) {
    setGrupos((list) =>
      list.map((g, i) =>
        i === grupoIdx
          ? {
              ...g,
              opcoes: [
                ...g.opcoes,
                { nome: "", preco_adicional: 0, produto_referenciado_id: null, disponivel: true, ordem: g.opcoes.length },
              ],
            }
          : g,
      ),
    );
  }
  function atualizarOpcao(grupoIdx: number, opcaoIdx: number, patch: Partial<GrupoForm["opcoes"][number]>) {
    setGrupos((list) =>
      list.map((g, i) =>
        i === grupoIdx
          ? { ...g, opcoes: g.opcoes.map((o, j) => (j === opcaoIdx ? { ...o, ...patch } : o)) }
          : g,
      ),
    );
  }
  function removerOpcao(grupoIdx: number, opcaoIdx: number) {
    setGrupos((list) =>
      list.map((g, i) => (i === grupoIdx ? { ...g, opcoes: g.opcoes.filter((_, j) => j !== opcaoIdx) } : g)),
    );
  }

  function adicionarRelacionado() {
    const candidato = outrosProdutos.find((p) => p.id !== id);
    if (!candidato) return;
    setRelacionados((list) => [...list, { relacionado_id: candidato.id, tipo: "combina_com" }]);
  }
  function atualizarRelacionado(idx: number, patch: Partial<RelacionadoForm>) {
    setRelacionados((list) => list.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function removerRelacionado(idx: number) {
    setRelacionados((list) => list.filter((_, i) => i !== idx));
  }

  async function salvar() {
    if (!form.nome.trim()) {
      alert("Informe o nome do produto.");
      return;
    }
    setSalvando(true);
    try {
      let produtoId = id;
      if (isNovo) {
        const criado = await api.criarProduto(form);
        produtoId = criado.id;
      } else {
        await api.atualizarProduto(id!, form);
      }
      await api.salvarComposicao(
        produtoId!,
        ingredientes.map((it, i) => ({ ...it, ordem: i })),
        grupos.map((g, i) => ({
          ...g,
          ordem: i,
          opcoes: g.opcoes.map((o, j) => ({ ...o, ordem: j })),
        })),
      );
      await api.salvarRelacionados(produtoId!, relacionados);
      navigate(`/catalogo/produtos/${produtoId}`);
    } finally {
      setSalvando(false);
    }
  }

  async function publicar() {
    if (!id || isNovo) return;
    await api.atualizarProduto(id, { status: "ativo" } as any);
    setStatus("ativo");
  }

  async function arquivar() {
    if (!id || isNovo) return;
    if (!confirm("Arquivar este produto? Ele deixa de ficar disponível no cardápio.")) return;
    await api.arquivarProduto(id);
    navigate("/catalogo");
  }

  if (carregando) {
    return <div style={{ padding: 24, color: "var(--text-3)" }}>Carregando…</div>;
  }

  const statusMeta = STATUS_LABEL[status];

  return (
    <div className="editor-root">
      <div className="editor-head">
        <div className="editor-head-left">
          <button className="back-btn" onClick={() => navigate("/catalogo")}>
            {IconBack}
          </button>
          <div>
            <span className="editor-title">{isNovo ? "Novo produto" : form.nome || "Produto"}</span>
            <span className="editor-status-pill" style={{ color: statusMeta.color, background: statusMeta.bg }}>
              {statusMeta.label}
            </span>
          </div>
        </div>
        <div className="editor-head-right">
          {!isNovo && status !== "arquivado" && (
            <button className="btn-ghost" onClick={arquivar}>
              Arquivar
            </button>
          )}
          {!isNovo && status === "rascunho" && (
            <button className="btn-ghost" onClick={publicar}>
              Publicar
            </button>
          )}
          <button className="btn-primary" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>

      <div className="editor-scroll">
        <div className="section">
          <div className="section-title">Informações</div>
          <div className="section-sub">Como o produto aparece no cardápio e na busca da IA.</div>

          <div className="field-row">
            <div className="field">
              <label>Nome</label>
              <input value={form.nome} onChange={(e) => set("nome", e.target.value)} placeholder="X-Bacon" />
            </div>
            <div className="field">
              <label>Nome curto</label>
              <input
                value={form.nome_curto ?? ""}
                onChange={(e) => set("nome_curto", e.target.value || null)}
                placeholder="X-Bacon"
              />
            </div>
            <div className="field">
              <label>Categoria</label>
              <select
                value={form.categoria_id ?? ""}
                onChange={async (e) => {
                  if (e.target.value === "__nova__") {
                    const nome = prompt("Nome da nova categoria:");
                    if (nome?.trim()) {
                      const nova = await api.criarCategoria(nome.trim());
                      setCategorias((c) => [...c, nova]);
                      set("categoria_id", nova.id);
                    }
                    return;
                  }
                  set("categoria_id", e.target.value || null);
                }}
              >
                <option value="">Sem categoria</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
                <option value="__nova__">+ Nova categoria…</option>
              </select>
            </div>
            <div className="field">
              <label>Tipo</label>
              <select value={form.tipo} onChange={(e) => set("tipo", e.target.value as "produto" | "combo")}>
                <option value="produto">Produto</option>
                <option value="combo">Combo</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Descrição</label>
              <textarea value={form.descricao ?? ""} onChange={(e) => set("descricao", e.target.value || null)} />
            </div>
          </div>
          <div className="field-row">
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Descrição comercial (usada pela IA para vender)</label>
              <textarea
                value={form.descricao_comercial ?? ""}
                onChange={(e) => set("descricao_comercial", e.target.value || null)}
                placeholder="Hambúrguer artesanal de 180g com queijo, bacon e molho especial no pão brioche."
              />
            </div>
          </div>

          <div className="field">
            <label>Tags</label>
            <div className="tags-input">
              {form.tags.map((tag) => (
                <div className="tag-chip" key={tag}>
                  {tag}
                  <button onClick={() => set("tags", form.tags.filter((t) => t !== tag))}>{IconX}</button>
                </div>
              ))}
              <input
                value={novaTag}
                onChange={(e) => setNovaTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), adicionarTag())}
                placeholder="Adicionar tag…"
              />
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-title">Venda</div>
          <div className="section-sub">Preço, disponibilidade e limites de quantidade.</div>

          <div className="field-row">
            <div className="field">
              <label>Preço</label>
              <input
                type="number"
                step="0.01"
                value={form.preco}
                onChange={(e) => set("preco", Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>Preço promocional</label>
              <input
                type="number"
                step="0.01"
                value={form.preco_promocional ?? ""}
                onChange={(e) => set("preco_promocional", e.target.value ? Number(e.target.value) : null)}
              />
            </div>
            <div className="field field-checkbox" style={{ alignSelf: "center", marginTop: 18 }}>
              <input
                type="checkbox"
                id="disponivel"
                checked={form.disponivel}
                onChange={(e) => set("disponivel", e.target.checked)}
              />
              <label htmlFor="disponivel">Disponível agora</label>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label>Horário início</label>
              <input
                type="time"
                value={form.horario_inicio ?? ""}
                onChange={(e) => set("horario_inicio", e.target.value || null)}
              />
            </div>
            <div className="field">
              <label>Horário fim</label>
              <input
                type="time"
                value={form.horario_fim ?? ""}
                onChange={(e) => set("horario_fim", e.target.value || null)}
              />
            </div>
            <div className="field">
              <label>Qtd. mínima</label>
              <input
                type="number"
                value={form.quantidade_minima}
                onChange={(e) => set("quantidade_minima", Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>Qtd. máxima</label>
              <input
                type="number"
                value={form.quantidade_maxima ?? ""}
                onChange={(e) => set("quantidade_maxima", e.target.value ? Number(e.target.value) : null)}
              />
            </div>
            <div className="field">
              <label>Tempo de preparo (min)</label>
              <input
                type="number"
                min={1}
                value={form.tempo_preparo_minutos ?? ""}
                placeholder="Ex.: 15"
                onChange={(e) => set("tempo_preparo_minutos", e.target.value ? Number(e.target.value) : null)}
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Restrições (ex.: "Não permite substituição do pão")</label>
              <input value={form.restricoes ?? ""} onChange={(e) => set("restricoes", e.target.value || null)} />
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-title">Ingredientes</div>
          <div className="section-sub">Composição e alérgenos exibidos ao cliente.</div>

          <div className="repeat-list">
            {ingredientes.map((ing, idx) => (
              <div className="repeat-row" key={idx}>
                <div className="field">
                  <input
                    value={ing.nome}
                    onChange={(e) => atualizarIngrediente(idx, { nome: e.target.value })}
                    placeholder="Queijo cheddar"
                  />
                </div>
                <div className="field-checkbox field">
                  <input
                    type="checkbox"
                    checked={ing.alergeno}
                    onChange={(e) => atualizarIngrediente(idx, { alergeno: e.target.checked })}
                  />
                  <label>Alérgeno</label>
                </div>
                <button className="icon-btn" onClick={() => removerIngrediente(idx)}>
                  {IconTrash}
                </button>
              </div>
            ))}
            {ingredientes.length === 0 && <div className="empty-hint">Nenhum ingrediente cadastrado.</div>}
          </div>
          <button className="add-link" onClick={adicionarIngrediente}>
            {IconPlus} Adicionar ingrediente
          </button>
        </div>

        <div className="section">
          <div className="section-title">Grupos de opções</div>
          <div className="section-sub">
            Modificadores, adicionais, molhos, acompanhamentos e escolhas de combo — a IA sempre consulta estas
            regras antes de oferecer ou aceitar uma personalização.
          </div>

          <div className="repeat-list">
            {grupos.map((grupo, gi) => (
              <div className="grupo-card" key={gi}>
                <div className="grupo-head">
                  <div className="field">
                    <input
                      value={grupo.nome}
                      onChange={(e) => atualizarGrupo(gi, { nome: e.target.value })}
                      placeholder="Adicionais"
                    />
                  </div>
                  <div className="field tipo">
                    <select
                      value={grupo.tipo}
                      onChange={(e) => atualizarGrupo(gi, { tipo: e.target.value as TipoGrupoOpcoes })}
                    >
                      <option value="adicionar">Adicionar</option>
                      <option value="remover">Remover</option>
                      <option value="substituir">Substituir</option>
                      <option value="escolher">Escolher</option>
                    </select>
                  </div>
                  <button className="icon-btn" onClick={() => removerGrupo(gi)}>
                    {IconTrash}
                  </button>
                </div>

                <div className="grupo-regras">
                  <div className="field-checkbox field">
                    <input
                      type="checkbox"
                      checked={grupo.obrigatorio}
                      onChange={(e) => atualizarGrupo(gi, { obrigatorio: e.target.checked })}
                    />
                    <label>Obrigatório</label>
                  </div>
                  <div className="field-checkbox field">
                    <label>Mínimo</label>
                    <input
                      type="number"
                      value={grupo.minimo}
                      onChange={(e) => atualizarGrupo(gi, { minimo: Number(e.target.value) })}
                    />
                  </div>
                  <div className="field-checkbox field">
                    <label>Máximo</label>
                    <input
                      type="number"
                      value={grupo.maximo}
                      onChange={(e) => atualizarGrupo(gi, { maximo: Number(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="opcoes-lista">
                  {grupo.opcoes.map((opcao, oi) => (
                    <div className="opcao-row" key={oi}>
                      <input
                        className="nome"
                        value={opcao.nome}
                        onChange={(e) => atualizarOpcao(gi, oi, { nome: e.target.value })}
                        placeholder="Bacon"
                      />
                      <input
                        className="preco"
                        type="number"
                        step="0.01"
                        value={opcao.preco_adicional}
                        onChange={(e) => atualizarOpcao(gi, oi, { preco_adicional: Number(e.target.value) })}
                        placeholder="+R$ 0,00"
                      />
                      <button className="icon-btn" onClick={() => removerOpcao(gi, oi)}>
                        {IconTrash}
                      </button>
                    </div>
                  ))}
                  {grupo.opcoes.length === 0 && <div className="empty-hint">Nenhuma opção neste grupo.</div>}
                </div>
                <button className="add-link" onClick={() => adicionarOpcao(gi)}>
                  {IconPlus} Adicionar opção
                </button>
              </div>
            ))}
            {grupos.length === 0 && <div className="empty-hint">Nenhum grupo de opções cadastrado.</div>}
          </div>
          <button className="add-link" onClick={adicionarGrupo}>
            {IconPlus} Adicionar grupo de opções
          </button>
        </div>

        <div className="section">
          <div className="section-title">Recomendações</div>
          <div className="section-sub">Produtos que a IA pode sugerir junto com este.</div>

          <div className="repeat-list">
            {relacionados.map((rel, idx) => (
              <div className="repeat-row" key={idx}>
                <div className="field">
                  <select
                    value={rel.relacionado_id}
                    onChange={(e) => atualizarRelacionado(idx, { relacionado_id: e.target.value })}
                  >
                    {outrosProdutos
                      .filter((p) => p.id !== id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nome}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="field">
                  <select
                    value={rel.tipo}
                    onChange={(e) => atualizarRelacionado(idx, { tipo: e.target.value as TipoRelacao })}
                  >
                    <option value="combina_com">Combina com</option>
                    <option value="frequentemente_comprado_com">Frequentemente comprado com</option>
                    <option value="alternativa">Alternativa</option>
                    <option value="similar">Similar</option>
                  </select>
                </div>
                <button className="icon-btn" onClick={() => removerRelacionado(idx)}>
                  {IconTrash}
                </button>
              </div>
            ))}
            {relacionados.length === 0 && <div className="empty-hint">Nenhuma recomendação cadastrada.</div>}
          </div>
          <button className="add-link" onClick={adicionarRelacionado} disabled={outrosProdutos.length === 0}>
            {IconPlus} Adicionar recomendação
          </button>
        </div>
      </div>
    </div>
  );
}
