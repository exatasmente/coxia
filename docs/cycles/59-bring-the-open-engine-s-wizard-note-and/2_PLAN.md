# O que os textos dizem sobre o motor aberto volta a bater com o motor

## Como a mudança é feita

Nada de comportamento muda: nenhuma tela nova, nenhuma configuração nova, nenhuma ferramenta oferecida ao modelo. O que muda é texto que uma pessoa lê, em quatro lugares: a nota que o assistente mostra ao lado do formulário de um provedor que não é Claude (nos dois catálogos), a passagem da página de provedores que explica como o motor é escolhido (nas duas línguas), a linha das limitações conhecidas da mesma página — que hoje ainda afirma que as ferramentas são só de leitura — e a nota honesta do README, em inglês e em português, que ainda diz que o motor aberto só foi testado contra um servidor falso.

A nota do assistente passa a dizer o que o motor aberto é e o que ele faz. A passagem de escolha passa a descrever a escolha que existe: o provedor cadastrado carrega o motor, o papel aponta provedor e modelo, e as variáveis de ambiente ficam só como recurso de teste. A linha das limitações deixa de repetir a frase velha e diz o que é verdade: as leituras, a escrita confinada ao worktree do run e os comandos de `runner.commands`; sem rede e sem busca na web; a escrita só para o agente com a permissão de worktree. A tabela de cobertura não ganha cobertura nova — ela já conta o modelo real e o que não rodou; o trabalho só confirma isso e diz no comentário que nada novo rodou. O README alinha-se à tabela.

## O que muda, por área

| Área | O que muda |
|---|---|
| Assistente de configuração | A nota ao lado do formulário de um provedor de motor aberto deixa de dizer que as ferramentas são só de leitura e passa a dizer que é o loop de agente do próprio app, que lê, escreve dentro do worktree do run e executa comandos sob a mesma política de segurança do Claude, e que a qualidade depende do modelo. Mesmo lugar, mesmos provedores. |
| Documentação de provedores | A passagem que hoje apresenta as variáveis de ambiente como a seleção, com a camada de configuração no futuro, passa a descrever a escolha que existe (provedor → motor; papel → provedor e modelo) e deixa o gancho de ambiente como recurso de teste, sem valor para quem usa o app. |
| Documentação de provedores | A linha das limitações conhecidas que diz que as ferramentas são só de leitura passa a descrever o motor aberto como ele é (leituras, escrita confinada ao worktree do run, comandos da lista; sem rede) — sem prometer o que não foi testado. |
| Documentação de provedores | A tabela de cobertura e o texto ao redor continuam a contar o que já contam: um modelo real pelo OpenRouter, no motor aberto, só no runner, contra um host falso, em quatro execuções, e o que não rodou. Nada novo é apresentado como testado. |
| README (as duas línguas) | As notas honestas deixam de dizer que o motor aberto só foi testado contra um servidor falso e contam o mesmo que a tabela. |

O que não muda para quem usa: o mesmo app, as mesmas telas, os mesmos comandos, o mesmo resultado dos testes, nenhuma configuração nova.

## Decisões de desenho

### 1. A nota do assistente

`wizard.models.openEngineNote`, nos dois catálogos (`src/shared/i18n/wizard.en.json` e `wizard.pt-BR.json`), chave mantida, sem parâmetro novo (a atual não tem nenhum; o teste de paridade exige os mesmos marcadores nos dois idiomas). Continua sendo mostrada em `ModelsStep.tsx` para todo tipo de provedor que não é Claude — nenhuma linha do componente muda.

Texto proposto:

- pt-BR: `Este provedor roda no motor aberto (o loop de agente do Coxia): ele lê, escreve dentro do worktree da execução e roda comandos sob a mesma política de segurança do Claude Agent SDK. A qualidade depende do modelo escolhido.`
- en: `This provider runs on the open engine (Coxia's own agent loop): it reads, writes inside the run's worktree and runs commands under the same safety policy as the Claude Agent SDK. Quality depends on the model you pick.`

A nota continua curta (duas frases) e não cita nome de arquivo, função ou ferramenta. A segunda frase de hoje — a qualidade depender do modelo — permanece, na forma acima.

A cópia congelada `test/fixtures/catalogs-main/wizard.*.json` **não** acompanha a mudança: é o texto do `main`, e o teste de catálogos exige que a diferença esteja na lista `INTENDED`, com motivo (abaixo).

