# Triagem: dirigir o Claude Code já logado a partir do app

## Tipo

Pedido de funcionalidade (não é bug, pergunta nem duplicada). É grande: reúne cinco entregas que podem ser feitas separadas (sessões, interação, canal autônomo, fallback por orçamento, Remote Control).

## Decisão de escopo (resposta de quem abriu)

A pessoa respondeu "pode separar": as cinco partes podem ser entregues em etapas menores, sem exigir tudo num só ciclo. A ordem não foi dita; fica a sugestão abaixo.

- Sugestão de ordem (não é decisão): 4 (fallback por orçamento e nomear o modo "CLI já logado"), depois 1 e 2 (sessões e interação), depois 3 (canal autônomo), por último 5 (Remote Control, o de maior risco).
- A primeira entrega, a 4, é a mais isolada e já tem ponto de entrada no código. Esta issue pode ficar como guarda-chuva, com uma issue ou ciclo por entrega.
- A segunda pergunta (reescrever a regra de que o login de assinatura do claude.ai nunca é oferecido) não teve resposta explícita. A própria issue diz que o Coxia nunca oferece login nem toca em credenciais; segue como ponto a fechar na especificação da entrega 4, sem nova pergunta.

## Dá para entender?

Sim, como está escrita. Conferido apenas por leitura da issue e de trechos do código; nada foi executado nem reproduzido. Os critérios de aceitação são, em geral, testáveis. O que é afirmado sobre o SDK (`accountInfo()`, `rate_limit_event`, `remoteControlAtStartup`, `claude --bg`) não foi verificado aqui.

## Conferido no código (só leitura)

- `ProviderBudgetError` existe (`src/main/engine/contract.ts:62`) e é lançado em `agents.ts` e `engine/open/bridge.ts`; `runner/executor.ts:1235` o converte em `StageError('budget')` e `runner/budget.ts:29` marca o estado `out`. O ponto onde entraria o retry no fallback existe. Em `agents.ts:942` o orçamento do `claude-sdk` é detectado pelo texto da mensagem (`budgetText`), e a issue quer o evento estruturado.
- `rate_limit_event`, `accountInfo` e o `listSessions` do SDK não aparecem em `src/`. O `listSessions` achado em `engine/open/session.ts:96` é outro, do motor `open`.
- `validate.ts:58` emite o aviso "no API key configured for the anthropic provider" quando `secretRef` é vazio, exatamente o que a issue quer reescrever.
- `webPolicy.ts` tem `DESKTOP_ONLY` e várias listas de canais negados (linha 101): é o lugar do prefixo negado ao celular. A "tabela de portas" com `EXCLUDED` para a persona não foi achada em `src/`, então esse critério depende de trabalho que não vi nesta base (mesma observação da triagem da #270).
- **Conflito de política:** `types.ts:22-23` e `docs/configuration.md` (linhas 98 e 252) dizem que um login de assinatura do claude.ai nunca é oferecido. A issue pede nomear e documentar o modo "CLI do Claude Code já logado". É preciso reescrever essas frases sem prometer um login que o Coxia não oferece. A conformidade com os termos da Anthropic para apps de terceiros não foi verificada.

## O que falta

Nada que bloqueie a triagem. Para cada entrega separada, a especificação precisa fechar a redação da regra do login e confirmar a existência da tabela de portas da persona.

## Relacionadas

- #270 (sessão do Claude Code agindo no app pelas ferramentas da persona): é o sentido oposto (Claude Code chamando o Coxia); ambos dependem da porta da persona e de política de celular/auditoria. Relacionada, não duplicada.
- Nenhuma duplicada encontrada na lista de memória; o tracker não foi pesquisado.

## Sugestões (não são decisões)

- Prioridade: `priority:medium`. Atende quem já usa Claude Code, tem blocos de risco alto (Remote Control) e o fallback é o mais valioso e isolado.
- Squad: plataforma (runner, motores, config, `webPolicy.ts`, fronteira de segurança); a tela e os textos do assistente ficam com experiência na entrega das sessões.
- Riscos para o plano: nunca ler os arquivos de credencial citados; eventos só para a janela desktop, nunca `broadcast`; `test: true` recusa envio, início e fallback; escolha entre ACP e Agent SDK para o canal autônomo, com justificativa.
