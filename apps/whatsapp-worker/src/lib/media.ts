import type { Message } from "whatsapp-web.js";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "./supabase.js";
import { env } from "./env.js";
import type { MidiaMensagem } from "./ingest.js";

export const BUCKET_MIDIAS = "midias-atendimento";

/** Figurinha (`sticker`) fica de fora de propósito — baixo sinal, mesmo
 * motivo que já era ignorada junto com reação/enquete antes desta feature.
 * Qualquer outro tipo (`chat`, `location`, `vcard`...) também não vira
 * mídia — cai fora do fluxo. */
const TIPOS_SUPORTADOS: Record<string, MidiaMensagem["tipo"]> = {
  image: "imagem",
  audio: "audio",
  ptt: "audio", // áudio gravado na hora (push-to-talk) — mesmo tipo de "audio" pro nosso domínio.
  video: "video",
  document: "documento",
};

export function tipoMidiaSuportado(whatsappType: string): MidiaMensagem["tipo"] | null {
  return TIPOS_SUPORTADOS[whatsappType] ?? null;
}

function extensaoDoMimetype(mimetype: string): string {
  const sub = mimetype.split("/")[1]?.split(";")[0];
  return sub && /^[a-z0-9]+$/i.test(sub) ? sub : "bin";
}

/**
 * Baixa a mídia real do WhatsApp e sobe pro bucket privado
 * (`midias-atendimento` — nunca público, o painel só recebe signed URL de
 * curta duração via API, ver apps/api/src/routes/mensagens.ts). Roda ANTES
 * de resolver/criar o atendimento (não depende dele) — caminho do objeto é
 * só `empresa/uuid`, então a mensagem já nasce com o caminho definitivo em
 * metadata_json, sem update posterior nem ordem de dependência.
 */
const TENTATIVAS_DOWNLOAD = 3;
const ESPERA_ENTRE_TENTATIVAS_MS = 1500;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `downloadMedia()` pode falhar transitoriamente logo após o recebimento —
 * o WhatsApp às vezes ainda está resolvendo a mídia internamente
 * (`mediaStage` != "RESOLVED") no instante exato em que o evento `message`
 * dispara. Poucas tentativas curtas resolvem a maioria desses casos sem
 * atrasar o handoff por muito tempo se for uma falha real. */
async function baixarComRetentativa(message: Message) {
  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= TENTATIVAS_DOWNLOAD; tentativa++) {
    try {
      return await message.downloadMedia();
    } catch (erro) {
      ultimoErro = erro;
      if (tentativa < TENTATIVAS_DOWNLOAD) await esperar(ESPERA_ENTRE_TENTATIVAS_MS);
    }
  }
  throw ultimoErro;
}

export async function baixarESubirMidia(message: Message, tipo: MidiaMensagem["tipo"]): Promise<MidiaMensagem> {
  const media = await baixarComRetentativa(message);
  if (!media) {
    throw new Error("message.downloadMedia() retornou vazio apesar de hasMedia=true");
  }

  const buffer = Buffer.from(media.data, "base64");
  const extensao = extensaoDoMimetype(media.mimetype);
  const storagePath = `${env.empresaId}/${randomUUID()}.${extensao}`;

  const { error } = await supabaseAdmin.storage.from(BUCKET_MIDIAS).upload(storagePath, buffer, {
    contentType: media.mimetype,
    upsert: false,
  });
  if (error) {
    throw new Error(`falha ao subir mídia pro storage: ${error.message}`);
  }

  return { tipo, mimetype: media.mimetype, storage_path: storagePath, tamanho_bytes: buffer.byteLength };
}

/** Placeholder legível quando o cliente não mandou legenda junto — nunca
 * deixa `mensagens.conteudo` vazio (histórico da IA e notificações tratam
 * esse campo como texto simples sempre presente). */
export function placeholderMidia(tipo: MidiaMensagem["tipo"]): string {
  const rotulos: Record<MidiaMensagem["tipo"], string> = {
    imagem: "[Imagem recebida]",
    audio: "[Áudio recebido]",
    video: "[Vídeo recebido]",
    documento: "[Documento recebido]",
  };
  return rotulos[tipo];
}
