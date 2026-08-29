# Nada sai sem lastro — pipeline determinístico de ponta a ponta

**Status:** concluído
**Prioridade:** P0
**Seção no ROADMAP:** 3.1 Fechar o ciclo comercial da IA (realizar pedido)
**Continua:** [Workflow transacional determinístico (0081)](0081-workflow_deterministico_checkout.md)

## Episódio real

Conversa completa reconstruída dos logs de `ia_execucoes` e `ia_decisoes`, já com a tarefa 0081 no ar:

| Turno | Cliente | Ferramentas | Fatos verificados recebidos | Resposta da IA |
|---|---|---|---|---|
| 17:32 | "Oi" | 0 | — | ok |
| 17:35 | "Quero uma pizza" | 3 | **"A busca não encontrou nenhum produto correspondente"** | "A gente tem várias opções no cardápio" |
| 17:37 | "Quais opções têm?" | 4 | os 3 produtos reais | ok |
| 17:40 | "X bacon" | 3 | preço, descrição e adicionais reais | correta — mas **`adicionar_ao_carrinho` nunca foi chamada** |
| 17:41 | "É para entrega" | **0** | **nenhum** | "no momento a gente não tá fazendo entregas" |
| 17:42 | "Sim" | **0** | nenhum (`sem_investigacao=true`) | recitou R$ 32,90 do histórico → descartada → handoff mudo |

`ia_sessoes.estado_json` terminou com apenas `ultimo_produto_mencionado` — **nenhum carrinho**. A loja oferece entrega (`fluxo_pedido_json.tipos_entrega_oferecidos: ["entrega","retirada"]`), e nenhuma ferramenta sobre entrega chegou a rodar naquele turno: a restrição foi inventada do nada.

## Causa raiz

**A 0081 tirou da LLM a autoridade sobre o estado transacional, mas deixou uma porta aberta: `adicionar_ao_carrinho` continuou sendo decisão do modelo**, porque adicionar item exige resolver produto no catálogo. Era o elo mais frágil, e foi por ele que tudo quebrou — sem item no carrinho, `derivarEstadoCheckout` devolve `sem_carrinho`, que não é transacional, e **todo o pipeline da 0081 ficou inerte a conversa inteira**: máquina de estados, extração de intenção, mutações obrigatórias e TransactionTruthGate nunca ligaram.

Com o pipeline desligado, quatro lacunas ficaram expostas:

1. **O Atendente escreve livremente quando não recebe fato nenhum.** Nos turnos 17:41 e 17:42 ele redigiu com `afirmacoes = []`. As verificações existentes cobriam valor em R$, produto em negrito, promessa de PDF, código de pedido e afirmação transacional — **nenhuma cobria afirmação de regra de negócio** ("não entregamos", "não aceitamos X").
2. **O Atendente contradiz o fato que recebeu.** Em 17:35 o único fato era "não encontrou nenhum produto" e a resposta afirmou o oposto.
3. **`sem_investigacao` continuava sendo decisão do modelo** fora do checkout — e o checkout nunca começava.
4. **Nenhuma obrigação de consultar antes de afirmar.** Responder sobre entrega, horário ou pagamento sem ter chamado ferramenta nenhuma era um caminho perfeitamente válido.

## Resolução

Inversão do default do Atendente: ele deixa de poder escrever tudo que não está proibido (uma lista de proibições que crescia a cada bug) e passa a só poder afirmar o que está no conjunto de fatos verificados. O usuário autorizou explicitamente gastar mais tokens por isso.

Pipeline obrigatório, em toda mensagem, sem atalho:

```
1. INTERPRETAR         (LLM, sempre)   intenção universal — itens, slots, confirmação, ASSUNTOS perguntados
2. RESOLVER ITENS      (código)        cada item citado → busca real → adicionar_ao_carrinho
3. MUTAR SLOTS         (código)        entrega/endereço/pagamento/confirmação        [0081]
4. ROTEAR PERGUNTAS    (código)        cada assunto rotulado → ferramenta fixa obrigatória
5. RELER + VALIDAR     (código)        banco é a fonte da verdade                    [0081]
6. MONTAR FATOS        (código)        carrinho + configuração + resultados, inclusive os vazios
7. REDIGIR             (LLM)           só os fatos
8. GATE DE LASTRO      (LLM + código)  toda afirmação de negócio precisa estar ancorada
```

