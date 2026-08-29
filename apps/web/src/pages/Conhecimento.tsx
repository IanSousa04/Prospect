import { useEffect, useMemo, useState } from "react";
import type { CategoriaConhecimento, ConhecimentoItem, StatusConhecimento } from "@prospect/shared";
import { CATEGORIAS_CONHECIMENTO, META_CATEGORIA_CONHECIMENTO, STATUS_CONHECIMENTO } from "@prospect/shared";
import { api } from "../lib/api.js";
import Topbar from "../components/Topbar.js";
import "./Conhecimento.css";

const ROTULO_STATUS: Record<StatusConhecimento, string> = {
  ativo: "Ativo",
  rascunho: "Rascunho",
  arquivado: "Arquivado",
};

interface Rascunho {
  categoria: CategoriaConhecimento;
  titulo: string;
  conteudo: string;
  status: StatusConhecimento;
}

const RASCUNHO_VAZIO: Rascunho = { categoria: "faq", titulo: "", conteudo: "", status: "ativo" };

export default function Conhecimento() {
  const [itens, setItens] = useState<ConhecimentoItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>(RASCUNHO_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [formAberto, setFormAberto] = useState(false);

  useEffect(() => {
    api
      .listarConhecimento()
      .then(setItens)
      .catch((e) => setErro(e instanceof Error ? e.message : "Não foi possível carregar a base de conhecimento."))
      .finally(() => setCarregando(false));
  }, []);

  const porCategoria = useMemo(() => {
    const mapa = new Map<CategoriaConhecimento, ConhecimentoItem[]>();
    for (const item of itens) {
      const lista = mapa.get(item.categoria) ?? [];
      lista.push(item);
      mapa.set(item.categoria, lista);
    }
    return mapa;
  }, [itens]);

  const ativos = useMemo(() => itens.filter((i) => i.status === "ativo").length, [itens]);

  function abrirNovo() {
    setEditandoId(null);
    setRascunho(RASCUNHO_VAZIO);
    setFormAberto(true);
  }

  function abrirEdicao(item: ConhecimentoItem) {
    setEditandoId(item.id);
    setRascunho({
      categoria: item.categoria,
      titulo: item.titulo,
      conteudo: item.conteudo,
      status: item.status,
    });
    setFormAberto(true);
  }

  function fechar() {
    setFormAberto(false);
    setEditandoId(null);
    setRascunho(RASCUNHO_VAZIO);
  }

  async function salvar() {
    if (!rascunho.titulo.trim() || !rascunho.conteudo.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      if (editandoId) {
        const atualizado = await api.atualizarConhecimento(editandoId, rascunho);
        setItens((atuais) => atuais.map((i) => (i.id === editandoId ? atualizado : i)));
      } else {
        const criado = await api.criarConhecimento(rascunho);
        setItens((atuais) => [...atuais, criado]);
      }
      fechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar o item.");
    } finally {
      setSalvando(false);
    }
  }

  async function remover(item: ConhecimentoItem) {
    if (!window.confirm(`Remover "${item.titulo}" da base de conhecimento?`)) return;
    try {
      await api.removerConhecimento(item.id);
      setItens((atuais) => atuais.filter((i) => i.id !== item.id));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível remover o item.");
    }
  }

  if (carregando) {
    return <div className="empty-state">Carregando base de conhecimento…</div>;
  }

  const metaSelecionada = META_CATEGORIA_CONHECIMENTO[rascunho.categoria];

  return (
    <div className="conhecimento-page">
      <Topbar />

      <div className="page-header">
        <div>
          <p className="page-title">Conhecimento</p>
          <p className="page-sub">
            {itens.length} {itens.length === 1 ? "item cadastrado" : "itens cadastrados"} · {ativos} ativos
          </p>
        </div>
        <button className="btn-primario" onClick={abrirNovo}>
          Novo item
        </button>
      </div>

      {erro && <div className="alerta-erro">{erro}</div>}

      <div className="conhecimento-scroll">
        <p className="intro">
          É daqui que a IA tira as respostas que não são sobre produtos — horário, taxa de entrega, região atendida,
          políticas. Ela só afirma o que está cadastrado: sem um item que responda, ela diz ao cliente que não tem essa
          informação, em vez de improvisar.
        </p>

        {formAberto && (
          <div className="editor-card">
            <div className="editor-titulo">{editandoId ? "Editar item" : "Novo item"}</div>

            <label className="campo">
              <span className="campo-label">Categoria</span>
              <select
                className="campo-select"
                value={rascunho.categoria}
                onChange={(e) => setRascunho({ ...rascunho, categoria: e.target.value as CategoriaConhecimento })}
              >
                {CATEGORIAS_CONHECIMENTO.map((c) => (
                  <option key={c} value={c}>
                    {META_CATEGORIA_CONHECIMENTO[c].rotulo}
                  </option>
                ))}
              </select>
            </label>

            {/* A categoria não é rótulo organizacional: é o que decide qual
                pergunta do cliente enxerga este item. Explicar isso na hora
                da escolha é o que evita cadastrar no lugar errado — foi
                exatamente assim que a área de entrega de uma loja ficou
                invisível pra IA. */}
            <div className={`categoria-dica ${metaSelecionada.temFerramentaDedicada ? "dedicada" : ""}`}>
              {metaSelecionada.quandoAIaUsa}
            </div>

            <label className="campo">
              <span className="campo-label">Título</span>
              <input
                className="campo-texto"
                value={rascunho.titulo}
                maxLength={120}
                placeholder="Ex.: Horário de funcionamento"
                onChange={(e) => setRascunho({ ...rascunho, titulo: e.target.value })}
              />
            </label>

            <label className="campo">
              <span className="campo-label">Conteúdo</span>
              <textarea
                className="campo-texto campo-area"
                value={rascunho.conteudo}
                maxLength={4000}
                rows={5}
                placeholder="Escreva como você responderia ao cliente. Ex.: Abrimos de terça a domingo, das 18h às 23h."
                onChange={(e) => setRascunho({ ...rascunho, conteudo: e.target.value })}
              />
              <span className="contador">{rascunho.conteudo.length}/4000</span>
            </label>

            <label className="campo">
              <span className="campo-label">Status</span>
              <select
                className="campo-select"
                value={rascunho.status}
                onChange={(e) => setRascunho({ ...rascunho, status: e.target.value as StatusConhecimento })}
              >
                {STATUS_CONHECIMENTO.map((s) => (
                  <option key={s} value={s}>
                    {ROTULO_STATUS[s]}
                  </option>
                ))}
              </select>
              <span className="campo-hint">Só itens ativos são consultados pela IA.</span>
            </label>

            <div className="editor-acoes">
              <button className="btn-secundario" onClick={fechar} disabled={salvando}>
                Cancelar
              </button>
              <button
                className="btn-primario"
                onClick={salvar}
                disabled={salvando || !rascunho.titulo.trim() || !rascunho.conteudo.trim()}
              >
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        )}

        {CATEGORIAS_CONHECIMENTO.map((categoria) => {
          const lista = porCategoria.get(categoria) ?? [];
          if (lista.length === 0) return null;
          const meta = META_CATEGORIA_CONHECIMENTO[categoria];

          return (
            <div className="grupo" key={categoria}>
              <div className="grupo-titulo">
                {meta.rotulo}
                {meta.temFerramentaDedicada && <span className="badge-dedicada">consulta dedicada</span>}
              </div>
              <p className="grupo-desc">{meta.quandoAIaUsa}</p>

              {lista.map((item) => (
                <div className={`item-row ${item.status !== "ativo" ? "inativo" : ""}`} key={item.id}>
                  <div className="item-conteudo">
                    <div className="item-titulo">
                      {item.titulo}
                      {item.status !== "ativo" && <span className="badge-status">{ROTULO_STATUS[item.status]}</span>}
                    </div>
                    <div className="item-texto">{item.conteudo}</div>
                  </div>
                  <div className="item-acoes">
                    <button className="btn-linha" onClick={() => abrirEdicao(item)}>
                      Editar
                    </button>
                    <button className="btn-linha btn-remover" onClick={() => remover(item)}>
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {itens.length === 0 && !formAberto && (
          <div className="empty-state">
            Nenhum item cadastrado ainda. Sem base de conhecimento, a IA responde que não tem a informação sempre que o
            cliente perguntar sobre horário, entrega ou políticas.
          </div>
        )}
      </div>
    </div>
  );
}
