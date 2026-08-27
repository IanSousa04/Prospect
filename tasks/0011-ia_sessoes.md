# `ia_sessoes` em uso (memória derivada da conversa)

**Status:** concluído (escopo reduzido — ver Resolução)
**Prioridade:** P1
**Seção no ROADMAP:** 1. Caminho crítico — confiabilidade da camada de IA (P0/P1)

`ia_sessoes` existe no schema (migration `0009_ia_fundacao.sql`) mas nunca é lida nem escrita em código. O "carrinho em construção", "último produto mencionado", "confirmação pendente com hash" (ver seção 3, desenho de fluxo de pedido) não existem de fato ainda. Item P1 porque habilita o P0 de memória completa quando o histórico cru não couber no prompt.

**Resolução (escopo reduzido, decisão explícita):** "carrinho em construção" e "confirmação pendente com hash" pertencem ao Order Context desenhado na tarefa `criar_pedido` (0017), que ainda não existe em código — implementá-los aqui, sem esse desenho, arriscaria retrabalho quando a 0017 for feita de verdade (nota deixada em 0017). Esta tarefa entregou só a infraestrutura de leitura/escrita de `ia_sessoes` e um primeiro uso real: `estado_json.ultimo_produto_mencionado`.

- `apps/ai-orchestrator/src/agent/sessao.ts`: `carregarSessao()` lê `ia_sessoes.estado_json` por `atendimento_id`; `atualizarSessaoComEvidencias()` deriva o último produto/combo mencionado das evidências reais da rodada (só quando `buscar_produtos`/`buscar_combos` retornou exatamente 1 resultado — busca ambígua não conta como "o produto que o cliente quer") e faz upsert em `ia_sessoes` (unique em `atendimento_id`, conforme schema).
- `agent/orquestrador.ts` carrega a sessão antes de investigar, passa um texto de contexto pro Investigador (só quando há produto salvo, com instrução explícita de só usar em caso de referência pronominal clara) e atualiza a sessão depois da investigação.
- `agent/investigador.ts` aceita esse contexto como parâmetro opcional (`contextoSessao`) e o injeta como mensagem de sistema adicional.
- Falha de leitura/escrita de `ia_sessoes` nunca derruba o atendimento — é memória auxiliar, não fonte de verdade (CLAUDE.md regra 1 continua garantida pela cadeia normal de evidência/fonte real).
