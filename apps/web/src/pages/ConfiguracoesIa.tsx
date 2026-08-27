import { useEffect, useState } from "react";
import type { ComportamentoJson, NomeFerramenta, NumeroWhitelist, TomDeVoz } from "@prospect/shared";
import { TONS_DE_VOZ } from "@prospect/shared";
import { api, type IaConfiguracaoResposta, type IaPermissaoOuPadrao } from "../lib/api.js";
import Topbar from "../components/Topbar.js";
import "./ConfiguracoesIa.css";

const GRUPOS: Array<{ titulo: string; ferramentas: NomeFerramenta[] }> = [
  {
    titulo: "Catálogo",
    ferramentas: ["buscar_produtos", "buscar_opcoes", "buscar_adicionais", "buscar_combos", "buscar_recomendacoes"],
  },
  { titulo: "Cliente", ferramentas: ["consultar_cliente", "consultar_historico", "atualizar_cliente"] },
  {
    titulo: "Pedido",
    ferramentas: ["consultar_pedido", "criar_pedido", "adicionar_item", "alterar_item", "cancelar_pedido", "consultar_status"],
  },
  { titulo: "Operação", ferramentas: ["consultar_horario", "consultar_taxa", "consultar_regiao", "consultar_politica"] },
  { titulo: "Conhecimento", ferramentas: ["buscar_conhecimento"] },
];

const DESCRICOES: Partial<Record<NomeFerramenta, string>> = {
  buscar_produtos: "Buscar produtos do cardápio por nome.",
  buscar_opcoes: "Listar grupos de personalização de um produto.",
  buscar_adicionais: "Listar só os adicionais de um produto.",
  buscar_combos: "Buscar combos do cardápio.",
  buscar_recomendacoes: "Sugerir produtos relacionados (upsell/cross-sell).",
  consultar_cliente: "Ver dados do cliente da conversa atual.",
  consultar_historico: "Ver pedidos anteriores do cliente da conversa atual.",
  atualizar_cliente: "Ainda não implementada — reservada para o MVP 2.",
  consultar_pedido: "Ver detalhes do pedido da conversa atual.",
  criar_pedido: "Ainda não implementada — reservada para o MVP 2.",
  adicionar_item: "Ainda não implementada — reservada para o MVP 2.",
  alterar_item: "Ainda não implementada — reservada para o MVP 2.",
  cancelar_pedido: "Ainda não implementada — reservada para o MVP 2.",
  consultar_status: "Ver só o status do pedido atual.",
  consultar_horario: "Consultar horário de funcionamento cadastrado.",
  consultar_taxa: "Consultar regras de taxa de entrega cadastradas.",
  consultar_regiao: "Consultar regiões de entrega cadastradas.",
  consultar_politica: "Consultar políticas gerais cadastradas.",
  buscar_conhecimento: "Buscar em FAQ/políticas por texto livre.",
};

const LABELS_TOM_DE_VOZ: Record<TomDeVoz, string> = {
  formal: "Formal",
  neutro: "Neutro",
  amigavel: "Amigável",
  descontraido: "Descontraído",
};

/** Campos booleanos de proatividade comercial — afetam se a IA busca/sugere
 * isso por conta própria (ver agent/investigador.ts regra 10 e
 * agent/atendente.ts) — ausente/true = comportamento atual, só false
 * desliga. Os 2 campos de pedido (fora desta lista) ficam "reservados pro
 * MVP 2", mesmo padrão das ferramentas de escrita na seção de permissões. */
