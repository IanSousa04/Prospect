# Workflow transacional determinístico — LLM sem autoridade sobre estado

**Status:** concluído
**Prioridade:** P0
**Seção no ROADMAP:** 3.1 Fechar o ciclo comercial da IA (realizar pedido)
**Corrige:** [Gate de confirmação + motor de etapas (0080)](0080-gate_confirmacao_pedido_e_motor_etapas.md) (bug estrutural que travava o checkout inteiro)

## Episódios reais

**Luiza.** A IA apresentou o resumo completo (1 X-Bacon, entrega, endereço, cartão de crédito) e perguntou "Tudo certo?". A cliente respondeu "Tudo certo". O Investigador classificou a mensagem como social (`sem_investigacao: true`), o Atendente escreveu uma confirmação de boa-fé, e a verificação anti-alucinação descartou a resposta — handoff mudo, cliente sem resposta e sem pedido.

**Barbara.** A cliente informou "Entrega" e "Cartão de crédito" numa mensagem só. A IA respondeu "Entendi, entrega e pagamento com cartão de crédito..." **sem executar** `definir_tipo_entrega` nem `definir_forma_pagamento`. O estado real do pedido continuou vazio e a conversa travou pedindo de novo o que já tinha sido informado.

## Causa raiz

Duas camadas de problema, uma dentro da outra.

**A camada de baixo era um bug estrutural que matava o checkout inteiro.** `carrinho_confirmado` nunca era setado como `true` por nenhum código de produção (só por fixtures de teste); toda tool de escrita o zerava explicitamente. Como `informacoesPendentes()` empurrava a etapa `confirmar_carrinho` sempre que `!pedido.carrinho_confirmado`, as pendências **nunca** podiam chegar a ser exatamente `["confirmacao_final"]` com itens no carrinho. Em cascata: `consultar_carrinho` nunca gravava `aguardando_confirmacao`; `criarPedidoDisponivel()` era sempre `false`, então `criar_pedido` nunca era exposta ao LLM **e** o gate determinístico da tarefa 0080 nunca disparava; e a tool, se chamada, sempre respondia `pedido_incompleto`. Nenhum pedido podia ser fechado pela IA, por nenhum caminho.

**A camada de cima é o que transformava esse bloqueio em alucinação.** Sem saída legítima, a LLM verbalizava o que não conseguia executar. E ela tinha autoridade demais pra isso:

1. **Escolhia se chamava tool de escrita** (`rodarFerramentas`) — se não chamasse, nada mutava (episódio Barbara).
2. **`sem_investigacao: true` desligava a pipeline inteira** — todas as redes de segurança fazem early-return nesse flag (episódio Luiza).
3. **Classificava intenção sobre texto isolado** — `confirmaResumoPendente` era lista fechada, sem "tudo certo", "perfeito", "isso", "pode finalizar".
4. **Compunha afirmação transacional livre**, com uma única barreira de regex pós-fato cujo desfecho era handoff mudo.
5. **Nada relia o estado depois de mutar** — a etapa seguinte era decidida sobre o retorno que a própria tool montou em memória.
6. **Não havia idempotência** — duas confirmações podiam virar dois pedidos reais.
7. **`criarHandoff` retornava `void`** — nada no sistema provava que um handoff tinha acontecido.

## Resolução

A inversão de autoridade: **a LLM interpreta linguagem e redige texto; o workflow decide, o backend executa, o banco confirma.**

