// Página pública de pedido (tarefa 0043) — o único conjunto de rotas da API
// SEM autenticação de painel. Três cuidados valem pra todas elas:
//
// 1. **Tenant.** Antes do login, o tenant vem do `slug` da URL e é resolvido
//    contra `empresas` numa query própria; depois do login, vem da SESSÃO,
//    nunca do corpo (CLAUDE.md regra 5). Nenhuma rota autenticada aqui
//    recebe slug — se recebesse, um token de uma empresa poderia ser
//    apontado pra outra.
// 2. **Superfície de dados.** Toda leitura lista os campos explicitamente.
//    `select *` numa rota pública é como um campo interno novo vaza pro
//    mundo sem ninguém decidir isso.
// 3. **Estado do pedido.** O carrinho é o MESMO Order Context da conversa
//    (`ia_sessoes.estado_json.pedido`) e passa pelo mesmo serviço que o
//    painel usa (services/carrinho.ts). A criação do pedido passa pelo mesmo
//    gate de `validarPreRequisitosDeCriacao` que a IA — o cliente clicando
//    num botão é uma confirmação melhor que a de um modelo, mas a
//    idempotência e a validação de completude valem igual.
import type { FastifyInstance, FastifyReply } from "fastify";
import type {
  CatalogoPublico,
  ClientePublico,
  EnderecoEntrega,
  EstadoSessaoPublica,
  FormaPagamento,
  LojaPublica,
  Pedido,
  PedidoPublicoResumo,
  ProdutoPublicoDetalhado,
  SessaoPublicaCriada,
  StatusPedido,
  StatusVerificacao,
  TipoEntrega,
  VerificacaoSolicitada,
} from "@prospect/shared";
import {
  FLUXO_PEDIDO_CONFIG_PADRAO,
  FluxoPedidoConfigSchema,
  INTERVALO_REENVIO_SEGUNDOS,
  MAX_TENTATIVAS_CODIGO,
  PRAZO_ENTREGA_MAX_PADRAO,
  PRAZO_ENTREGA_MIN_PADRAO,
  PUBLICO_CONFIG_PADRAO,
  PublicoConfigSchema,
  VALIDADE_CODIGO_MINUTOS,
  calcularHashConfirmacao,
  calcularSubtotal,
  codigoVerificacaoValido,
  construirResumoTexto,
  criarPedidoComItens,
  mascararTelefoneBr,
  normalizarTelefoneBr,
  pedidoVazio,
  resumoPedidoIa,
  validarPreRequisitosDeCriacao,
} from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { consumirRateLimit } from "../lib/rate-limit.js";
import {
  criarSessaoPublica,
  gerarCodigoVerificacao,
  hashSegredo,
  hashesIguais,
  requireSessaoPublica,
} from "../lib/sessao-publica.js";
import {
  adicionarItemAoCarrinho,
  atualizarItemDoCarrinho,
  carregarEstadoIa,
  carregarFluxoPedidoConfig,
  definirEntregaDoCarrinho,
  definirPagamentoDoCarrinho,
  lerCarrinho,
  mesclarEstadoIa,
  removerItemDoCarrinho,
  salvarPedidoIa,
  type ResultadoCarrinho,
} from "../services/carrinho.js";

/** Janela em que o resumo final mostrado ao cliente ainda vale como
 * confirmação. Curta: é o tempo entre ele ler o resumo e apertar o botão,
 * não o tempo de montar o pedido inteiro. */
const VALIDADE_REVISAO_MINUTOS = 15;

/** Pedido nestes status ainda está em andamento — a página pública nunca
 * deixa abrir um segundo pedido por cima de um destes. É a proteção mais
 * forte contra pedido duplicado: vale mesmo se o cliente abrir a página em
 * dois celulares, o que a idempotência por hash sozinha não cobriria. */
const STATUS_PEDIDO_EM_ANDAMENTO: StatusPedido[] = [
  "aberto",
  "em_preparacao",
  "pronto",
];

const ERROS_CARRINHO_400: ReadonlySet<string> = new Set([
  "produto_e_quantidade_obrigatorios",
  "tipo_entrega_invalido",
  "tipo_entrega_nao_oferecido",
  "forma_pagamento_invalida",
  "forma_pagamento_nao_aceita",
]);

interface EmpresaPublica {
  id: string;
  nome: string;
  slug: string;
  segmento: string | null;
}

/** Resolve o tenant pelo slug da URL. Empresa cancelada/suspensa não tem
 * página pública no ar — vender por um link de quem não é mais cliente da
 * plataforma seria receber pedido que ninguém vai preparar. */
async function resolverEmpresa(slug: string): Promise<EmpresaPublica | null> {
  const { data } = await supabaseAdmin
    .from("empresas")
    .select("id, nome, slug, segmento, status")
    .eq("slug", slug)
    .maybeSingle();

  if (!data || (data.status !== "ativo" && data.status !== "trial"))
    return null;
  return {
    id: data.id,
    nome: data.nome,
    slug: data.slug,
    segmento: data.segmento,
  };
}

