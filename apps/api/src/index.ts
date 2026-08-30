import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./lib/env.js";
import { atendimentosRoutes } from "./routes/atendimentos.js";
import { mensagensRoutes } from "./routes/mensagens.js";
import { handoffsRoutes } from "./routes/handoffs.js";
import { clientesRoutes } from "./routes/clientes.js";
import { categoriasRoutes } from "./routes/categorias.js";
import { conhecimentoRoutes } from "./routes/conhecimento.js";
import { produtosRoutes } from "./routes/produtos.js";
import { pedidosRoutes } from "./routes/pedidos.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { iaPermissoesRoutes } from "./routes/ia-permissoes.js";
import { modoTesteRoutes } from "./routes/modo-teste.js";
import { iaConfiguracoesRoutes } from "./routes/ia-configuracoes.js";
import { whatsappRoutes } from "./routes/whatsapp.js";
import { publicoRoutes } from "./routes/publico.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: env.webOrigins });

app.get("/health", async () => ({ status: "ok" }));

await app.register(atendimentosRoutes);
await app.register(mensagensRoutes);
await app.register(handoffsRoutes);
await app.register(clientesRoutes);
await app.register(categoriasRoutes);
await app.register(conhecimentoRoutes);
await app.register(produtosRoutes);
await app.register(pedidosRoutes);
await app.register(analyticsRoutes);
await app.register(iaPermissoesRoutes);
await app.register(modoTesteRoutes);
await app.register(iaConfiguracoesRoutes);
await app.register(whatsappRoutes);
// Sem autenticação de painel — o cliente final monta o pedido sozinho
// (tarefa 0043). Registrado por último só pra deixar claro na leitura que é
// um bloco à parte; a ordem não importa pro Fastify.
await app.register(publicoRoutes);

app
  .listen({ port: env.port, host: "0.0.0.0" })
  .then(() => app.log.info(`api ouvindo na porta ${env.port}`))
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
