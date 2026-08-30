import "dotenv/config";
import pkg from "whatsapp-web.js";
import type { Client as ClientType } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { env } from "./lib/env.js";
import { ingerirMensagemCliente } from "./lib/ingest.js";
import { estaEmModoTeste, permiteIngestao } from "./lib/whitelist.js";
import { apagarAtendimentosDeTeste } from "./lib/comando-teste.js";
import { tipoMidiaSuportado, baixarESubirMidia, placeholderMidia } from "./lib/media.js";
import { criarHandoffMidiaNaoSuportada } from "./lib/handoff-midia.js";
import { publicarStatus, iniciarPollerConexao } from "./lib/conexao.js";
import { iniciarPoller } from "./poller.js";
import { iniciarPollerVerificacao } from "./poller-verificacao.js";

const { Client, LocalAuth } = pkg;

function criarClient(): ClientType {
  return new Client({
    authStrategy: new LocalAuth({ clientId: env.empresaId }),
  });
}

/**
 * Resolve o telefone real (dígitos, sem sufixo) a partir do JID do
 * remetente. Contatos normais chegam como `<telefone>@c.us`, mas o sistema
 * de privacidade mais recente do WhatsApp pode entregar `<id interno>@lid`
 * em vez disso — `@lid` não é o telefone, é um identificador interno do
 * WhatsApp, então precisa de uma resolução explícita via
 * `client.getContactLidAndPhone` (a mesma API que o próprio whatsapp-web.js
 * expõe pra esse caso) antes de comparar com a whitelist ou salvar em
 * `clientes.telefone`.
 */
async function resolverTelefone(c: ClientType, jid: string): Promise<string> {
  if (!jid.endsWith("@lid")) {
    return jid.replace(/@c\.us$/, "");
  }
  const [resolvido] = await c.getContactLidAndPhone([jid]);
  if (!resolvido?.pn) {
    throw new Error(`não foi possível resolver o telefone real do LID "${jid}"`);
  }
  return resolvido.pn.replace(/@c\.us$/, "");
}

/**
 * Liga os listeners numa instância de `Client` — extraído de índice de
 * módulo pra função porque "conectar outro número" (comando "reconectar",
 * ver lib/conexao.ts) precisa recriar o `Client` do zero depois de um
 * logout: a mesma instância já destruída não pode simplesmente ser
 * reinicializada.
 */
let intervalPoller: NodeJS.Timeout | null = null;
// Poller próprio pros códigos da página pública — nunca passam por
// `mensagens` (ver poller-verificacao.ts).
let intervalPollerVerificacao: NodeJS.Timeout | null = null;

