# Revisão: discussões de uma MR abertas por projeto e número

Veredito: **changes** (3 bloqueantes). Revisão por leitura do diff contra a spec e o plano; nenhum comando foi rodado nesta etapa e a tela não foi aberta. Os resultados de tsc, vitest, i18n:lint, theme-audit e public-audit vêm do relato da implementação e **não foram verificados aqui**.

## O que está bom (lido)
- Alcance único em `mrOutOfReach` (estrito, três recusas com motivo, dois idiomas), aplicado antes de qualquer leitura do host em `openDiscussions`, em `explainDiscussion` sem card e nas duas ferramentas de botão.
- `parseTarget` só aceita o par projeto+número inteiro e só para `discussions`; a URL aceita só dígitos.
- Sem card a tela não oferece responder nem resolver; nada é escrito no host.
- Teto de quatro botões e repetição preservados (a chave inclui o par).
- CHANGELOG em Unreleased presente; chaves nos dois catálogos; sem dados reais no diff.

## Bloqueantes
1. **Critério 4 / regra 16: falta a linha de sistema no thread** dizendo o que foi aberto (projeto e número). A implementação declara não ter feito.
2. **Critério 14: o voltar leva à home**, não à conversa de onde a tela veio. Declarado como não feito.
3. **Critério 5 / regra 18: em conversa de execução o botão do outro agente nunca aparece.** `OpenDiscussions` é oferecida a todo agente não persona, mas os botões só são desenhados em `ChatThread` (conversa da persona, não compacta); o thread de execução não os mostra. O modelo recebe "botão adicionado" e a pessoa não vê nada. Ou se mostra o alvo/aviso no thread de execução, ou a ferramenta não deve ser oferecida ali.

## Sugestões
- Regra 4/Q5: o escopo da execução não estreia a lista; está declarado e Q5 é da pessoa, registrar a decisão.
- Faltam testes de: fiação em `answer.ts` (mensagem de outro agente leva `buttons` só quando ofereceu), `AgentBubble` com botões, roteamento do `App` por projeto+número e o comportamento de `Discussions` sem card (lê a cada abertura, sem job).
- `PROJECT` aceita `..` (ex.: `../..`); a lista estrita do workspace barra, mas endurecer o formato é barato.
- `electron-vite build` e a tela no app seguem não verificados; a QA deve exercitá-los.
