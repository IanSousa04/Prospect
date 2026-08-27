function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export const env = {
  empresaId: required("EMPRESA_ID"),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  // Trava de segurança do MVP 1 da camada de IA (ver apps/ai-orchestrator) —
  // só true por decisão explícita, nunca por omissão. Enquanto false, o
  // poller nunca envia de verdade uma mensagem originada da IA.
  iaEnvioReal: process.env.IA_ENVIO_REAL === "true",
};