- **Máquina de estados derivada** (`EstadoCheckout`, `derivarEstadoCheckout`, `packages/shared/src/pedido-ia.ts`): `sem_carrinho → montando_carrinho → dados_completos → aguardando_confirmacao → pedido_criado`. É **derivada** do estado persistido, nunca um campo à parte — é isso que garante que IA, API e UI enxerguem sempre a mesma etapa (CLAUDE.md regra 8) e que uma edição humana do carrinho recalcule a etapa sozinha. `confirmacao_recebida`/`handoff_realizado` da especificação são resultados de transição dentro de um turno (`ResultadoTransicao`), não estados persistidos.
- **A etapa morta `confirmar_carrinho` foi removida** (decisão do usuário): o resumo final passa a ser a única confirmação antes da ação irreversível, e `carrinho_confirmado` deixa de ser pendência pra virar o **registro persistido de que o workflow validou uma confirmação real** — exatamente o que `criar_pedido` agora exige como prova.
- **Extração de intenção dependente de estado** (`agent/checkout/intencao.ts`): uma chamada de LLM que só ROTULA (`{confirmacao, tipo_entrega, forma_pagamento, endereco, quer_alterar_carrinho, quer_cancelar}`), recebendo a etapa atual, o que falta e **a última pergunta que o sistema fez**. O mesmo "tudo certo" é confirmação transacional em `aguardando_confirmacao` e conversa social fora dele — a intenção depende da máquina de estados, não do texto. Confirmações e negações curtas têm atalho determinístico (`confirmaResumoPendente`/`negaResumoPendente`, ampliadas), que nem gasta chamada de LLM. Todo valor fora do domínio (ou fora do que a empresa oferece) é normalizado pra `null`.
- **Mutações obrigatórias, nunca opcionais** (`decidirMutacoes` + `aplicarIntencao`, `agent/checkout/transicoes.ts`): dado identificado vira mutação executada, sempre, na ordem fixa entrega → endereço → pagamento. Depois de mutar, o estado é **relido do banco** e validado antes de qualquer avanço de etapa (MUTATE → READ → VALIDATE → NEXT STATE). Endereço incompleto nunca é gravado — vira um fato ("falta rua/número/bairro/cidade") pra IA pedir o que falta.
- **A LLM perdeu o acesso às tools transacionais** (`ToolDefinicao.somenteWorkflow`, `tools/registry.ts`): `definir_tipo_entrega`, `definir_endereco_entrega`, `definir_forma_pagamento` e `criar_pedido` não aparecem mais em `getToolDefinitionsForLlm` — continuam registradas, permissionadas (`isPermitido`) e auditadas (`ia_execucoes`), só muda quem pode ser o chamador. Generaliza o filtro que a 0080 fazia à mão só pra `criar_pedido`. As tools de ITEM continuam com o Investigador (dependem de resolver produto no catálogo real).
- **`consultar_carrinho` virou leitura pura**: gravar `aguardando_confirmacao` era efeito colateral de uma consulta, ou seja, um estado transacional que só nascia se o modelo resolvesse chamar. Virou etapa explícita do workflow (`sincronizarConfirmacaoPendente`), que roda em todo turno.
- **`sem_investigacao` não burla mais o checkout** (`investigar(..., permitirSemInvestigacao)`): num estado transacional o flag é forçado a `false` — nenhuma mensagem é "só social" enquanto existe pedido em andamento.
- **`criar_pedido` com validação de backend e idempotência** (`validarPreRequisitosDeCriacao`, `agent/checkout/validacao-criacao.ts` — função pura, para que o gabarito exercite a regra real e não uma cópia): idempotência por `ultimo_pedido_criado.hash` primeiro, depois completude, depois `carrinho_confirmado` persistido, depois hash/expiração do resumo. `ultimo_pedido_criado` (`ia_sessoes.estado_json`) é gravado **antes** do reset do carrinho: é a evidência que sobrevive ao reset e a chave de idempotência.
- **`FatosVerificados`** (`agent/checkout/fatos.ts`): o Atendente só recebe fatos derivados do estado relido, cada um com `fonte_tool_execucao_id` de uma execução real. Sem evidência, o fato simplesmente não é afirmado.
- **TransactionTruthGate** (`agent/checkout/truth-gate.ts`): camada 1 regex determinística (ampliada com a linguagem natural real — "já está com a gente", "já mandei", "já foi", "já está na cozinha"); camada 2 classificador semântico por LLM, rodando só na janela de risco (`pedido_id === null` e checkout transacional). Reprovar **não vira silêncio**: regenera com instrução de correção explícita e, se ainda insistir, usa uma mensagem determinística montada dos fatos. O handoff mudo desse caminho acabou.
- **Handoff verificável**: `criarHandoff` devolve o `handoff_id` real; afirmar transferência sem ele é bloqueado pelo truth gate. Cancelamento de pedido já criado (sem tool, tasks/0058) vira handoff estruturado em vez de resposta improvisada.
- **Cancelamento é sempre falso** (`afirmaCancelamentoRealizado`): a IA não tem nenhuma ferramenta de cancelamento, então não existe evidência que torne "cancelei seu pedido" verdadeiro — o truth gate bloqueia essa afirmação em qualquer estado, sem depender de `pedido_id`. Dizer honestamente que não consegue cancelar (ou oferecer passar pra equipe) continua passando.
- **Log de invariantes** (`agent/checkout/invariantes.ts`, migration `0020_ia_invariantes.sql`, append-only com RLS): os 8 eventos da especificação, com prefixo `[invariante]` nos logs do processo e linha em `ia_invariantes`.
- **Prompts atualizados** (Investigador e Atendente): bloco explícito "você não é a fonte da verdade do sistema" e, no Investigador, regras 10/11 reescritas — ele não decide mais entrega/pagamento/confirmação e nunca afirma que registrou ou criou nada. Defesa complementar; a proteção real está no código.
- **UI companheira** (CLAUDE.md regra 8): `resumoPedidoIa` passa a expor `estado_checkout` e `ultimo_pedido_criado`, e o painel "Carrinho (IA)" mostra a etapa do checkout e o ponteiro do pedido criado. `ultimo_pedido_criado` é evidência de um fato, não estado editável — o pedido real continua sendo gerenciado no card "Pedido". A API lê os três campos da sessão numa query só (`carregarEstadoIa`).

