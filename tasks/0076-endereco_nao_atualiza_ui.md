# Bug: endereço não atualiza na UI quando o cliente informa pelo WhatsApp

**Status:** concluído — [Atendimento.tsx](../apps/web/src/pages/Atendimento.tsx) agora guarda o último endereço sincronizado num `useRef` (`ultimoEnderecoSincronizado`) e só bloqueia a sobrescrita quando o form diverge dele de verdade (edição humana real em andamento); antes, qualquer valor no form — mesmo vindo da própria IA — travava updates futuros.
**Prioridade:** P1
**Seção no ROADMAP:** 3.1 Fechar o ciclo comercial da IA (realizar pedido)

## Sintoma

Quando o cliente informa/corrige o endereço de entrega pelo WhatsApp e a IA registra isso via `definir_endereco_entrega` (`apps/ai-orchestrator/src/tools/carrinho.ts`), o painel de carrinho da IA no atendimento (`apps/web/src/pages/Atendimento.tsx`, tarefa 0063 — CLAUDE.md regra 8) não reflete o endereço novo. O humano vê o endereço desatualizado mesmo com dado novo já salvo em `ia_sessoes.estado_json.pedido.endereco`.

## Causa raiz (já localizada)

Em [Atendimento.tsx:313-318](../apps/web/src/pages/Atendimento.tsx), a função `carregar()` só copia `c.endereco` (o endereço vindo do carrinho da IA) para o form local `enderecoForm` quando o form está **totalmente vazio**:

```ts
setEnderecoForm((atual) =>
  atual.rua || atual.numero || atual.bairro || atual.cidade ? atual : c.endereco ?? atual,
);
```

A intenção original era boa (nunca sobrescrever o que o humano está digitando no meio de uma edição), mas a condição trata "form já tem QUALQUER valor" como sinônimo de "humano está editando agora" — inclusive quando esse valor só está ali porque foi carregado de uma sincronização anterior com a própria IA. Resultado: assim que o endereço é preenchido uma primeira vez, nenhuma atualização posterior da IA (ex.: cliente corrige o número ou o bairro) chega a aparecer no painel, porque o guard nunca deixa `c.endereco` sobrescrever de novo.

## O que fazer

Diferenciar "o form tem valor porque veio do estado sincronizado" de "o humano está editando agora de verdade" — por exemplo, guardando o último endereço vindo do backend (`ultimoEnderecoSincronizado`) e só preservando o form local se ele divergir desse valor (ou seja, o humano alterou algo depois da última sincronização). Cobrir com teste manual: IA define endereço → painel atualiza; humano começa a editar um campo → nova atualização da IA não apaga a edição em andamento; humano termina de editar/salva → sincroniza normalmente na próxima.
