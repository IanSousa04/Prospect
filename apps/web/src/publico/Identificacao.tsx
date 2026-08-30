import { useEffect, useMemo, useRef, useState } from "react";
import type {
  LojaPublica,
  SessaoPublicaCriada,
  VerificacaoSolicitada,
} from "@prospect/shared";
import {
  INTERVALO_REENVIO_SEGUNDOS,
  TAMANHO_CODIGO_VERIFICACAO,
  VALIDADE_CODIGO_MINUTOS,
  normalizarTelefoneBr,
} from "@prospect/shared";
import { apiPublica, mensagemDeErro } from "./apiPublico.js";
import { aparenciaClasse, aparenciaVars } from "./aparencia.js";

/** Máscara de digitação. Só apresentação — quem decide se o número é válido é
 * `normalizarTelefoneBr`, a MESMA função que a API usa (nenhuma regra de
 * telefone é reescrita no front). */
function mascarar(valor: string): string {
  const d = valor.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10)
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

type Etapa = "telefone" | "codigo";

export default function Identificacao(props: {
  loja: LojaPublica;
  aoAutenticar: (sessao: SessaoPublicaCriada) => void;
}) {
  const { loja, aoAutenticar } = props;

  const [etapa, setEtapa] = useState<Etapa>("telefone");
  const [telefone, setTelefone] = useState("");
  const [codigo, setCodigo] = useState("");
  const [verificacao, setVerificacao] = useState<VerificacaoSolicitada | null>(
    null,
  );
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Estado REAL do envio, vindo do worker — a tela só diz "enviado" depois
  // que a API do WhatsApp confirmou (CLAUDE.md regra 7). Enquanto isso o
  // texto honesto é "enviando".
  const [envioConfirmado, setEnvioConfirmado] = useState(false);
  const [falhaEnvio, setFalhaEnvio] = useState(false);
  const [segundosReenvio, setSegundosReenvio] = useState(0);

  const campoCodigo = useRef<HTMLInputElement>(null);

  const telefoneNormalizado = useMemo(
    () => normalizarTelefoneBr(telefone),
    [telefone],
  );

  useEffect(() => {
    if (segundosReenvio <= 0) return;
    const id = setInterval(
      () => setSegundosReenvio((s) => Math.max(0, s - 1)),
      1000,
    );
    return () => clearInterval(id);
  }, [segundosReenvio]);

  // Confirmação de envio: o worker envia em background, então a tela pergunta
  // até saber. Para de perguntar quando confirma, quando falha, ou depois de
  // ~1 minuto (aí o problema não é demora, e insistir só gasta rede do
  // cliente).
  useEffect(() => {
    if (!verificacao || envioConfirmado || falhaEnvio) return;

    let tentativas = 0;
    const id = setInterval(async () => {
      tentativas += 1;
      try {
        const status = await apiPublica.statusVerificacao(
          loja.slug,
          verificacao.verificacao_id,
        );
        if (status.enviado) {
          setEnvioConfirmado(true);
          clearInterval(id);
        } else if (status.erro_envio) {
          setFalhaEnvio(true);
          clearInterval(id);
        }
      } catch {
        // Falha de rede na consulta de status não é falha de envio — o
        // código pode ter chegado. Segue tentando até o limite.
      }
      if (tentativas >= 20) clearInterval(id);
    }, 3000);

    return () => clearInterval(id);
  }, [verificacao, envioConfirmado, falhaEnvio, loja.slug]);

  async function pedirCodigo(e?: React.FormEvent) {
    e?.preventDefault();
    if (!telefoneNormalizado || enviando) return;

    setEnviando(true);
    setErro(null);
    setEnvioConfirmado(false);
    setFalhaEnvio(false);

    try {
      const resposta = await apiPublica.solicitarCodigo(
        loja.slug,
        telefoneNormalizado,
      );
      setVerificacao(resposta);
      setCodigo("");
      setEtapa("codigo");
      setSegundosReenvio(resposta.reenviar_em_segundos);
      setTimeout(() => campoCodigo.current?.focus(), 50);
    } catch (e) {
      const espera = (e as any)?.corpo?.esperar_segundos;
      if (typeof espera === "number") setSegundosReenvio(espera);
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  }

  async function confirmar(e?: React.FormEvent) {
    e?.preventDefault();
    if (
      !verificacao ||
      codigo.length !== TAMANHO_CODIGO_VERIFICACAO ||
      enviando
    )
      return;

    setEnviando(true);
    setErro(null);

    try {
      const sessao = await apiPublica.confirmarCodigo(
        loja.slug,
        verificacao.verificacao_id,
        codigo,
      );
      aoAutenticar(sessao);
    } catch (e) {
      setErro(mensagemDeErro(e));
      // Código morto (expirado, bloqueado ou inválido) não tem conserto
      // digitando de novo — volta pra tela do telefone em vez de deixar o
      // cliente batendo num campo que nunca vai aceitar nada.
      const codigoErro = (e as any)?.codigo;
      if (
        codigoErro === "codigo_expirado" ||
        codigoErro === "codigo_bloqueado" ||
        codigoErro === "codigo_invalido"
      ) {
        setVerificacao(null);
        setEtapa("telefone");
      }
      setCodigo("");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={`pp-identificacao ${aparenciaClasse(loja.aparencia)}`} style={aparenciaVars(loja.aparencia)}>
      <div className="pp-ident-card">
        <div className="pp-ident-marca">
          <span className="pp-ident-inicial">
            {loja.nome.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h1 className="pp-ident-loja">{loja.nome}</h1>
            <p className="pp-ident-sub">Peça direto pelo site</p>
          </div>
        </div>

        {etapa === "telefone" ? (
          <form className="pp-form" onSubmit={pedirCodigo}>
            <label className="pp-label" htmlFor="pp-telefone">
              Seu WhatsApp
            </label>
            <input
              id="pp-telefone"
              className="pp-input pp-input-grande"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="(11) 91234-5678"
              value={telefone}
              onChange={(event) => setTelefone(mascarar(event.target.value))}
              aria-describedby="pp-telefone-ajuda"
              autoFocus
            />
            <p className="pp-ajuda" id="pp-telefone-ajuda">
              Enviamos um código de {TAMANHO_CODIGO_VERIFICACAO} dígitos para
              confirmar que o número é seu.
            </p>

            {erro && (
              <p className="pp-erro" role="alert">
                {erro}
              </p>
            )}

            <button
              className="pp-btn-primario"
              type="submit"
              disabled={!telefoneNormalizado || enviando}
            >
              {enviando ? "Enviando…" : "Continuar"}
            </button>
          </form>
        ) : (
          <form className="pp-form" onSubmit={confirmar}>
            <label className="pp-label" htmlFor="pp-codigo">
              Código enviado para {verificacao?.telefone_mascarado}
            </label>
            <input
              id="pp-codigo"
              ref={campoCodigo}
              className="pp-input pp-input-codigo"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={TAMANHO_CODIGO_VERIFICACAO}
              placeholder="000000"
              value={codigo}
              onChange={(event) =>
                setCodigo(event.target.value.replace(/\D/g, ""))
              }
            />

            <p className={falhaEnvio ? "pp-erro" : "pp-ajuda"} role="status">
              {falhaEnvio
                ? "Não conseguimos enviar a mensagem. Confira o número e tente de novo."
                : envioConfirmado
                  ? `Mensagem enviada no WhatsApp. O código vale por ${VALIDADE_CODIGO_MINUTOS} minutos.`
                  : "Enviando a mensagem no WhatsApp…"}
            </p>

            {erro && (
              <p className="pp-erro" role="alert">
                {erro}
              </p>
            )}

            <button
              className="pp-btn-primario"
              type="submit"
              disabled={
                codigo.length !== TAMANHO_CODIGO_VERIFICACAO || enviando
              }
            >
              {enviando ? "Confirmando…" : "Confirmar código"}
            </button>

            <div className="pp-ident-acoes">
              <button
                className="pp-btn-texto"
                type="button"
                onClick={() => {
                  setEtapa("telefone");
                  setErro(null);
                }}
              >
                Trocar número
              </button>
              <button
                className="pp-btn-texto"
                type="button"
                onClick={() => pedirCodigo()}
                disabled={segundosReenvio > 0 || enviando}
              >
                {segundosReenvio > 0
                  ? `Reenviar em ${segundosReenvio}s`
                  : `Reenviar código (a cada ${INTERVALO_REENVIO_SEGUNDOS}s)`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