const CAMPOS_COMPORTAMENTO: Array<{ campo: keyof ComportamentoJson; titulo: string; desc: string }> = [
  { campo: "fazer_recomendacoes", titulo: "Fazer recomendações", desc: "IA pode sugerir produtos relacionados por conta própria." },
  { campo: "oferecer_adicionais", titulo: "Oferecer adicionais", desc: "IA pode sugerir adicionais de um produto por conta própria." },
  { campo: "oferecer_combos", titulo: "Oferecer combos", desc: "IA pode sugerir combos do cardápio por conta própria." },
  { campo: "upsell_cross_sell", titulo: "Upsell / cross-sell", desc: "IA pode mencionar upgrades ou produtos complementares na resposta." },
  { campo: "recuperar_intencao_compra", titulo: "Recuperar intenção de compra", desc: "IA pode retomar um pedido ou interesse anterior não finalizado." },
  { campo: "pos_venda", titulo: "Pós-venda", desc: 'IA pode perguntar sobre a experiência após o pedido (ex.: "como foi?").' },
  { campo: "personalizar_com_historico", titulo: "Personalizar com histórico", desc: "IA pode citar o produto favorito do cliente (baseado no histórico de pedidos) para sugerir repetição ou novidade." },
];

export default function ConfiguracoesIa() {
  const [permissoes, setPermissoes] = useState<IaPermissaoOuPadrao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<NomeFerramenta | null>(null);

  const [modoTeste, setModoTeste] = useState(false);
  const [numeros, setNumeros] = useState<NumeroWhitelist[]>([]);
  const [novoTelefone, setNovoTelefone] = useState("");
  const [salvandoModoTeste, setSalvandoModoTeste] = useState(false);
  const [salvandoNumero, setSalvandoNumero] = useState(false);

  const [config, setConfig] = useState<IaConfiguracaoResposta | null>(null);
  const [salvandoConfig, setSalvandoConfig] = useState(false);

  useEffect(() => {
    api
      .listarIaPermissoes()
      .then(setPermissoes)
      .finally(() => setCarregando(false));
    api.buscarModoTeste().then(({ modo_teste, numeros }) => {
      setModoTeste(modo_teste);
      setNumeros(numeros);
    });
    api.buscarIaConfiguracao().then(setConfig);
  }, []);

  async function salvarConfig(proximo: IaConfiguracaoResposta) {
    setConfig(proximo);
    setSalvandoConfig(true);
    try {
      await api.salvarIaConfiguracao(proximo);
    } finally {
      setSalvandoConfig(false);
    }
  }

  function alterarComportamento(campo: keyof ComportamentoJson, valor: boolean) {
    if (!config) return;
    salvarConfig({ ...config, comportamento_json: { ...config.comportamento_json, [campo]: valor } });
  }

  async function alternarModoTeste() {
    const novo = !modoTeste;
    setModoTeste(novo);
    setSalvandoModoTeste(true);
    try {
      await api.atualizarModoTeste(novo);
    } finally {
      setSalvandoModoTeste(false);
    }
  }

  async function adicionarNumero() {
    const telefone = novoTelefone.trim();
    if (!telefone) return;
    setSalvandoNumero(true);
    try {
      const numero = await api.criarNumeroWhitelist(telefone);
      setNumeros((lista) => [numero, ...lista.filter((n) => n.id !== numero.id)]);
      setNovoTelefone("");
    } finally {
      setSalvandoNumero(false);
    }
  }

  async function alternarNumeroAtivo(numero: NumeroWhitelist) {
    setNumeros((lista) => lista.map((n) => (n.id === numero.id ? { ...n, ativo: !n.ativo } : n)));
    await api.atualizarNumeroWhitelist(numero.id, !numero.ativo);
  }

  async function removerNumero(id: string) {
    setNumeros((lista) => lista.filter((n) => n.id !== id));
    await api.removerNumeroWhitelist(id);
  }

  function porFerramenta(nome: NomeFerramenta): IaPermissaoOuPadrao | undefined {
    return permissoes.find((p) => p.ferramenta === nome);
  }

  async function alternarPermitido(nome: NomeFerramenta) {
    const atual = porFerramenta(nome);
    const novoPermitido = !(atual?.permitido ?? false);

    setPermissoes((lista) =>
      lista.map((p) => (p.ferramenta === nome ? { ...p, permitido: novoPermitido } : p)),
    );
    setSalvando(nome);
    try {
      await api.salvarIaPermissao({
        ferramenta: nome,
        permitido: novoPermitido,
        exige_confirmacao_humana: atual?.exige_confirmacao_humana ?? null,
        valor_maximo_sem_handoff: atual?.valor_maximo_sem_handoff ?? null,
      });
    } finally {
      setSalvando(null);
    }
  }

  async function atualizarValorMaximo(nome: NomeFerramenta, valor: number | null) {
    const atual = porFerramenta(nome);
    setPermissoes((lista) =>
      lista.map((p) => (p.ferramenta === nome ? { ...p, valor_maximo_sem_handoff: valor } : p)),
    );
    setSalvando(nome);
    try {
      await api.salvarIaPermissao({
        ferramenta: nome,
        permitido: atual?.permitido ?? false,
        exige_confirmacao_humana: atual?.exige_confirmacao_humana ?? null,
        valor_maximo_sem_handoff: valor,
      });
    } finally {
      setSalvando(null);
    }
  }

  if (carregando || !config) {
    return <div className="empty-state">Carregando…</div>;
  }

  return (
    <div className="config-ia-page">
      <Topbar />

      <div className="page-header">
        <p className="page-title">Configurações da IA</p>
        <p className="page-sub">Identidade, comportamento comercial, permissões por ferramenta e modo teste.</p>
      </div>

      <div className="config-ia-scroll">
        <section className="secao">
          <div className="secao-titulo">Identidade e tom</div>
          <p className="secao-desc">Como a IA se apresenta e fala com o cliente. {salvandoConfig && <span className="salvando-hint">salvando…</span>}</p>

          <div className="ferramenta-row">
            <label className="campo-label" htmlFor="nome-assistente">
              Nome do assistente
            </label>
            <input
              id="nome-assistente"
              className="campo-texto"
              type="text"
              placeholder="Ex.: Bia — deixe em branco pra usar um texto genérico honesto"
              defaultValue={config.nome_assistente ?? ""}
              onBlur={(e) => salvarConfig({ ...config, nome_assistente: e.target.value.trim() || null })}
            />
            <div className="ferramenta-desc">
              Usado só quando o cliente pergunta a identidade da IA (ex.: "qual seu nome?"). Sem nome configurado, a
              resposta é um texto genérico que ainda assim nunca afirma ser humana.
            </div>
          </div>

          <div className="ferramenta-row">
            <div className="ferramenta-top">
              <div>
                <div className="campo-label">Tom de voz</div>
                <div className="ferramenta-desc">Estilo de escrita que o Atendente usa em toda resposta.</div>
              </div>
              <select
                className="campo-select"
                value={config.tom_de_voz}
                onChange={(e) => salvarConfig({ ...config, tom_de_voz: e.target.value as TomDeVoz })}
              >
                {TONS_DE_VOZ.map((t) => (
                  <option key={t} value={t}>
                    {LABELS_TOM_DE_VOZ[t]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="ferramenta-row">
            <div className="ferramenta-top">
              <div>
                <div className="campo-label">Usar emoji</div>
                <div className="ferramenta-desc">Permite emojis com moderação nas respostas.</div>
              </div>
              <div
                className={`toggle ${config.usa_emoji ? "on" : ""}`}
                onClick={() => salvarConfig({ ...config, usa_emoji: !config.usa_emoji })}
              >
                <div className="toggle-knob" />
              </div>
            </div>
          </div>
        </section>

        <section className="secao">
          <div className="secao-titulo">Comportamento comercial</div>
          <p className="secao-desc">
            O que a IA pode sugerir/oferecer por conta própria, sem o cliente pedir. Desligado = a IA só responde o
            que foi perguntado.
          </p>

          {CAMPOS_COMPORTAMENTO.map(({ campo, titulo, desc }) => {
            const ligado = config.comportamento_json[campo] !== false;
            return (
              <div className="ferramenta-row" key={campo}>
                <div className="ferramenta-top">
                  <div>
                    <div className="ferramenta-nome">{titulo}</div>
                    <div className="ferramenta-desc">{desc}</div>
                  </div>
                  <div className={`toggle ${ligado ? "on" : ""}`} onClick={() => alterarComportamento(campo, !ligado)}>
                    <div className="toggle-knob" />
                  </div>
                </div>
              </div>
            );
          })}

          <div className="ferramenta-row ferramenta-row-reservada">
            <div className="ferramenta-top">
              <div>
                <div className="ferramenta-nome">Confirmação de pedido obrigatória</div>
                <div className="ferramenta-desc">Ainda não aplicável — depende da IA poder criar pedido, reservado pro MVP 2.</div>
              </div>
              <div className="toggle" />
            </div>
          </div>
        </section>

        <section className="secao">
          <div className="secao-titulo">Permissões por ferramenta</div>
          <p className="secao-desc">Ausência de permissão explícita significa que a IA nunca executa aquela ação.</p>

          {GRUPOS.map((grupo) => (
            <div className="grupo" key={grupo.titulo}>
              <div className="grupo-titulo">{grupo.titulo}</div>
              {grupo.ferramentas.map((nome) => {
                const permissao = porFerramenta(nome);
                const ligado = permissao?.permitido ?? false;
                return (
                  <div className="ferramenta-row" key={nome}>
                    <div className="ferramenta-top">
                      <div>
                        <div className="ferramenta-nome">{nome}</div>
                        <div className="ferramenta-desc">{DESCRICOES[nome]}</div>
                      </div>
                      <div className={`toggle ${ligado ? "on" : ""}`} onClick={() => alternarPermitido(nome)}>
                        <div className="toggle-knob" />
                      </div>
                    </div>
                    {nome === "criar_pedido" && ligado && (
                      <div className="extra-fields">
                        <label className="extra-field">
                          Valor máximo sem handoff
                          <input
                            type="number"
                            step="0.01"
                            value={permissao?.valor_maximo_sem_handoff ?? ""}
                            onChange={(e) =>
                              atualizarValorMaximo(nome, e.target.value ? Number(e.target.value) : null)
                            }
                          />
                        </label>
                        {salvando === nome && <span className="salvando-hint">salvando…</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </section>

        <section className="secao">
          <div className="secao-titulo">Modo teste</div>
          <p className="secao-desc">Whitelist de números — útil pra testar sem afetar clientes reais.</p>

          <div className="ferramenta-row">
            <div className="ferramenta-top">
              <div>
                <div className="ferramenta-nome">Modo teste ligado</div>
                <div className="ferramenta-desc">
                  Enquanto ligado, mensagem de número fora da lista abaixo é ignorada por completo — nem cliente, nem
                  atendimento, nem IA.
                </div>
              </div>
              <div className={`toggle ${modoTeste ? "on" : ""}`} onClick={alternarModoTeste}>
                <div className="toggle-knob" />
              </div>
            </div>
            {salvandoModoTeste && <span className="salvando-hint">salvando…</span>}

            {modoTeste && (
              <>
                <form
                  className="whitelist-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    adicionarNumero();
                  }}
                >
                  <input
                    type="text"
                    placeholder="5511999999999"
                    value={novoTelefone}
                    onChange={(e) => setNovoTelefone(e.target.value)}
                  />
                  <button type="submit" disabled={salvandoNumero || !novoTelefone.trim()}>
                    Adicionar
                  </button>
                </form>

                {numeros.length === 0 && <div className="ferramenta-desc">Nenhum número na whitelist ainda.</div>}
                {numeros.map((numero) => (
                  <div className="numero-row" key={numero.id}>
                    <span className="numero-telefone">{numero.telefone}</span>
                    <div className="numero-acoes">
                      <div className={`toggle ${numero.ativo ? "on" : ""}`} onClick={() => alternarNumeroAtivo(numero)}>
                        <div className="toggle-knob" />
                      </div>
                      <button className="numero-remover" onClick={() => removerNumero(numero.id)}>
                        remover
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