### 2. A escolha do motor na página de provedores

Em `docs/llm-providers.md`, na seção "Contrato do motor aberto" (linhas ~27–39 no português e ~131–143 no inglês):

- A frase "Por enquanto a seleção é um gancho de teste (variáveis de ambiente). A camada de configuração vai trocar `openEngineFromEnv()` pela escolha provedor → motor:" vira uma passagem que apresenta a escolha que existe: cada provedor cadastrado em `llm.providers` tem o seu motor e cada papel de `llm.roles` aponta o provedor e o modelo; a seleção que o motor aberto recebe é montada disso (chave do provedor, o que o teste de conexão aprendeu, o formato da saída estruturada, as fontes de contexto).
- O bloco de variáveis de ambiente continua (o gancho existe no código), mas apresentado **só** como recurso de teste, sem valor para quem usa o app, com uma frase dizendo que ele força o motor aberto contra o servidor que as variáveis nomeiam, qualquer que seja a configuração.
- "O que a camada de configuração precisa entregar a `runOpenOnce`" vira "o que a seleção entrega a `runOpenOnce`" (o nome do contrato `OpenEngineSelection` e a lista de campos ficam como estão, que são verdadeiros).
- "Padrão do gancho de teste (`defaultDocSources`)" vira a descrição de que, sem fontes configuradas, o app usa o preenchimento padrão daquele mesmo lugar (a segunda frase, com os caminhos, já está certa).
- As duas linhas seguem nas duas línguas, com o mesmo sentido.

Fora deste trabalho, conforme a especificação: a mesma frase velha em `docs/configuration.md` (linhas ~131 e ~279) e o comentário do topo de `src/main/engine/open/bridge.ts` (linha 3). O plano os alcança? Não; ficam registrados como trabalho próprio em "Próximos passos".

### 3. A linha das limitações conhecidas da mesma página

- pt-BR (linha ~101): `- Ferramentas só de leitura; sem Edit/Write, sem WebFetch/WebSearch.` → `- Ferramentas: leitura (Read, Grep, Glob), escrita confinada ao worktree da execução (Write, Edit) quando a chamada tem raiz de escrita, os comandos listados em runner.commands quando a permissão os dá, mais as ferramentas MCP permitidas. Sem rede e sem busca na web (WebFetch, WebSearch).`
- en (linha ~205): a mesma coisa em inglês.

Esta linha não é citada pela issue, mas é a mesma afirmação que o pedido principal manda corrigir ("the open engine is the app's own agent loop, it reads, writes in the worktree and runs commands…"), e hoje contradiz a tabela e o próprio motor; o motivo vai escrito no comentário da etapa.

### 4. A tabela de cobertura e o README

A tabela e o texto de `docs/llm-providers.md` (linhas ~82–95 e ~186–199) **já contam** as quatro execuções com o modelo real (DeepSeek v4.1 flash pelo OpenRouter, no motor aberto, no runner, contra um host falso com memória) e já listam o que não rodou. Não achei, no `CHANGELOG.md` nem em `docs/runner.md`, registro de execução com modelo real depois dessas quatro, e a pessoa confirmou que não houve. Portanto: nenhuma execução nova entra na tabela; ela passa a contar certo o que já rodou, e o comentário da etapa diz que nada novo rodou.

O que sobra é a nota honesta do README nas duas línguas:

- `README.pt-BR.md`, linha ~110: a linha `- **O motor aberto só foi testado contra um servidor falso roteirizado**, ainda não contra um Ollama ou modelo hospedado de verdade. Conte o que encontrar.` vira `- **O motor aberto rodou contra um modelo de verdade em quatro execuções**, no runner e contra um host de código falso; nenhum provedor local (Ollama, LM Studio) foi testado ainda. Conte o que encontrar.`
- `README.md`, linha ~110: a mesma coisa em inglês.

A frase do bloco de status do README ("parts are verified only against test servers") e o ponto 6 do `CONTRIBUTING.md` ("This project would rather admit that something only ran against a fake server…") **não** são alcançados: o primeiro é sobre o app como um todo e continua verdadeiro, o segundo é a regra de estilo do próprio projeto, não uma afirmação sobre o motor aberto.

### 5. O que não pode aparecer