function clientePublico(row: {
  id: string;
  nome: string | null;
  telefone: string;
  endereco_json: EnderecoEntrega | null;
}): ClientePublico {
  return {
    id: row.id,
    nome: row.nome,
    telefone: row.telefone,
    endereco_json: row.endereco_json,
  };
}

function pedidoPublico(pedido: Pedido): PedidoPublicoResumo {
  return {
    numero: pedido.numero,
    status: pedido.status,
    tipo_entrega: pedido.tipo_entrega,
    forma_pagamento: pedido.forma_pagamento,
    subtotal: Number(pedido.subtotal),
    taxa_entrega: Number(pedido.taxa_entrega),
    total: Number(pedido.total),
    criado_em: pedido.criado_em,
  };
}

/** A conversa ATIVA do cliente — a mesma que aparece no Kanban e que a IA
 * está conduzindo. É isto que faz o pedido da página pública cair na conversa
 * existente em vez de abrir uma paralela (requisito 7 da tarefa). */
async function buscarAtendimentoAtivo(
  empresaId: string,
  clienteId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("atendimentos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("cliente_id", clienteId)
    .neq("status", "resolvido")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Nunca tratar erro de consulta como "não achou": criaria um atendimento
  // duplicado por cima de um problema real (mesmo cuidado do ingest do
  // whatsapp-worker).
  if (error) throw new Error(`erro_ao_buscar_atendimento: ${error.message}`);
  return data?.id ?? null;
}

/**
 * Conversa a que este pedido pertence, criando uma se ainda não houver.
 * Chamado só nas MUTAÇÕES de carrinho, nunca no login: um atendimento criado
 * quando o cliente só abriu o cardápio viraria um card vazio no Kanban, que
 * alguém teria que fechar na mão.
 *
 * O atendimento novo nasce em `ia_atendendo` — o mesmo estado em que uma
 * conversa nasce pelo WhatsApp. Não é ficção: se o cliente escrever depois, é
 * exatamente a IA que vai responder, na mesma conversa e com o mesmo
 * carrinho.
 */
async function resolverAtendimentoParaPedido(
  empresaId: string,
  clienteId: string,
): Promise<string> {
  const existente = await buscarAtendimentoAtivo(empresaId, clienteId);
  if (existente) return existente;

  const { data, error } = await supabaseAdmin
    .from("atendimentos")
    .insert({
      empresa_id: empresaId,
      cliente_id: clienteId,
      status: "ia_atendendo",
    })
    .select("id")
    .single();

  if (error || !data)
    throw new Error(`erro_ao_criar_atendimento: ${error?.message}`);
  return data.id;
}

async function buscarPedidoAtivo(
  empresaId: string,
  atendimentoId: string,
): Promise<Pedido | null> {
  const { data } = await supabaseAdmin
    .from("pedidos")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("atendimento_id", atendimentoId)
    .in("status", STATUS_PEDIDO_EM_ANDAMENTO)
    .is("arquivado_em", null)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as Pedido | null) ?? null;
}