- **Interpretador universal** (`agent/interpretacao/mensagem.ts`, generaliza o extrator da 0081): roda em toda mensagem e devolve `itens: ItemMencionado[]`, os campos de checkout, o sinal de confirmação e `perguntas: AssuntoPerguntado[]`. **`social` é derivado em código** (`ehSocial`) — só é verdadeiro quando não há item, dado, confirmação nem pergunta. É o que substitui `sem_investigacao`, **removido de `RelatorioInvestigacao`**: era um campo que o próprio LLM preenchia e que, marcado, fazia early-return em todas as redes de segurança e devolvia confiança "alta" com zero afirmações.
- **Resolução determinística de itens** (`agent/interpretacao/itens.ts`): o modelo só diz o que o cliente citou; o código busca no catálogo real e age — match único executa `adicionar_ao_carrinho`, zero resultados vira o fato negativo "não existe X no cardápio", vários viram esclarecimento com os nomes reais. Adicionais citados passam por `buscar_adicionais` e só entram se existirem. Reaproveita a busca por palavra de [tools/catalogo.ts](../apps/ai-orchestrator/src/tools/catalogo.ts) que resolve "x bacon" → "X-Bacon".
- **Roteamento de perguntas** (`agent/interpretacao/roteamento.ts`): `TOOLS_POR_ASSUNTO` mapeia cada assunto a ferramentas fixas, executadas pelo código. Nenhuma pergunta de negócio é respondida sem execução real por trás. Duas decisões que valem nota: `area_entrega` consulta `consultar_regiao` **e** `consultar_taxa`, porque a empresa real cadastrou a área na categoria `entrega` e `consultar_regiao` só olha `regiao`; e `opcoes_atendimento` consulta **só** a configuração, para não trazer de volta o texto livre que hoje a contradiz.
- **Ferramenta `consultar_opcoes_atendimento`** (`tools/operacao.ts`, migration `0021`): devolve tipos de entrega e formas de pagamento de `ctx.fluxoPedido`. Existe como ferramenta — e não como fato montado do contexto — para que a configuração vire **evidência real com linha em `ia_execucoes`**. É a fonte da verdade sobre disponibilidade (decisão do usuário): a base de conhecimento pode detalhar raio, taxa e regras, mas nunca contradizê-la. É o fato que torna "não fazemos entrega" impossível de afirmar numa loja que faz. Liberada por padrão na migration (linha real em `ia_permissoes`, revogável pelo dono) porque só lê a configuração que a própria empresa preencheu.
- **Gate de lastro** (`agent/lastro.ts`): duas camadas. A determinística detecta **contradição** — se um fato diz que X não existe e o texto fala de X numa frase afirmativa, bloqueia sem gastar LLM (é o caso da pizza). A semântica faz **uma** chamada de LLM para a mensagem inteira, recebendo texto e fatos, e devolve as frases sem lastro. Só afirmações sobre o negócio entram na checagem: cortesia, tom, perguntas e admissão de lacuna passam livres. Reprovar nunca vira silêncio — regenera citando as frases exatas e, no limite, usa a mensagem determinística.
- **Investigador aditivo**: `investigar()` recebe as evidências das etapas 2 e 4 como semente e só busca o que ficou de fora. A garantia deixou de depender dele.
- **Prompt do Atendente invertido**: a lista de fatos passa a ser descrita como a única coisa que ele pode afirmar, com instrução explícita de admitir a lacuna quando o assunto não estiver coberta (decisão do usuário) em vez de preenchê-la.
- **Três invariantes novos** (`business_claim_without_evidence`, `claim_contradicts_evidence`, `question_without_tool_call`) na migration `0021`.

## Testes

- **`eval/mundo-falso.ts`** — o mundo falso saiu de `checkout-deterministicos.ts` para um módulo compartilhado e ganhou catálogo (três produtos, nenhuma pizza — igual ao da empresa real), adicionais, ferramentas de operação e conhecimento configurável por categoria. Continua sem reimplementar regra de negócio: `criar_pedido` chama `validarPreRequisitosDeCriacao`, a mesma função pura da tool real.
- **`eval/pipeline-deterministicos.ts`** — 18 casos novos, com a conversa real turno a turno: "quero uma pizza" vira fato negativo e a afirmação contrária é bloqueada sem LLM; "x bacon" monta o carrinho pelo código e a máquina de estados liga; "é para entrega" executa a mutação e traz a configuração como fato; "Sim" nunca é social. Mais `social` derivado em código (inclusive tentando forçá-lo pela saída do modelo), resolução de itens nos três desfechos, adicional inexistente, roteamento por assunto e as quatro situações do gate de lastro.
- **`eval/casos-e2e-checkout.ts`** — a conversa dos 8 turnos entra como caso roteirizado ponta a ponta, conferindo no banco que `adicionar_ao_carrinho` e `consultar_opcoes_atendimento` rodaram, que o pedido nasceu completo e que nenhum invariante de afirmação sem lastro precisou disparar.
- Gabarito determinístico: **157/157**.

## Custo assumido

Por turno o sistema passa de 2–4 chamadas de LLM para 4–6 (interpretador + investigador + redator + auditor de lastro, mais uma regeneração quando o gate reprova). Confirmações e negações curtas continuam com atalho determinístico e não gastam a chamada do interpretador. O debounce de rajada já espera 8s antes de responder, então a latência extra cabe.

## Limite honesto

Nenhuma estrutura impede o modelo de **gerar** uma frase falsa. O que esta garante é que a frase falsa não é **entregável**: bloqueada, regenerada com o motivo, e no limite substituída por texto montado em código. A garantia fica na fronteira de envio, não na de geração.

## Pendências deliberadas

- Migrations `0020_ia_invariantes.sql` e `0021_lastro_e_opcoes_atendimento.sql` precisam ser aplicadas no SQL Editor do Supabase.
- As permissões `definir_endereco_entrega` e `definir_forma_pagamento` continuam sem linha em `ia_permissoes` na empresa de teste — sem elas o checkout não fecha, e o gabarito E2E falha com essa mensagem exata.
- O item "Formas de pagamento aceitas" da base de conhecimento ainda contradiz a configuração (diz que não aceita dinheiro; a config aceita). O roteamento já responde esse assunto pela config, mas o texto continua aparecendo em `buscar_conhecimento` até ser corrigido.