function registrarHandlers(c: ClientType): void {
  c.on("qr", (qr) => {
    console.log(`[whatsapp-worker] escaneie o QR code para a empresa ${env.empresaId}:`);
    qrcode.generate(qr, { small: true });
    void publicarStatus("aguardando_qr", { qr_code: qr });
  });

  c.on("ready", () => {
    console.log(`[whatsapp-worker] conectado — empresa ${env.empresaId}`);
    console.log(
      `[whatsapp-worker] modo de envio de IA: ${env.iaEnvioReal ? "⚠️  REAL (IA_ENVIO_REAL=true)" : "✅ SOMBRA (IA_ENVIO_REAL=false)"}`
    );
    if (!env.iaEnvioReal) {
      console.log(
        `[whatsapp-worker] LEMBRETE: respostas da IA serão geradas mas NÃO enviadas de verdade ao WhatsApp.\n` +
        `  Para mudar isso (só depois de validação completa):\n` +
        `  1. Leia docs/MODO_SOMBRA.md\n` +
        `  2. Rode: npm run -w apps/ai-orchestrator verificar-modo-sombra\n` +
        `  3. Mude IA_ENVIO_REAL=true no .env e reinicie este processo`
      );
    }
    void publicarStatus("conectado", { numero_conectado: c.info.wid.user });
    // Se este client é resultado de um "reconectar", o poller da instância
    // anterior (agora destruída) precisa parar antes de subir um novo —
    // senão dois intervalos ficam tentando enviar mensagem ao mesmo tempo,
    // um deles sempre contra um client já destruído.
    if (intervalPoller) clearInterval(intervalPoller);
    intervalPoller = iniciarPoller(c);
    if (intervalPollerVerificacao) clearInterval(intervalPollerVerificacao);
    intervalPollerVerificacao = iniciarPollerVerificacao(c);
  });

  c.on("message", async (message) => {
    if (message.fromMe || message.isStatus) return;
    // Mensagem de grupo — não é um atendimento 1:1, fora de escopo (o JID de
    // grupo termina em @g.us e não representa um cliente individual).
    if (message.from.endsWith("@g.us")) return;

    // Mídia suportada (imagem/áudio/vídeo/documento) — ver docs/ROADMAP.md §1
    // "Cliente manda imagem/áudio". Verificado ANTES do guard de texto vazio
    // de propósito: cobre tanto mídia sem legenda quanto mídia COM legenda
    // (que antes ingeria só a legenda e descartava a imagem em si, sem avisar
    // ninguém — bug real, não só ausência de feature). Figurinha/reação/
    // enquete continuam fora (tipoMidiaSuportado retorna null pra elas).
    const tipoMidia = message.hasMedia ? tipoMidiaSuportado(message.type) : null;

    // Mensagem sem texto e sem mídia suportada (figurinha, reação, enquete) —
    // nada pra ingerir, evita poluir o Kanban com atendimentos vazios.
    if (!message.body?.trim() && !tipoMidia) return;

    try {
      const telefone = await resolverTelefone(c, message.from);
      const modoTeste = await estaEmModoTeste();

      // Modo teste: enquanto ligado pra esta empresa, número fora da
      // whitelist é ignorado por completo (nem cliente, nem atendimento, nem
      // mensagem) — ver docs/ROADMAP.md §3 "Modo teste com whitelist de números".
      // Log deliberado (não silencioso): sem isso, "modo teste bloqueou" e
      // "número não bate com o esperado" são indistinguíveis de fora.
      if (!(await permiteIngestao(telefone, modoTeste))) {
        console.log(`[whatsapp-worker] modo teste: mensagem de "${message.from}" (telefone="${telefone}") ignorada — fora da whitelist`);
        return;
      }

      // Comando "/exit" do modo teste — só existe como comando enquanto o
      // modo teste está ligado (fora dele, "/exit" é uma mensagem qualquer
      // que vai pro atendimento normal). Nunca gera mensagem nem passa pela
      // IA: apaga o(s) atendimento(s) deste telefone pra permitir recomeçar o
      // teste do zero, e para por aqui.
      if (modoTeste && message.body?.trim().toLowerCase() === "/exit") {
        const apagados = await apagarAtendimentosDeTeste(telefone);
        console.log(`[whatsapp-worker] modo teste: /exit de "${telefone}" — ${apagados} atendimento(s) apagado(s)`);
        return;
      }

      const contato = await message.getContact();
      const nome = contato.pushname || contato.name || null;

      if (tipoMidia) {
        // Baixa e sobe a mídia ANTES de resolver/criar o atendimento — não
        // depende dele (caminho no storage é só empresa/uuid). `downloadMedia`
        // depende de APIs internas do WhatsApp Web que mudam sem aviso (não é
        // a API oficial — ver docs/ROADMAP.md §3) e pode falhar mesmo com
        // mídia válida. Uma falha aqui NUNCA pode significar silêncio total
        // de novo — degrada pra "avisa que chegou mídia, sem preview" em vez
        // de propagar o erro pro catch externo (que não geraria handoff nenhum).
        let midia: Awaited<ReturnType<typeof baixarESubirMidia>> | undefined;
        try {
          midia = await baixarESubirMidia(message, tipoMidia);
        } catch (erroDownload) {
          console.error(`[whatsapp-worker] falha ao baixar mídia (${tipoMidia}), seguindo sem preview:`, erroDownload);
        }

        const legenda = message.body?.trim();
        const conteudo = midia
          ? legenda || placeholderMidia(tipoMidia)
          : `${placeholderMidia(tipoMidia)} — não foi possível baixar automaticamente, peça pro cliente reenviar se precisar ver.${legenda ? ` Legenda: ${legenda}` : ""}`;

        const { atendimentoId } = await ingerirMensagemCliente({
          telefone,
          whatsappId: message.from,
          nome,
          conteudo,
          midia,
          // Sem preview? Marca o tipo mesmo assim — a UI usa isso pra mostrar
          // um indicativo visual claro de "chegou mídia", nunca deixando isso
          // implícito só no texto (pedido explícito do usuário).
          midiaFalha: midia ? undefined : { tipo: tipoMidia },
        });

        // A IA não processa mídia ainda — sempre handoff, nunca tenta
        // responder sozinha (CLAUDE.md regra 4: handoff sempre estruturado).
        // Mesmo sem preview (download falhou), o humano precisa saber que
        // chegou uma mídia — nunca pular o handoff por causa disso.
        await criarHandoffMidiaNaoSuportada(atendimentoId, tipoMidia);
        return;
      }

      await ingerirMensagemCliente({
        // `message.from` (o JID, ex. "5511999999999@c.us") é estável e sempre
        // disponível. `contato.number` depende da resolução do contato e pode
        // vir inconsistente entre mensagens do mesmo remetente (sobretudo com
        // o sistema de privacidade/LID mais recente do WhatsApp) — usá-lo como
        // chave de identificação do cliente cria um cliente (e um atendimento)
        // novo a cada mensagem em vez de reaproveitar o existente.
        telefone,
        whatsappId: message.from,
        nome,
        conteudo: message.body,
      });
    } catch (error) {
      console.error("[whatsapp-worker] falha ao ingerir mensagem:", error);
    }
  });

  c.on("disconnected", (reason) => {
    console.error(`[whatsapp-worker] desconectado: ${reason}`);
    if (intervalPoller) {
      clearInterval(intervalPoller);
      intervalPoller = null;
    }
    if (intervalPollerVerificacao) {
      clearInterval(intervalPollerVerificacao);
      intervalPollerVerificacao = null;
    }
    void publicarStatus("desconectado");
  });
}

