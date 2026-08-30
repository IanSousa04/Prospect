import { useEffect, useState } from "react";
import type { FontePublico, LayoutPublico, PublicoConfig } from "@prospect/shared";
import { FONTES_PUBLICO, LAYOUTS_PUBLICO } from "@prospect/shared";
import { api } from "../lib/api.js";
import Topbar from "../components/Topbar.js";
import { useToast } from "../components/Toast.js";
import "./ConfiguracoesPublico.css";

/** Cor exibida no picker quando a empresa não configurou (usa a padrão da
 * plataforma) — o valor real continua `null`, só o input de cor precisa de
 * um hex pra renderizar. */
const COR_PADRAO_FALLBACK = "#b4552d";

/** "Padrões" = visuais pré-definidos (resposta do usuário) que preenchem
 * cor/fonte/organização de uma vez. São presets do front, não um conceito
 * separado gravado — o que salva é sempre `PublicoConfig`. */
const PADROES: Array<{ id: string; nome: string; cor_primaria: string | null; fonte: FontePublico; layout: LayoutPublico }> = [
  { id: "padrao", nome: "Padrão", cor_primaria: null, fonte: "padrao", layout: "lista" },
  { id: "rustico", nome: "Rústico", cor_primaria: "#8C4A2F", fonte: "serifada", layout: "lista" },
  { id: "verde", nome: "Verde", cor_primaria: "#2E7D46", fonte: "moderna", layout: "lista" },
  { id: "marinho", nome: "Marinho", cor_primaria: "#1F4E79", fonte: "moderna", layout: "grade" },
  { id: "terracota", nome: "Terracota", cor_primaria: "#C0502F", fonte: "moderna", layout: "grade" },
];

const LABELS_FONTE: Record<FontePublico, string> = {
  padrao: "Padrão (Manrope)",
  serifada: "Serifada",
  moderna: "Moderna",
};

const LABELS_LAYOUT: Record<LayoutPublico, string> = {
  lista: "Lista",
  grade: "Grade",
};