## Testes

- **`eval/checkout-deterministicos.ts`** — 39 casos novos, sem banco e sem LLM, rodando a máquina de estados inteira por injeção de dependência (`PortasDoWorkflow`). Cobre os 7 cenários exigidos (Luiza, Barbara, confirmação incompleta, falha de ferramenta, confirmação falsa, "tudo certo" fora do checkout, confirmação repetida) mais os 5 estados, `decidirMutacoes`, normalização de intenção, validação de backend, sincronização de resumo e a regex ampliada. Gabarito determinístico: **139/139**.
- **`eval/casos-e2e-checkout.ts`** — runner multi-turno com mensagens **roteirizadas** (não geradas por persona, pra ser reprodutível) que roda Luiza, Barbara e a confirmação repetida contra Supabase e DeepSeek reais e depois confere o banco: existe pedido? um só? com entrega, endereço e pagamento? alguma invariante disparou?
- **Personas novas** (`eval/personas/definicoes.ts`): `confirma_com_tudo_certo` e `responde_entrega_e_pagamento_juntos`, reproduzindo os dois episódios com um cliente simulado por LLM.
- **`npm run -w apps/ai-orchestrator eval:rapido`** — runner novo só dos casos determinísticos: grátis, instantâneo, sem rede.

## Achados durante a implementação (não escondidos)

