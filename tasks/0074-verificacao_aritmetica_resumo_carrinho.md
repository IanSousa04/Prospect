# Correções de handoff silencioso encontradas pela simulação de personas (rodada 2)

**Status:** concluído
**Prioridade:** P2
**Seção no ROADMAP:** 1. Caminho crítico — confiabilidade da camada de IA (P0/P1)

Duas correções na IA de atendimento, achadas rodando `npm run -w apps/ai-orchestrator simular-conversas` (ver `tasks/0073-simulacao_personas_atendimento.md`) depois das tarefas 0022/0023.

## 1. Filtrar (em vez de vetar tudo) afirmação comercial especulativa sem fonte

`apps/ai-orchestrator/src/agent/confianca.ts`'s veto `afirmacoesComerciaisSemFonte` — quando o Investigador compõe um resumo/subtotal especulativo sem ter chamado `consultar_carrinho`/`adicionar_ao_carrinho` de verdade nesta rodada — derrubava a RODADA INTEIRA pra confiança baixa → handoff silencioso, mesmo quando outras afirmações da mesma rodada eram reais e verificadas (episódio real: personas "confuso"/"simpático").

**Implementado:** `apps/ai-orchestrator/src/agent/investigador.ts` — nova função `filtrarAfirmacoesComerciaisSemFonte()`, encadeada em `gerarRelatorio()` logo antes do backstop de ambiguidade (`garantirAmbiguidadeQuandoSemFatoNemSinal`, tarefa 0073). Descarta só a(s) afirmação(ões) sem fonte, mantendo as verificadas — cumpre a mesma regra 1 do CLAUDE.md sem jogar fora informação real junto; se depois de filtrar não sobrar nada, o backstop assume e vira `pedir_esclarecimento`, nunca mais handoff mudo por causa disso. Reforço no prompt do Investigador (regra 12, `montarPromptInvestigador`): nunca relatar subtotal sem ter chamado a ferramenta de carrinho correspondente nesta mesma rodada.

## 2. Cegueira aritmética em `contemValorNaoVerificado`

Achado ao investigar uma aparente regressão da correção acima: `apps/ai-orchestrator/src/agent/verificacao.ts`'s `contemValorNaoVerificado` comparava cada valor "R$ X,XX" do texto final do Atendente contra números LITERAIS crus na evidência desta rodada — nunca reconhecia que a soma de dois valores reais (ex.: X-Bacon R$ 32,90 + adicional de ovo R$ 4,00 = R$ 36,90) também é verificável, mesmo os dois valores de origem sendo reais e desta rodada. Isso disparava o handoff silencioso pré-existente de verificação anti-alucinação (`orquestrador.ts`) em qualquer pergunta do tipo "quanto fica se eu adicionar X" antes do cliente confirmar adicionar ao carrinho de verdade (que geraria um total pronto via `consultar_carrinho`).

**Implementado:** `contemValorNaoVerificado` agora aceita um valor citado se ele bater sozinho OU como soma de até 3 valores numéricos reais encontrados na evidência bruta desta rodada (`valoresConhecidosComSomas`) — continua vetando qualquer valor sem base real nenhuma (testado explicitamente: um valor muito acima de qualquer combinação real continua bloqueado).

## Verificação

- 2 novos casos determinísticos no gabarito pra `filtrarAfirmacoesComerciaisSemFonte` (mais um encadeado com o backstop de ambiguidade) e 2 pra `contemValorNaoVerificado` com soma. Gabarito completo: 89/89.
- Rodadas repetidas de `npm run -w apps/ai-orchestrator simular-conversas` confirmaram que os dois padrões específicos (subtotal especulativo sem tool, soma de produto+adicional bloqueada por engano) não aparecem mais nas transcrições — a variância restante entre rodadas é ruído normal de LLM (crítica de qualidade conversacional do LLM-juiz em cenários como "apressado"/"nervoso"), não mais handoff silencioso por essas duas causas.
