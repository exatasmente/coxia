# Memória do ciclo

## Decisões

- Resposta de quem abriu: "pode separar". As cinco partes podem ser entregues em etapas menores; esta issue serve de guarda-chuva.
- Ordem sugerida (não decidida): 4, depois 1 e 2, depois 3, por último 5.
- Resposta: pode separar <!-- answer:12 -->

## Restrições

- Nunca ler `~/.claude/.credentials.json`, `sessions/*.key`, `daemon/control.key`; nada de `~/.claude` em testes.
- Eventos só para a janela desktop (nunca `broadcast`); canais negados ao celular em `webPolicy.ts`; `test: true` recusa envio, início e fallback.
- Sem login oferecido pelo app: reescrever a regra em `types.ts:22-23` e `docs/configuration.md` (98, 252) sem prometer isso.

## Tentado e descartado

- Nada.

## Perguntas abertas

- Redação final da regra do login (sem resposta explícita; fechar na especificação).
- A "tabela de portas" com `EXCLUDED` da persona não foi achada em `src/`.
- Afirmações sobre o SDK (`accountInfo`, `rate_limit_event`, `remoteControlAtStartup`, `claude --bg`) não verificadas.

## Onde o trabalho está

- Triagem concluída (só leitura). Relacionada: #270. Sugestões: priority:medium, squad plataforma. Próxima: especificação da entrega 4.