export default function ConfiguracoesPublico() {
  const mostrarToast = useToast();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [publico, setPublico] = useState<PublicoConfig | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api
      .buscarConfiguracaoPublica()
      .then(({ slug: s, publico: p }) => {
        setSlug(s);
        setPublico(p);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : "Erro ao carregar configuração"))
      .finally(() => setCarregando(false));
  }, []);

  /** Salva otimista (a UI reflete na hora) e não sobrescreve o estado local
   * com a resposta: dois ajustes rápidos seguidos (ex.: arrastar o color
   * picker) não podem terminar com a cor antiga "voltando" se as respostas
   * chegarem fora de ordem. Erro = toast + recarrega pra ressincronizar. */
  async function salvar(proximo: PublicoConfig) {
    setPublico(proximo);
    setSalvando(true);
    try {
      await api.salvarConfiguracaoPublica(proximo);
    } catch (e) {
      mostrarToast(e instanceof Error ? e.message : "Não foi possível salvar", "erro");
      api.buscarConfiguracaoPublica().then(({ publico: p }) => setPublico(p));
    } finally {
      setSalvando(false);
    }
  }

  const url = slug ? `${window.location.origin}/p/${slug}` : null;

  async function copiar() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      mostrarToast("Link copiado");
    } catch {
      mostrarToast("Não foi possível copiar", "erro");
    }
  }

  function abrir() {
    if (!url) return;
    window.open(url, "_blank", "noopener");
  }

  if (carregando) {
    return (
      <div className="config-pub-page">
        <Topbar />
        <div className="empty-state">Carregando…</div>
      </div>
    );
  }
  if (erro || !publico) {
    return (
      <div className="config-pub-page">
        <Topbar />
        <div className="empty-state">{erro ?? "Não foi possível carregar a configuração."}</div>
      </div>
    );
  }

  const padraoAtivo = PADROES.find(
    (p) => p.cor_primaria === publico.cor_primaria && p.fonte === publico.fonte && p.layout === publico.layout,
  );

  return (
    <div className="config-pub-page">
      <Topbar />

      <div className="page-header">
        <p className="page-title">Página pública</p>
        <p className="page-sub">Aparência do seu cardápio online e o link para compartilhar.</p>
      </div>

      <div className="config-pub-scroll">
        <section className="secao">
          <div className="secao-titulo">Link do cardápio</div>
          <p className="secao-desc">Este é o endereço onde seus clientes montam o pedido direto no site.</p>

          {url ? (
            <div className="link-row">
              <input
                className="link-input"
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Link da página pública"
              />
              <button className="btn-pub" onClick={abrir}>
                Abrir
              </button>
              <button className="btn-pub btn-pub-primario" onClick={copiar}>
                Copiar URL
              </button>
            </div>
          ) : (
            <p className="secao-desc">A página ainda não tem um endereço definido para esta empresa.</p>
          )}
        </section>

        <section className="secao">
          <div className="secao-titulo">Padrões</div>
          <p className="secao-desc">
            Visuais prontos que aplicam cor, fonte e organização de uma vez.{" "}
            {salvando && <span className="salvando-hint">salvando…</span>}
          </p>

          <div className="padroes">
            {PADROES.map((padrao) => {
              const ativo = padrao.id === padraoAtivo?.id;
              return (
                <button
                  key={padrao.id}
                  className={`padrao-card${ativo ? " padrao-card-ativo" : ""}`}
                  onClick={() => salvar({ cor_primaria: padrao.cor_primaria, fonte: padrao.fonte, layout: padrao.layout })}
                >
                  <span
                    className="padrao-amostra"
                    style={padrao.cor_primaria ? { background: padrao.cor_primaria } : undefined}
                  />
                  <span className="padrao-nome">{padrao.nome}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="secao">
          <div className="secao-titulo">Aparência</div>
          <p className="secao-desc">
            Ajuste cada detalhe do visual da página. {salvando && <span className="salvando-hint">salvando…</span>}
          </p>

          <div className="ferramenta-row">
            <div className="ferramenta-top">
              <div>
                <div className="ferramenta-nome">Cor de destaque</div>
                <div className="ferramenta-desc">
                  Botões, preços e elementos de destaque. Sem cor escolhida, usa a cor padrão da plataforma.
                </div>
              </div>
              <div className="cor-controles">
                <input
                  type="color"
                  className="cor-picker"
                  aria-label="Cor de destaque"
                  value={publico.cor_primaria ?? COR_PADRAO_FALLBACK}
                  onChange={(e) => salvar({ ...publico, cor_primaria: e.target.value })}
                />
                {publico.cor_primaria && (
                  <button className="btn-pub" onClick={() => salvar({ ...publico, cor_primaria: null })}>
                    Padrão
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="ferramenta-row">
            <div className="ferramenta-top">
              <div>
                <div className="ferramenta-nome">Fonte</div>
                <div className="ferramenta-desc">Tipografia usada em toda a página.</div>
              </div>
              <select
                className="campo-select"
                value={publico.fonte}
                onChange={(e) => salvar({ ...publico, fonte: e.target.value as FontePublico })}
              >
                {FONTES_PUBLICO.map((f) => (
                  <option key={f} value={f}>
                    {LABELS_FONTE[f]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="ferramenta-row">
            <div className="ferramenta-top">
              <div>
                <div className="ferramenta-nome">Organização dos produtos</div>
                <div className="ferramenta-desc">Como o cardápio exibe os itens.</div>
              </div>
              <select
                className="campo-select"
                value={publico.layout}
                onChange={(e) => salvar({ ...publico, layout: e.target.value as LayoutPublico })}
              >
                {LAYOUTS_PUBLICO.map((l) => (
                  <option key={l} value={l}>
                    {LABELS_LAYOUT[l]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