- **Falso positivo real da regex ampliada**: "Seu pedido ainda **não** foi fechado" casava com o padrão `pedido ... fechado` e era descartada como alucinação — justamente a frase correta quando não há pedido. Resolvido com uma guarda de negação (`alegacaoNegada`, `agent/verificacao.ts`) que olha o trecho casado mais ~20 caracteres antes dele, e não a frase inteira: "seu pedido foi confirmado, não se preocupe" continua sendo tratado como afirmação. Dois casos de regressão cobrem os dois lados.
- **Caminho residual encontrado na varredura final**: uma mensagem que abre o pedido já trazendo os dados ("quero um X-Bacon, pra entrega, no pix") não passava por lugar nenhum — antes da investigação não havia carrinho (o ramo transacional não rodava) e as tools de slot já não eram chamáveis pelo Investigador. Resolvido com uma segunda passada de intenção depois da investigação, quando o carrinho passou a ter itens. Ela nunca pode criar pedido (não existia resumo pendente antes do turno), só preenche os slots — o resumo é apresentado e a confirmação vem no turno seguinte.
- **Falso positivo em `contemProdutoNaoVerificado`**: a resposta legítima "você quer *entrega* ou *retirada*?" era descartada inteira porque "retirada" não batia com nenhum nome de produto do cardápio — `PALAVRAS_ENFASE_NAO_PRODUTO` tinha "entrega" mas não "retirada", nem o vocabulário de pagamento. A lista foi ampliada com os termos de checkout.
- **Validação pós-mutação estava fraca demais na primeira versão**: checava só "o campo não está nulo", então um `definir_tipo_entrega("entrega")` que falhasse em silêncio sobre um pedido que já era "retirada" passaria despercebido — o campo estaria preenchido, com o valor errado. Agora `mutacaoTeveEfeito` compara o estado relido com o valor que a mutação pretendia gravar. Dois casos de regressão cobrem os dois modos de falha.
- **Código removido por ter ficado inalcançável**: `criarPedidoDisponivel` e as três redes de segurança que reagiam a evidência de `criar_pedido` na investigação (`sintetizarAfirmacaoDePedidoCriado`, `sintetizarAfirmacaoDePedidoIncompleto`, `sintetizarAfirmacaoDeConfirmacaoExpirada`), junto dos 3 testes de loop das tools de slot. Com `criar_pedido` e as tools de slot fora do alcance do LLM, esses fatos passam a chegar ao Atendente pelo caminho determinístico (`fatosParaAfirmacoes`), com evidência real. Manter as duas rotas seria manter duas verdades paralelas.

## Achado de configuração do tenant (não é bug de código)

A primeira rodada do gabarito ponta a ponta revelou que a empresa de teste **nunca teve linha em `ia_permissoes` para `definir_endereco_entrega` nem para `definir_forma_pagamento`** — ou seja, as duas estão negadas por padrão (CLAUDE.md regra 2: ausência de permissão = negado). Isso é uma **segunda razão independente** pela qual o checkout não fechava em produção, somada ao bug estrutural do `carrinho_confirmado`: mesmo com o código correto, a IA não consegue registrar endereço nem forma de pagamento sem essas permissões liberadas em **Configurações da IA → Permissões**.

Duas correções de código saíram desse achado:

- **Ferramenta negada no meio do checkout agora vira handoff estruturado** (`origem: "acao_sem_permissao"`, `agent/orquestrador.ts`). Antes, a falha virava um fato vago ("esta loja não autorizou essa ação automática") e o Atendente preenchia a lacuna inventando qual seria a lista de formas de pagamento aceitas — uma violação da regra 1 flagrada na transcrição do gabarito. A IA estruturalmente impedida de concluir o pedido precisa escalar, não improvisar.
- **`permissoesFaltantesDoCheckout`** (`eval/casos-e2e-checkout.ts`): os cenários de checkout agora checam as permissões antes de rodar e, se faltar alguma, falham com a mensagem exata do que liberar — em vez de reportarem "nenhum pedido foi criado" e mandarem procurar um bug de código que não existe.

## Pendências deliberadas

- A **migration `0020_ia_invariantes.sql` precisa ser aplicada no SQL Editor do Supabase** — enquanto não for, `registrarInvariante` só escreve no log do processo (a falha do insert é registrada e nunca derruba a resposta ao cliente).
- Confirmação bem-sucedida **não** gera handoff (decisão do usuário): a evidência persistida de que o pedido chegou à operação é a própria linha em `pedidos`, já visível no Kanban. Handoff continua obrigatório e verificado por `handoff_id` nos caminhos de falha, risco e cancelamento.
- `cancelar_pedido` e `alterar_item` (tasks 0057/0058) continuam não implementadas. O padrão de tool de escrita conduzida pelo workflow (`somenteWorkflow` + `decidirMutacoes` + validação pura) fica documentado para ser reaproduzido quando existirem.
