// Status de conexão do WhatsApp por empresa (aba WhatsApp no painel) — ver
// supabase/migrations/0017_whatsapp_conexoes.sql.

export type WhatsappStatus = "desconectado" | "aguardando_qr" | "conectado";

export interface WhatsappConexao {
  empresa_id: string;
  status: WhatsappStatus;
  qr_code: string | null;
  numero_conectado: string | null;
  atualizado_em: string;
}