export async function publicoRoutes(app: FastifyInstance): Promise<void> {
  function responderCarrinho(
    reply: FastifyReply,
    resultado: ResultadoCarrinho,
  ) {
    if (resultado.ok) return resultado.resumo;
    const codigo = ERROS_CARRINHO_400.has(resultado.erro) ? 400 : 404;
    return reply
      .code(codigo)
      .send({ error: resultado.erro, ...(resultado.extra ?? {}) });
  }

  // =====================================================================
  // Vitrine — tudo abaixo é anônimo, ninguém precisa se identificar pra
  // olhar o cardápio (obrigar login antes de ver preço é a forma mais
  // rápida de perder o cliente na porta).
  // =====================================================================

  app.get<{ Params: { slug: string } }>(
    "/publico/:slug",
    async (request, reply) => {
      const empresa = await resolverEmpresa(request.params.slug);
      if (!empresa)
        return reply.code(404).send({ error: "loja_nao_encontrada" });

      const { data: config } = await supabaseAdmin
        .from("ia_configuracoes")
        .select("fluxo_pedido_json, prazo_entrega_min_minutos, prazo_entrega_max_minutos, publico_json")
        .eq("empresa_id", empresa.id)
        .maybeSingle();

      const fluxo = FluxoPedidoConfigSchema.safeParse(
        config?.fluxo_pedido_json ?? {},
      );
      const aparencia = PublicoConfigSchema.safeParse(
        config?.publico_json ?? {},
      );

      const loja: LojaPublica = {
        slug: empresa.slug,
        nome: empresa.nome,
        segmento: empresa.segmento,
        fluxo_pedido: fluxo.success ? fluxo.data : FLUXO_PEDIDO_CONFIG_PADRAO,
        // Range de prazo cadastrado pela empresa (default 60–90) — a página
        // nunca estima prazo por conta própria (CLAUDE.md regra 1).
        prazo_entrega_min_minutos:
          config?.prazo_entrega_min_minutos ?? PRAZO_ENTREGA_MIN_PADRAO,
        prazo_entrega_max_minutos:
          config?.prazo_entrega_max_minutos ?? PRAZO_ENTREGA_MAX_PADRAO,
        aparencia: aparencia.success ? aparencia.data : PUBLICO_CONFIG_PADRAO,
      };
      return loja;
    },
  );

  app.get<{ Params: { slug: string } }>(
    "/publico/:slug/catalogo",
    async (request, reply) => {
      const empresa = await resolverEmpresa(request.params.slug);
      if (!empresa)
        return reply.code(404).send({ error: "loja_nao_encontrada" });

      const [categorias, produtos] = await Promise.all([
        supabaseAdmin
          .from("categorias")
          .select("id, nome, ordem")
          .eq("empresa_id", empresa.id)
          .eq("status", "ativo")
          .order("ordem"),
        supabaseAdmin
          .from("produtos")
          .select(
            "id, categoria_id, tipo, nome, descricao, descricao_comercial, imagem_url, tags, preco, preco_promocional, disponivel, quantidade_minima, quantidade_maxima, horario_inicio, horario_fim, restricoes",
          )
          .eq("empresa_id", empresa.id)
          .eq("status", "ativo")
          .order("nome"),
      ]);

      if (categorias.error || produtos.error) {
        request.log.error(categorias.error ?? produtos.error);
        return reply.code(500).send({ error: "erro_ao_carregar_catalogo" });
      }

      // Produto indisponível continua na lista, marcado — some da lista seria
      // pior: o cliente procura o que veio comer, não acha, e conclui que o
      // cardápio está errado. `disponivel` aqui já considera a janela de
      // horário do produto, a mesma regra que `montarItensComSnapshot` aplica
      // na hora de aceitar o item (nunca uma segunda regra de "está vendendo").
      const agoraMin = minutosAgora();
      const catalogo: CatalogoPublico = {
        categorias: categorias.data ?? [],
        produtos: (produtos.data ?? []).map((p: any) => ({
          id: p.id,
          categoria_id: p.categoria_id,
          tipo: p.tipo,
          nome: p.nome,
          descricao: p.descricao,
          descricao_comercial: p.descricao_comercial,
          imagem_url: p.imagem_url,
          tags: p.tags,
          preco: Number(p.preco),
          preco_promocional:
            p.preco_promocional != null ? Number(p.preco_promocional) : null,
          disponivel:
            p.disponivel &&
            dentroDoHorario(agoraMin, p.horario_inicio, p.horario_fim),
          quantidade_minima: p.quantidade_minima,
          quantidade_maxima: p.quantidade_maxima,
          restricoes: p.restricoes,
        })),
      };
      return catalogo;
    },
  );

  app.get<{ Params: { slug: string; produtoId: string } }>(
    "/publico/:slug/produtos/:produtoId",
    async (request, reply) => {
      const empresa = await resolverEmpresa(request.params.slug);
      if (!empresa)
        return reply.code(404).send({ error: "loja_nao_encontrada" });

      const { data, error } = await supabaseAdmin
        .from("produtos")
        .select(
          `id, categoria_id, tipo, nome, descricao, descricao_comercial, imagem_url, tags, preco,
           preco_promocional, disponivel, quantidade_minima, quantidade_maxima, horario_inicio,
           horario_fim, restricoes,
           ingredientes(id, nome, alergeno, ordem),
           grupos_opcoes(*, opcoes(*))`,
        )
        .eq("id", request.params.produtoId)
        .eq("empresa_id", empresa.id)
        .eq("status", "ativo")
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ error: "erro_ao_carregar_produto" });
      }
      if (!data)
        return reply.code(404).send({ error: "produto_nao_encontrado" });

      const bruto = data as any;
      const produto: ProdutoPublicoDetalhado = {
        id: bruto.id,
        categoria_id: bruto.categoria_id,
        tipo: bruto.tipo,
        nome: bruto.nome,
        descricao: bruto.descricao,
        descricao_comercial: bruto.descricao_comercial,
        imagem_url: bruto.imagem_url,
        tags: bruto.tags,
        preco: Number(bruto.preco),
        preco_promocional:
          bruto.preco_promocional != null
            ? Number(bruto.preco_promocional)
            : null,
        disponivel:
          bruto.disponivel &&
          dentroDoHorario(
            minutosAgora(),
            bruto.horario_inicio,
            bruto.horario_fim,
          ),
        quantidade_minima: bruto.quantidade_minima,
        quantidade_maxima: bruto.quantidade_maxima,
        restricoes: bruto.restricoes,
        ingredientes: [...(bruto.ingredientes ?? [])].sort(
          (a: any, b: any) => a.ordem - b.ordem,
        ),
        grupos_opcoes: [...(bruto.grupos_opcoes ?? [])]
          .sort((a: any, b: any) => a.ordem - b.ordem)
          .map((g: any) => ({
            ...g,
            opcoes: [...(g.opcoes ?? [])].sort(
              (a: any, b: any) => a.ordem - b.ordem,
            ),
          })),
      };
      return produto;
    },
  );

  // =====================================================================
  // Verificação de telefone. Cada envio é uma mensagem real de WhatsApp,
  // com custo e risco reputacional (CLAUDE.md regra 7) — por isso o limite
  // por telefone é checado no BANCO (janela de reenvio), não só no rate
  // limit em memória, que uma reinicialização zeraria.
  // =====================================================================

  app.post<{ Params: { slug: string }; Body: { telefone: string } }>(
    "/publico/:slug/verificacao",
    async (request, reply) => {
      const empresa = await resolverEmpresa(request.params.slug);
      if (!empresa)
        return reply.code(404).send({ error: "loja_nao_encontrada" });

      const telefone = normalizarTelefoneBr(request.body?.telefone ?? "");
      if (!telefone)
        return reply.code(400).send({ error: "telefone_invalido" });

      const porIp = consumirRateLimit(`verificacao:ip:${request.ip}`, 10, 600);
      if (!porIp.permitido) {
        return reply
          .code(429)
          .header("Retry-After", String(porIp.esperarSegundos))
          .send({
            error: "muitas_tentativas",
            esperar_segundos: porIp.esperarSegundos,
          });
      }

      const { data: ultima } = await supabaseAdmin
        .from("verificacoes_telefone")
        .select("criado_em")
        .eq("empresa_id", empresa.id)
        .eq("telefone", telefone)
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (ultima) {
        const desdeUltimo =
          (Date.now() - new Date(ultima.criado_em).getTime()) / 1000;
        if (desdeUltimo < INTERVALO_REENVIO_SEGUNDOS) {
          const esperar = Math.ceil(INTERVALO_REENVIO_SEGUNDOS - desdeUltimo);
          return reply
            .code(429)
            .header("Retry-After", String(esperar))
            .send({
              error: "aguarde_para_reenviar",
              esperar_segundos: esperar,
            });
        }
      }

      // Códigos anteriores deste telefone morrem agora: um pedido de código
      // novo significa que o cliente não tem mais o antigo (ou ele nunca
      // chegou), e deixar dois válidos ao mesmo tempo só amplia a janela de
      // ataque.
      await supabaseAdmin
        .from("verificacoes_telefone")
        .update({ expira_em: new Date().toISOString() })
        .eq("empresa_id", empresa.id)
        .eq("telefone", telefone)
        .is("verificado_em", null)
        .gt("expira_em", new Date().toISOString());

      const codigo = gerarCodigoVerificacao();
      const expiraEm = new Date(
        Date.now() + VALIDADE_CODIGO_MINUTOS * 60_000,
      ).toISOString();

      const { data: verificacao, error } = await supabaseAdmin
        .from("verificacoes_telefone")
        .insert({
          empresa_id: empresa.id,
          telefone,
          codigo_hash: hashSegredo(codigo),
          // Em claro só até o worker enviar — nunca vai pra `mensagens`, que
          // é o histórico que a IA lê a cada turno (decisão explícita: código
          // de acesso não é conteúdo de conversa e o modelo não tem o que
          // fazer com ele).
          codigo_envio: codigo,
          expira_em: expiraEm,
        })
        .select("id, expira_em")
        .single();

      if (error || !verificacao) {
        request.log.error(error);
        return reply.code(500).send({ error: "erro_ao_gerar_codigo" });
      }

      const resposta: VerificacaoSolicitada = {
        verificacao_id: verificacao.id,
        telefone_mascarado: mascararTelefoneBr(telefone),
        expira_em: verificacao.expira_em,
        reenviar_em_segundos: INTERVALO_REENVIO_SEGUNDOS,
      };
      return resposta;
    },
  );

  // Estado real do envio. A API não envia nada por conta própria (quem fala
  // com o WhatsApp é o worker), então "enviado" aqui só fica true quando o
  // worker gravou `enviado_em` DEPOIS da confirmação da API do WhatsApp.
  app.get<{ Params: { slug: string; verificacaoId: string } }>(
    "/publico/:slug/verificacao/:verificacaoId/status",
    async (request, reply) => {
      const empresa = await resolverEmpresa(request.params.slug);
      if (!empresa)
        return reply.code(404).send({ error: "loja_nao_encontrada" });

      const { data, error } = await supabaseAdmin
        .from("verificacoes_telefone")
        .select("enviado_em, erro_envio, expira_em, tentativas")
        .eq("id", request.params.verificacaoId)
        // Escopo por empresa mesmo numa consulta por chave primária: um id de
        // outro tenant nunca pode ser observado por aqui (CLAUDE.md regra 5).
        .eq("empresa_id", empresa.id)
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ error: "erro_ao_consultar_verificacao" });
      }
      if (!data)
        return reply.code(404).send({ error: "verificacao_nao_encontrada" });

      const status: StatusVerificacao = {
        enviado: data.enviado_em != null,
        erro_envio: data.erro_envio,
        expira_em: data.expira_em,
        tentativas_restantes: Math.max(
          0,
          MAX_TENTATIVAS_CODIGO - data.tentativas,
        ),
      };
      return status;
    },
  );

  app.post<{
    Params: { slug: string };
    Body: { verificacao_id: string; codigo: string };
  }>("/publico/:slug/verificacao/confirmar", async (request, reply) => {
    const empresa = await resolverEmpresa(request.params.slug);
    if (!empresa) return reply.code(404).send({ error: "loja_nao_encontrada" });

    const { verificacao_id, codigo } = request.body ?? ({} as any);


    if (!verificacao_id || !codigoVerificacaoValido(codigo ?? "")) {
      return reply.code(400).send({ error: "codigo_invalido" });
    }

    const porIp = consumirRateLimit(`confirmar:ip:${request.ip}`, 30, 600);

    if (!porIp.permitido) {
      return reply
        .code(429)
        .header("Retry-After", String(porIp.esperarSegundos))
        .send({
          error: "muitas_tentativas",
          esperar_segundos: porIp.esperarSegundos,
        });
    }

    const { data: verificacao, error } = await supabaseAdmin
      .from("verificacoes_telefone")
      .select("id, telefone, codigo_hash, tentativas, expira_em, verificado_em")
      .eq("id", verificacao_id)
      .eq("empresa_id", empresa.id)
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_validar_codigo" });
    }
    if (!verificacao || verificacao.verificado_em) {
      return reply.code(400).send({ error: "codigo_invalido" });
    }
    if (new Date(verificacao.expira_em).getTime() <= Date.now()) {
      return reply.code(400).send({ error: "codigo_expirado" });
    }
    if (verificacao.tentativas >= MAX_TENTATIVAS_CODIGO) {
      return reply.code(429).send({ error: "codigo_bloqueado" });
    }

    // Conta a tentativa ANTES de comparar: se a comparação (ou o processo)
    // falhar no meio, a tentativa gasta continua gasta. O contrário
    // permitiria força bruta com requests abortados de propósito.
    const { data: apos, error: tentativaError } = await supabaseAdmin
      .from("verificacoes_telefone")
      .update({ tentativas: verificacao.tentativas + 1 })
      .eq("id", verificacao.id)
      .eq("tentativas", verificacao.tentativas)
      .select("tentativas")
      .maybeSingle();

    // Update condicional vazio = outra requisição incrementou no mesmo
    // instante (duas abas, clique duplo). Recusa em vez de arriscar
    // validar sem contar a tentativa.
    if (tentativaError || !apos) {
      return reply.code(429).send({ error: "muitas_tentativas" });
    }

    if (!hashesIguais(verificacao.codigo_hash, hashSegredo(codigo.trim()))) {
      return reply.code(400).send({
        error: "codigo_incorreto",
        tentativas_restantes: Math.max(
          0,
          MAX_TENTATIVAS_CODIGO - apos.tentativas,
        ),
      });
    }

    await supabaseAdmin
      .from("verificacoes_telefone")
      // `codigo_envio` some junto: passado o uso, não há razão nenhuma pra
      // um código em claro continuar no banco.
      .update({ verificado_em: new Date().toISOString(), codigo_envio: null })
      .eq("id", verificacao.id);

    // Cliente é buscado antes de inserir (em vez de upsert) pra nunca
    // apagar o `nome` que o WhatsApp já tinha resolvido — o cadastro é o
    // MESMO do cliente que conversa por lá, essa é a razão de o telefone
    // ser a chave.
    const { data: existente } = await supabaseAdmin
      .from("clientes")
      .select("id, nome, telefone, endereco_json")
      .eq("empresa_id", empresa.id)
      .eq("telefone", verificacao.telefone)
      .maybeSingle();

    let cliente = existente;
    if (!cliente) {
      const { data: novo, error: clienteError } = await supabaseAdmin
        .from("clientes")
        .insert({ empresa_id: empresa.id, telefone: verificacao.telefone })
        .select("id, nome, telefone, endereco_json")
        .single();
      if (clienteError || !novo) {
        request.log.error(clienteError);
        return reply.code(500).send({ error: "erro_ao_identificar_cliente" });
      }
      cliente = novo;
    } else {
      await supabaseAdmin
        .from("clientes")
        .update({ ultima_interacao_em: new Date().toISOString() })
        .eq("id", cliente.id);
    }

    const { token, expiraEm } = await criarSessaoPublica(
      empresa.id,
      cliente.id,
    );

    const resposta: SessaoPublicaCriada = {
      token,
      expira_em: expiraEm,
      cliente: clientePublico(cliente),
      atendimento_id: await buscarAtendimentoAtivo(empresa.id, cliente.id),
    };
    return resposta;
  });

  // =====================================================================
  // A partir daqui, cliente identificado. `empresaId`/`clienteId` sempre da
  // sessão — nunca do corpo da requisição.
  // =====================================================================

  app.register(async (autenticadas) => {
    autenticadas.addHook("preHandler", requireSessaoPublica);

    autenticadas.get("/publico/sessao", async (request) => {
      const { empresaId, clienteId } = request.sessaoPublica!;

      const { data: cliente } = await supabaseAdmin
        .from("clientes")
        .select("id, nome, telefone, endereco_json")
        .eq("id", clienteId)
        .eq("empresa_id", empresaId)
        .single();

      const atendimentoId = await buscarAtendimentoAtivo(empresaId, clienteId);

      // Sem conversa ainda não há carrinho pra ler — devolve um resumo vazio
      // derivado da config real da empresa, em vez de 404: a página abre no
      // cardápio, não num estado de erro.
      const [carrinho, pedidoAtivo] = await Promise.all([
        atendimentoId
          ? lerCarrinho(supabaseAdmin, empresaId, atendimentoId)
          : carregarFluxoPedidoConfig(supabaseAdmin, empresaId).then((fluxo) =>
              resumoPedidoIa(pedidoVazio(), null, fluxo, null),
            ),
        atendimentoId
          ? buscarPedidoAtivo(empresaId, atendimentoId)
          : Promise.resolve(null),
      ]);

      const estado: EstadoSessaoPublica = {
        cliente: clientePublico(cliente!),
        atendimento_id: atendimentoId,
        carrinho,
        pedido_ativo: pedidoAtivo ? pedidoPublico(pedidoAtivo) : null,
      };
      return estado;
    });

    /** Nome é a única coisa que a página pede além do telefone, e só quando o
     * cadastro ainda não tem um. Nunca sobrescreve um nome existente por
     * silêncio da UI. */
    autenticadas.put<{ Body: { nome: string } }>(
      "/publico/cliente/nome",
      async (request, reply) => {
        const { empresaId, clienteId } = request.sessaoPublica!;
        const nome = (request.body?.nome ?? "").trim();
        if (!nome || nome.length > 80)
          return reply.code(400).send({ error: "nome_invalido" });

        const { data, error } = await supabaseAdmin
          .from("clientes")
          .update({ nome })
          .eq("id", clienteId)
          .eq("empresa_id", empresaId)
          .select("id, nome, telefone, endereco_json")
          .single();

        if (error || !data) {
          request.log.error(error);
          return reply.code(500).send({ error: "erro_ao_salvar_nome" });
        }
        return clientePublico(data);
      },
    );

    autenticadas.get("/publico/carrinho", async (request) => {
      const { empresaId, clienteId } = request.sessaoPublica!;
      const atendimentoId = await resolverAtendimentoParaPedido(
        empresaId,
        clienteId,
      );
      return lerCarrinho(supabaseAdmin, empresaId, atendimentoId);
    });

    autenticadas.post<{
      Body: {
        produto_id: string;
        quantidade: number;
        observacoes?: string | null;
        opcoes?: Array<{ opcao_id: string }>;
      };
    }>("/publico/carrinho/itens", async (request, reply) => {
      const { empresaId, clienteId } = request.sessaoPublica!;
      const atendimentoId = await resolverAtendimentoParaPedido(
        empresaId,
        clienteId,
      );
      return responderCarrinho(
        reply,
        await adicionarItemAoCarrinho(
          supabaseAdmin,
          empresaId,
          atendimentoId,
          request.body,
        ),
      );
    });

    autenticadas.patch<{
      Params: { linhaId: string };
      Body: { quantidade?: number; observacoes?: string | null };
    }>("/publico/carrinho/itens/:linhaId", async (request, reply) => {
      const { empresaId, clienteId } = request.sessaoPublica!;
      const atendimentoId = await resolverAtendimentoParaPedido(
        empresaId,
        clienteId,
      );
      return responderCarrinho(
        reply,
        await atualizarItemDoCarrinho(
          supabaseAdmin,
          empresaId,
          atendimentoId,
          request.params.linhaId,
          request.body,
        ),
      );
    });

    autenticadas.delete<{ Params: { linhaId: string } }>(
      "/publico/carrinho/itens/:linhaId",
      async (request, reply) => {
        const { empresaId, clienteId } = request.sessaoPublica!;
        const atendimentoId = await resolverAtendimentoParaPedido(
          empresaId,
          clienteId,
        );
        return responderCarrinho(
          reply,
          await removerItemDoCarrinho(
            supabaseAdmin,
            empresaId,
            atendimentoId,
            request.params.linhaId,
          ),
        );
      },
    );

    autenticadas.put<{
      Body: {
        tipo_entrega: TipoEntrega | null;
        endereco: EnderecoEntrega | null;
      };
    }>("/publico/carrinho/entrega", async (request, reply) => {
      const { empresaId, clienteId } = request.sessaoPublica!;
      const atendimentoId = await resolverAtendimentoParaPedido(
        empresaId,
        clienteId,
      );
      const resultado = await definirEntregaDoCarrinho(
        supabaseAdmin,
        empresaId,
        atendimentoId,
        request.body,
      );

      // Endereço confirmado pelo cliente vira o endereço salvo dele — é o
      // mesmo campo que a IA usa pra oferecer "no mesmo endereço de
      // sempre?" na próxima conversa (tarefa 0020), não um cadastro
      // separado da página pública.
      if (
        resultado.ok &&
        request.body.tipo_entrega === "entrega" &&
        request.body.endereco
      ) {
        await supabaseAdmin
          .from("clientes")
          .update({ endereco_json: request.body.endereco })
          .eq("id", clienteId)
          .eq("empresa_id", empresaId);
      }

      return responderCarrinho(reply, resultado);
    });

    autenticadas.put<{ Body: { forma_pagamento: FormaPagamento | null } }>(
      "/publico/carrinho/pagamento",
      async (request, reply) => {
        const { empresaId, clienteId } = request.sessaoPublica!;
        const atendimentoId = await resolverAtendimentoParaPedido(
          empresaId,
          clienteId,
        );
        return responderCarrinho(
          reply,
          await definirPagamentoDoCarrinho(
            supabaseAdmin,
            empresaId,
            atendimentoId,
            request.body.forma_pagamento,
          ),
        );
      },
    );

    /**
     * Revisão final — o equivalente exato do resumo que a IA manda antes de
     * perguntar "posso confirmar?". Grava `aguardando_confirmacao` com o
     * hash do carrinho ATUAL; o `POST /publico/pedido` só aceita esse mesmo
     * hash de volta. É isso que garante que o cliente confirmou o pedido que
     * ele viu, e não um que mudou no meio (outra aba, ou a IA mexendo na
     * conversa em paralelo).
     */
    autenticadas.post("/publico/pedido/revisao", async (request, reply) => {
      const { empresaId, clienteId } = request.sessaoPublica!;
      const atendimentoId = await resolverAtendimentoParaPedido(
        empresaId,
        clienteId,
      );

      const [{ pedido }, fluxoPedido] = await Promise.all([
        carregarEstadoIa(supabaseAdmin, empresaId, atendimentoId),
        carregarFluxoPedidoConfig(supabaseAdmin, empresaId),
      ]);

      if (pedido.itens.length === 0)
        return reply.code(400).send({ error: "carrinho_vazio" });

      const hash = calcularHashConfirmacao(pedido);
      const expiraEm = new Date(
        Date.now() + VALIDADE_REVISAO_MINUTOS * 60_000,
      ).toISOString();

      await mesclarEstadoIa(supabaseAdmin, empresaId, atendimentoId, {
        aguardando_confirmacao: {
          hash,
          expiraEm,
          resumoTexto: construirResumoTexto(pedido),
        },
      });

      return {
        hash,
        expira_em: expiraEm,
        subtotal: calcularSubtotal(pedido.itens),
        carrinho: await lerCarrinho(supabaseAdmin, empresaId, atendimentoId),
        fluxo_pedido: fluxoPedido,
      };
    });

    /**
     * Confirmação do pedido pelo cliente. MUTATE → READ → VALIDATE → NEXT
     * STATE (CLAUDE.md regra 9): nada aqui confia no que o navegador mandou
     * além do `hash`, que é só a prova de qual carrinho ele estava vendo.
     *
     * O pedido nasce `aberto`, exatamente como o que a IA cria: quem manda
     * pra cozinha é o humano, pelo botão "Confirmar" do Kanban, que move o
     * pedido pra `em_preparacao` e o card pra coluna "Na cozinha". A página
     * pública não pula essa etapa — a loja precisa aceitar o pedido antes de
     * começar a produzir.
     *
     * Por que NÃO há checagem de `ia_permissoes` aqui (diferente da tool
     * `criar_pedido`): aquela matriz existe pra limitar o que a IA faz
     * SOZINHA — `exige_confirmacao_humana` e `valor_maximo_sem_handoff`
     * respondem "esta ação pode acontecer sem um humano?". Neste canal a
     * resposta é sempre não: o cliente é quem monta e confirma o próprio
     * pedido, e ele fica em `aberto` esperando aceitação humana
     * independentemente do valor. Aplicar o limite de valor aqui bloquearia
     * um pedido caro que já vai passar por um humano de qualquer forma.
     */
    autenticadas.post<{ Body: { hash: string } }>(
      "/publico/pedido",
      async (request, reply) => {
        const { empresaId, clienteId } = request.sessaoPublica!;
        const atendimentoId = await resolverAtendimentoParaPedido(
          empresaId,
          clienteId,
        );

        // Um pedido já em andamento nesta conversa bloqueia qualquer segundo
        // pedido — cobre o caso que a idempotência por hash não cobre (dois
        // dispositivos, carrinhos diferentes, dois cliques).
        const emAndamento = await buscarPedidoAtivo(empresaId, atendimentoId);
        if (emAndamento) {
          return reply
            .code(409)
            .send({
              error: "pedido_ja_em_andamento",
              pedido: pedidoPublico(emAndamento),
            });
        }

        const [estado, fluxoPedido] = await Promise.all([
          carregarEstadoIa(supabaseAdmin, empresaId, atendimentoId),
          carregarFluxoPedidoConfig(supabaseAdmin, empresaId),
        ]);

        const hashAtual = calcularHashConfirmacao(estado.pedido);
        if (!request.body?.hash || request.body.hash !== hashAtual) {
          return reply.code(409).send({ error: "carrinho_mudou" });
        }

        // A confirmação passa a existir no ESTADO PERSISTIDO antes de qualquer
        // criação — o gate abaixo lê do banco, não desta requisição.
        await salvarPedidoIa(supabaseAdmin, empresaId, atendimentoId, {
          ...estado.pedido,
          carrinho_confirmado: true,
        });
        await mesclarEstadoIa(supabaseAdmin, empresaId, atendimentoId, {
          aguardando_confirmacao: estado.aguardando_confirmacao,
        });

        const relido = await carregarEstadoIa(
          supabaseAdmin,
          empresaId,
          atendimentoId,
        );
        const validacao = validarPreRequisitosDeCriacao({
          pedido: relido.pedido,
          confirmacao: relido.aguardando_confirmacao,
          ultimoPedidoCriado: relido.ultimo_pedido_criado,
          config: fluxoPedido,
        });

        if (validacao.situacao === "ja_criado") {
          const { data } = await supabaseAdmin
            .from("pedidos")
            .select("*")
            .eq("id", validacao.pedido_id)
            .eq("empresa_id", empresaId)
            .maybeSingle();
          return data
            ? { pedido: pedidoPublico(data as Pedido), idempotente: true }
            : reply.code(409).send({ error: "pedido_ja_criado" });
        }
        if (validacao.situacao === "recusado") {
          return reply
            .code(400)
            .send({
              error: validacao.motivo,
              pendencias: validacao.pendencias,
            });
        }

        const resultado = await criarPedidoComItens(supabaseAdmin, {
          empresaId,
          clienteId,
          atendimentoId,
          origem: "web_publico",
          tipoEntrega: relido.pedido.tipo_entrega!,
          enderecoJson: relido.pedido.endereco,
          // Taxa de entrega ainda não é calculada em canal nenhum (mesma
          // decisão da tool `criar_pedido`) — cobrar um valor que o catálogo
          // não define seria inventar dado comercial (CLAUDE.md regra 1).
          taxaEntrega: 0,
          formaPagamento: relido.pedido.forma_pagamento,
          observacoes: null,
          itens: relido.pedido.itens.map((item) => ({
            produto_id: item.produto_id,
            quantidade: item.quantidade,
            observacoes: item.observacoes,
            opcoes: item.opcoes.map((o) => ({ opcao_id: o.opcao_id })),
          })),
        });

        if (!resultado.ok) {
          request.log.error(resultado.erro);
          return reply.code(400).send({ error: resultado.erro });
        }

        // Evidência ANTES do reset, mesma ordem da tool `criar_pedido`: se o
        // processo morrer no meio, é melhor sobrar o ponteiro pro pedido real
        // do que perder o registro de que ele existe.
        await mesclarEstadoIa(supabaseAdmin, empresaId, atendimentoId, {
          ultimo_pedido_criado: {
            pedido_id: resultado.pedido.id,
            hash: hashAtual,
            criado_em: new Date().toISOString(),
          },
          aguardando_confirmacao: null,
        });
        await salvarPedidoIa(
          supabaseAdmin,
          empresaId,
          atendimentoId,
          pedidoVazio(),
        );

        // Traz o card pra frente do Kanban: um pedido que acabou de entrar não
        // pode ficar no fim da lista, ordenada por última mensagem.
        await supabaseAdmin
          .from("atendimentos")
          .update({ ultima_mensagem_em: new Date().toISOString() })
          .eq("id", atendimentoId)
          .eq("empresa_id", empresaId);

        return reply
          .code(201)
          .send({ pedido: pedidoPublico(resultado.pedido) });
      },
    );

    /** Acompanhamento pós-confirmação — o cliente fica na página vendo o
     * status real do pedido (o mesmo que o Kanban mostra), sem precisar
     * perguntar no WhatsApp. */
    autenticadas.get("/publico/pedido", async (request, reply) => {
      const { empresaId, clienteId } = request.sessaoPublica!;
      const atendimentoId = await buscarAtendimentoAtivo(empresaId, clienteId);
      if (!atendimentoId)
        return reply.code(404).send({ error: "pedido_nao_encontrado" });

      const pedido = await buscarPedidoAtivo(empresaId, atendimentoId);
      if (!pedido)
        return reply.code(404).send({ error: "pedido_nao_encontrado" });
      return pedidoPublico(pedido);
    });

    autenticadas.post("/publico/sessao/encerrar", async (request, reply) => {
      await supabaseAdmin
        .from("sessoes_publicas")
        .delete()
        .eq("id", request.sessaoPublica!.sessaoId);
      return reply.code(204).send();
    });
  });
}

function minutosAgora(): number {
  const [h, m] = new Date()
    .toLocaleTimeString("pt-BR", {
      hour12: false,
      timeZone: "America/Sao_Paulo",
    })
    .split(":")
    .map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Mesma janela (inclusive a que cruza a meia-noite) que
 * `montarItensComSnapshot` aplica ao aceitar o item — a vitrine não pode
 * dizer "disponível" pra algo que o backend vai recusar. */
function dentroDoHorario(
  agoraMin: number,
  inicio: string | null,
  fim: string | null,
): boolean {
  if (!inicio || !fim) return true;
  const min = (hora: string) => {
    const [h, m] = hora.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const i = min(inicio);
  const f = min(fim);
  return i <= f
    ? agoraMin >= i && agoraMin <= f
    : agoraMin >= i || agoraMin <= f;
}
