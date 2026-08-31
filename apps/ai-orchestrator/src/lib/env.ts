function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export const env = {
  empresaId: required("EMPRESA_ID"),
  deepseekApiKey: required("DEEPSEEK_API_KEY"),
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  // Intervalo do polling que busca mensagens novas do cliente.
  pollingIntervaloMs: Number(process.env.POLLING_INTERVALO_MS ?? 3000),
  // Base URL da página pública (ex.: https://pedido.exemplo.com). Quando
  // configurada, a IA monta o link público da loja (base + slug) pra
  // redirecionar o cliente que quiser fazer pedido; ausente = redireciona
  // sem URL.
  publicoBaseUrl: process.env.PUBLICO_BASE_URL ?? "",
};
