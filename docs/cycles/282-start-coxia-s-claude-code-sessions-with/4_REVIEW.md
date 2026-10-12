# Revisão, rodada 3: a ponte só de leitura está implementada e segue a fronteira

## Veredito

**Aprovado**, com ressalvas abaixo. Os bloqueantes anteriores (sem código; plano desatualizado nos passos 3 e 4) foram tratados: há código, a ponte é aberta pelo processo principal pela API `./bridge`, a auditoria usa o id de `createCodeSession`, e as decisões que estavam abertas foram fixadas e registradas em 3_IMPLEMENTATION.md.

## Decisões tomadas sem plano refeito (confirmadas)

- Token = credencial OAuth do Claude Code, lida ao abrir e nunca guardada: aceito; só vai a `api.anthropic.com` (`remoteBridge.ts`).
- Só `off` e `mirror`; `control` fora: aceito, é o lado mais seguro.
- Mensagem fixa de somente leitura em vez de recusa visível (desvio do texto do critério 3): aceito, pois a página não mostra recusa própria e a entrada é descartada (`outboundOnly` + `onInboundMessage` vazio).
- Falha da ponte: a etapa roda sem ela, com linha na conversa e sem auditoria: aceito.
- `close()` ao fim da tentativa, sem arquivar; só etapas de execução abrem a ponte: aceito.

## Conferido por leitura

- `resolveRemoteControl` (`src/shared/remoteControl.ts`): persona, celular e workspace de teste levam a `off`; a execução só baixa o nível.
- `webPolicy.ts`: `remoteControl:*` negado ao navegador pareado.
- `configScope.ts` + `configModule.ts`: `config:cycle-save` recusa subir o nível a partir do celular; `config:save` recusa a persona. Modelo de ciclo não leva o campo.
- Campo próprio `EngineRequest.mirror`, não `extra`: nenhum chamador abre a ponte fora da política.
- `executor.ts`: abre antes da chamada e fecha no `finally`; `agents.ts` repassa as mensagens e encerra o turno no `result`.
- Auditoria deduplicada pelo id da sessão; erro de gravação não derruba a etapa.
- Repositório público: nada de nome, host ou número real nos trechos lidos.

## Achados (não bloqueantes)

1. `executor.ts` ~1224: se a etapa roda num motor que não é o do Claude (o motor aberto ignora `mirror`), a sessão já foi criada, auditada e anunciada como aberta, mas só mostra a mensagem de somente leitura. Convém abrir só quando o motor da chamada é o do Claude, ou dizer isso na linha da conversa.
2. `resolveRemoteControl` aceita `run`, mas nenhum chamador o preenche e a interface não oferece a escolha por execução: o critério 10 e a regra 2 ("por agente ou por execução") ficam cobertos só pela função. Está declarado como pendente; precisa de decisão da pessoa se a issue pode fechar assim.
3. A sessão espelha prompts, resultados de ferramentas e conteúdo de arquivos para a conta da própria pessoa em claude.ai. O aviso do editor fala em contornar o celular pareado; convém citar também que o conteúdo da etapa é enviado.
4. Credencial do worker (46800 s) não é renovada: etapas muito longas perdem o espelho em silêncio (cada falha de `write` só vai ao console).

## Critérios de aceite

- 2, 4, 5, 6, 7, 8 (aviso no editor do agente): atendidos por leitura do código e relato dos testes.
- 1 e 3: não verificados contra a conta real (QA manual); 3 com desvio aceito.
- 9: fora de escopo (depende da issue de sessões). 10: parcial, ver achado 2.

## Não verificado nesta revisão

Nenhum comando foi rodado (ferramenta de comando indisponível). Não verificados por mim: `tsc`, `vitest` (conjunto completo depois da correção do runs-policy), `theme-audit`, `i18n:lint`, `public-audit` e `electron-vite build`; só há o relato da implementação (tsc, 6 arquivos de teste, theme-audit, i18n:lint, public-audit passaram). Também não lidos linha a linha: renderer, catálogos, migração, testes e o resto de `docs/configuration.md`. A QA deve rodar o conjunto completo e o build antes do merge.