let client = criarClient();
registrarHandlers(client);

/** Comando "desconectar" (aba WhatsApp do painel) — desloga e fica parado,
 * sem religar sozinho. O handler "disconnected" já publica o status; a
 * chamada extra aqui é só pra cobrir o caso raro de `logout()` não disparar
 * o evento (ex.: sessão já tinha caído sozinha). */
async function desconectar(): Promise<void> {
  try {
    await client.logout();
  } catch (error) {
    console.error("[whatsapp-worker] falha ao fazer logout:", error);
  }
  await publicarStatus("desconectado");
}

/** Comando "reconectar" (aba WhatsApp do painel, "conectar outro número") —
 * o whatsapp-web.js não troca de número numa sessão já pareada, então a
 * única forma é deslogar, destruir a instância atual e recriar do zero, o
 * que dispara um novo evento "qr" pra escanear. */
async function reconectar(): Promise<void> {
  try {
    await client.logout();
  } catch (error) {
    console.error("[whatsapp-worker] falha ao fazer logout antes de reconectar:", error);
  }
  try {
    await client.destroy();
  } catch (error) {
    console.error("[whatsapp-worker] falha ao destruir client antes de reconectar:", error);
  }

  client = criarClient();
  registrarHandlers(client);
  await client.initialize();
}

// Garante que a aba WhatsApp do painel não fique presa em "carregando" numa
// empresa nova, antes do primeiro evento real do client chegar.
void publicarStatus("desconectado");

iniciarPollerConexao(reconectar, desconectar);

client.initialize();