- Sem número de issue, nome de pessoa, host real ou segredo: os textos são sobre motores e provedores genéricos ("um provedor", "um servidor OpenAI", "um host de código falso"), como já é o resto da página.
- Nada de comportamento muda: nenhuma chave de configuração, nenhum padrão, nenhuma ferramenta oferecida ao modelo, nenhum texto enviado a um modelo.
- Nenhum texto literal novo em código: o texto novo vive só nos catálogos e nos documentos (o lint de i18n cobre `src/renderer/src`, `src/main` e `src/shared` e não lê `docs/` nem o `README`).

## Arquivos

**Textos de interface (duas línguas)**

- `src/shared/i18n/wizard.en.json` (linha 118: `wizard.models.openEngineNote`).
- `src/shared/i18n/wizard.pt-BR.json` (linha 118: a mesma chave).

**Documentação**

- `docs/llm-providers.md`: a passagem de escolha de motor (pt ~27–39, en ~131–143), a linha das limitações conhecidas (pt ~101, en ~205). A tabela e o texto ao redor já estão certos; conferir e não mexer.
- `README.md` (linha ~110) e `README.pt-BR.md` (linha ~110): a nota honesta sobre o motor aberto.
- Sem tradução para pt-BR de `docs/llm-providers.md` em arquivo separado: as duas línguas vivem no mesmo arquivo.

**Testes**

- `test/gitlab-catalogs-unchanged.test.ts`: entrada nova em `INTENDED`, com motivo, para `wizard.models.openEngineNote` (a chave muda nos dois idiomas; uma entrada só cobre os dois e a ausência de `replace` faz o teste conferir só a língua). Motivo proposto: `the open engine writes in the run's worktree and runs commands, so the wizard note no longer says read-only`. Nenhuma linha da fixture `test/fixtures/catalogs-main/wizard.*.json` é tocada.
- `test/i18n.test.ts`: nada a mudar; passa a comparar o texto novo nos dois idiomas e os mesmos marcadores.
- `test/main-catalogs.test.ts`: os testes de paridade continuam valendo. Só convém, no caso de a chave que passa a descrever o motor aberto perder o sentido (por exemplo `main.engine.noOpenEngine`, que hoje diz "este computador não tem o motor aberto; o servidor local dele talvez não esteja instalado na versão pública" e fica esquisito para um provedor cadastrado), trocar o texto dessa chave em `src/shared/i18n/main.en.json` e `main.pt-BR.json`, mantendo o mesmo sentido nas duas. É opcional dentro deste plano.
- `test/wizard-i18n.test.ts`: nada a mudar (a chave da nota é usada em `ModelsStep.tsx` e tem par nos dois catálogos).
- Como entrar: `npx vitest run test/gitlab-catalogs-unchanged.test.ts`, `npx vitest run test/i18n.test.ts`, `npx vitest run test/main-catalogs.test.ts`, `npx vitest run test/wizard-i18n.test.ts`.

**Registro de quem usa**

- `CHANGELOG.md`, em `## [Unreleased]`: uma linha visível, no formato do arquivo (negrito no começo, comportamento e depois a consequência), sem prefixo de tipo nem número de issue. Sugestão: `- **The documentation of the open engine says what it does.** The wizard note no longer calls the open engine read-only: it now says the engine reads, writes inside the run's worktree and runs commands under the same safety policy as the Claude Agent SDK. The model provider page explains that the provider and the role in the configuration choose the engine, keeps the environment variables as a test aid, and stops saying the open engine was only tested against a fake server.`

## O que o commit não faz

O commit é do app e leva só estes arquivos. Nenhuma linha de `src/main`, `src/renderer` ou `src/shared` fora dos dois catálogos de assistente: se aparecer uma, é defeito, não parte do plano.

## Testes

Nada foi rodado nesta etapa; os testes abaixo são o que a implementação deve rodar e conferir.

