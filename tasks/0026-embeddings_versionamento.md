# Embeddings/versionamento de conhecimento

**Status:** pendente
**Prioridade:** P2
**Seção no ROADMAP:** 3. Camada de IA — MVP 2 e além

Adiado conscientemente (ver comentários em `0009_ia_fundacao.sql`); busca hoje é só `tsvector`. Processo alvo, inspirado no Eddy: dados da empresa → processamento → extração semântica → embeddings → índice → nova versão → validação → publicação, com cada ingestion run registrando data/duração/origem/itens criados-alterados-removidos/embeddings gerados/tokens/custos/erros/status.
