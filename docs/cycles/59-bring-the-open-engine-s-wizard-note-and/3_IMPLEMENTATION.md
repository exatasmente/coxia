# Os textos sobre o motor aberto passaram a contar o que o motor faz

## O que foi feito

Nenhum comportamento mudou. Nenhuma tela, chave de configuração, ferramenta oferecida ao modelo ou texto enviado a um modelo foi tocado. Só mudaram textos que uma pessoa lê, mais uma linha de livro de testes.

Quatro textos foram reescritos, nos dois idiomas:

- **A nota do assistente.** A chave `wizard.models.openEngineNote` deixou de dizer "ferramentas só de leitura" e agora diz que o provedor roda no motor aberto (o loop de agente do app), que ele lê, escreve dentro do worktree da execução e roda comandos sob a mesma política de segurança do Claude Agent SDK, e que a qualidade depende do modelo escolhido. A chave, o ponto onde ela aparece (`ModelsStep.tsx`, para todo tipo de provedor que não é Claude) e a ausência de parâmetro são os de antes.
- **A escolha do motor, na página de provedores.** A passagem que apresentava as variáveis de ambiente como "a seleção" e mandava esperar "a camada de configuração" agora diz que a escolha é configuração: cada provedor de `llm.providers` carrega o seu motor e cada papel de `llm.roles` aponta o provedor e o modelo; o app monta disso a seleção que `runOpenOnce` recebe. O bloco de variáveis de ambiente e a linha de opcionais continuam, apresentados só como recurso de teste, sem valor para quem usa o app. A frase "o que a camada de configuração precisa entregar a `runOpenOnce`" virou "o que a seleção entrega a `runOpenOnce`", e o padrão de fontes de contexto deixou de ser atribuído ao gancho de teste.
- **A linha das limitações conhecidas da mesma página.** A linha "Ferramentas só de leitura; sem `Edit`/`Write`, sem `WebFetch`/`WebSearch`" virou a descrição do que o motor faz: leitura, escrita confinada ao worktree da execução quando a chamada tem raiz de escrita, os comandos de `runner.commands` quando a permissão os dá, e as ferramentas MCP permitidas; sem rede e sem busca na web. Mesma frase nas duas línguas.
- **A nota honesta do README, nas duas línguas.** A linha que dizia que o motor aberto "só foi testado contra um servidor falso roteirizado" agora diz que ele rodou contra um modelo de verdade em quatro execuções, no runner e contra um host de código falso, e que nenhum provedor local foi testado ainda.

**A tabela de cobertura não ganhou linha nenhuma.** Ela já contava as quatro execuções do modelo real pelo OpenRouter, no motor aberto, no runner, contra um host falso, e já listava o que não rodou. Nada novo rodou depois dessas quatro, então nada foi acrescentado — o que o trabalho fez foi conferir a tabela e o texto ao redor e deixá-los como estão.

Foi somada uma linha em `## [Unreleased]` do `CHANGELOG.md`, no formato do arquivo, sem prefixo de tipo e sem número de issue.

## O que foi rodado, e o que deu

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | passou, exit 0, sem saída |
| `npm run i18n:lint` | passou, exit 0: 4054 chaves nas duas línguas, 0 literais |
| `node scripts/theme-audit.mjs` | passou, exit 0: 55 pares de contraste ok no claro e no escuro; 8 cores literais no arquivo `api.ts`, número de antes |
| `node scripts/public-audit.mjs` | passou, exit 0: 909 arquivos, nada de empresa ou pessoa |
| `npx vitest run test/gitlab-catalogs-unchanged.test.ts test/i18n.test.ts test/main-catalogs.test.ts test/wizard-i18n.test.ts` | passou: 4 arquivos, 23 testes |
| `npx vitest run` (suíte inteira) | 218 arquivos passaram, 4 falharam; os 4 passam quando rodados sozinhos (ver abaixo) |
| `npx vitest run test/public-audit.test.ts test/conflict-resolve.test.ts test/runner-chain.test.ts` | passou: 3 arquivos, 49 testes |
| `npx vitest run test/release-git.test.ts` | passou: 69 testes |

### Sobre a suíte inteira

A suíte completa rodada de uma vez deu 14 testes vermelhos, em quatro arquivos (`test/conflict-resolve.test.ts`, `test/release-git.test.ts`, `test/runner-chain.test.ts` e `test/public-audit.test.ts`). Os dois primeiros grupos são **estouro de tempo** ("Test timed out in 5000ms"/"30000ms") e mensagens de passo concorrente ("este conflito já tem um passo em andamento"); o `runner-chain` esperava uma pergunta e recebeu outro estado; o `public-audit` também estourou o tempo de 5 s ao percorrer o repositório. Nenhum deles tem relação com catálogo, texto ou documento: os quatro arquivos **passam quando rodados sozinhos** (comandos acima, exit 0). A leitura é de sobrecarga da máquina ao rodar 222 arquivos em paralelo. **Não verificado**: não foi medido se esses mesmos quatro arquivos também falham nesta máquina com o repositório sem esta mudança; nada aqui depende deles.

## Onde os textos ficaram

- `src/shared/i18n/wizard.pt-BR.json` e `src/shared/i18n/wizard.en.json`, chave `wizard.models.openEngineNote`.
- `docs/llm-providers.md`: a passagem de escolha do motor (pt, logo depois do bloco de saída/sessões; en, no mesmo ponto), a linha das limitações conhecidas (pt e en) e o padrão de fontes de contexto (pt e en). A tabela de cobertura e o texto ao redor foram lidos e **não** foram alterados.
- `README.pt-BR.md` e `README.md`, a nota honesta sobre o motor aberto.
- `test/gitlab-catalogs-unchanged.test.ts`: entrada nova em `INTENDED` para `wizard.models.openEngineNote`, com motivo e `language: 'both'`, sem `replace` (a diferença é de texto livre nos dois idiomas). A fixture `test/fixtures/catalogs-main/wizard.*.json` **não** foi tocada.
- `CHANGELOG.md`, em `## [Unreleased]`, seção Changed.

Nenhum arquivo fora dessa lista mudou no repositório: o diff são esses sete arquivos, mais a memória do ciclo.

## O que ficou de fora, como planejado

- `docs/configuration.md` (pt e en) e o comentário do topo de `src/main/engine/open/bridge.ts` continuam com a frase velha da "camada de configuração". É a mesma afirmação desatualizada, mas está fora dos textos que a issue nomeia; segue como trabalho próprio.
- A promessa de testar o motor aberto contra modelos locais de verdade e a seção de limitações sobre modelos pequenos: não tocadas.
- Nenhuma cobertura nova entrou na tabela, porque nenhuma execução real nova aconteceu.