1. **A nota, nos dois idiomas** (`test/wizard-i18n.test.ts`, que já existe): a chave está nos dois catálogos, com os mesmos marcadores, e o lint de chaves segue verde. Um teste novo pequeno pode fixar o sentido: o texto não contém "read-only" nem "só de leitura" e contém as três afirmações (loop do próprio app; lê, escreve no worktree do run e roda comandos sob a mesma política; a qualidade depende do modelo).
2. **O catálogo congelado** (`test/gitlab-catalogs-unchanged.test.ts`): a diferença da chave está em `INTENDED` com motivo; `render every key of main as main did` fica verde; a fixture continua byte a byte como está.
3. **Paridade das duas línguas** (`test/i18n.test.ts`): mesmas chaves e mesmos marcadores depois da troca.
4. **Nenhum texto literal novo** (`npm run i18n:lint` e `npx vitest run test/i18n.test.ts`): zero no renderer, no main e no compartilhado.
5. **Documentação**: uma verificação simples de que as frases velhas não sobraram — "camada de configuração vai trocar" e "por enquanto a seleção" não aparecem em `docs/llm-providers.md`, e "read-only tools; no `Edit`/`Write`" e "só de leitura; sem `Edit`/`Write`" não aparecem na mesma página; a tabela continua listando o modelo real e o que não rodou.
6. **README**: as duas línguas perdem a frase de "só o servidor falso" e dizem o mesmo que a tabela.
7. **Nada de comportamento**: `npx vitest run` inteiro passa como passa hoje, e o diff só tem os arquivos deste plano (`git status`/`git diff --stat` conferidos antes do commit).
8. **Auditoria pública** (`node scripts/public-audit.mjs`): os textos novos não citam número de issue, pessoa, host nem segredo.

## Riscos

| Risco | Como é contido |
|---|---|
| O teste do catálogo congelado ficar vermelho | A chave entra em `INTENDED`, com motivo, e a fixture não é tocada. A entrada só pode ficar lá se a diferença realmente existir — é o próprio teste que confere. |
| O corpo da nota dizer mais do que o motor faz | As três afirmações são as que o código mostra: `buildTools` (leitura, escrita com raiz, `Bash` da lista, MCP), `confine`/`writeRoot` (a raiz de escrita vem da permissão de worktree), e o limite de rede, que já está escrito na mesma página. Sem citar ferramenta, arquivo ou função. |
| A passagem de escolha virar uma promessa nova | Ela descreve só o que existe: provedor com motor, papel com provedor e modelo, `engineFor` e a seleção montada do config; o gancho de ambiente fica dito como auxílio de teste, que é onde ele vive. |
| A tabela ganhar cobertura inventada | Nada é acrescentado; a tabela já conta as quatro execuções e as não-execuções. O comentário da etapa diz que nada novo rodou, e nenhum texto apresenta execução não registrada. |
| O README passar a prometer demais | A linha do README só repete o que a tabela conta (um modelo real, quatro execuções, no runner, host falso) e continua dizendo que nada local foi testado. |
| O lint de i18n cair por um texto literal | Nenhum literal novo entra em `src/renderer/src`, `src/main` ou `src/shared`; o que muda são valores de catálogo e documentos, que o lint não lê. |
| O escopo crescer sem controle | Ficam fora, por decisão da especificação: `docs/configuration.md`, o comentário do `bridge.ts`, a promessa de testar modelos locais e a seção de limitações sobre modelos pequenos. Nada deles é tocado. |

## Rollback

Reverter o commit devolve os textos de hoje. Não há estado, configuração, migração nem ferramenta envolvidos: o pior que acontece é uma chave de catálogo voltar ao texto anterior, com a linha correspondente na lista `INTENDED` do teste de catálogos tendo de sair junto.

## Próximos passos (fora deste plano)

- A mesma frase velha sobre a camada de configuração em `docs/configuration.md` (pt e en) e no comentário do topo de `src/main/engine/open/bridge.ts` — linha de trabalho própria, a decidir por quem aceitar a especificação.
- A promessa de testar o motor aberto contra modelos locais de verdade e publicar quais funcionam (roadmap do README).
- A seção de limitações conhecidas sobre modelos pequenos erraram argumentos: não foi conferida nesta etapa e não é tocada.
- Se algum dia uma execução real nova acontecer, a tabela de cobertura e a nota do README são o lugar de contá-la — com o registro que a justifique.

## Verificação (o que fica para o próximo passo)

Nada foi executado nesta etapa: nenhum comando, nenhuma tela, nenhum teste. Tudo o que está acima foi conferido por leitura do código, dos catálogos, dos documentos e dos testes. A implementação roda e reporta os comandos do `CLAUDE.md` do repositório: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`.
