# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, entendível sem perguntas. Squad proposto: plataforma. Prioridade sugerida: medium (só sugestão).

## Restrições

- Nada de `~/.claude` (ids de sessão, transcrições) em testes ou fixtures.
- Ferramentas, porta, parada e auditoria da persona não mudam.
- Motor `open` mantém o comportamento atual, salvo equivalente barato.

## Tentado e descartado

- Nada.

## Perguntas abertas

- Nenhuma para quem abriu. Ao plano: onde guardar o id da sessão por conversa, como detectar sessão não retomável e cair em nova sem erro, limite de contexto.

## Onde o trabalho está

- Triagem pronta (0_TRIAGE.md), só por leitura. `resume` já existe no contrato do motor (`engine/contract.ts`) e é usado nas cerimônias em `agents.ts`; a chamada da persona (`persona/*`, `mentions/answer.ts`) não foi localizada com certeza. Relacionadas: #262, #275.
