# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade, entendível como escrito (só lido). Sugestão priority:medium; squad plataforma.
- Refino: 1_SPEC.md escrito (16 regras, 12 critérios). Prioridade proposta priority:medium; sem marco.

## Restrições

- Opt-in, desligado por padrão, só desktop; nunca ler credenciais de ~/.claude; negado ao celular pareado (webPolicy.ts); persona em EXCLUDED; workspace test:true recusa enviar/iniciar; nada de ~/.claude em testes.
- Eventos só à janela do desktop, nunca por broadcast.

## Tentado e descartado

- Nada.

## Perguntas abertas

- Fonte das sessões em execução/bg sem abrir chaves; API do SDK instalado (não verificada: node_modules ausente no worktree); nomes da chave de config e do tipo de auditoria; divisão do ciclo de vida com #282.

## Onde o trabalho está

- Triagem (0_TRIAGE.md) e spec (1_SPEC.md) prontas. Relacionadas: #262 (mãe, entrega 3 fica lá), #274 (entregue), #282 (vizinha), #281.
- webPolicy.ts nega canais por regex de prefixo (lista na linha ~120, ex.: /^screen:/); o novo prefixo entra ali. doorTable.ts tem EXCLUDED (linha ~280). Lido, não executado.
- Próxima etapa: plano.
- Passagem support → product-owner: Refino: confirmar a fonte das sessões em execução/em segundo plano sem tocar nas chaves, checar a API do SDK instalado, achar onde entra o prefixo negado em webPolicy.ts e alinhar com #262 e #282. <!-- handoff:11 -->
