# Revisão: um leitor de uma execução lê só dentro da pasta de trabalho dela

## O que foi revisado

A entrega foi lida contra a especificação, o plano e a fronteira de segurança. O que a mudança promete: um agente que só lê numa execução — etapa de leitura, menção na conversa da execução e pergunta da cadeia — passa a ter `Read`, `Grep` e `Glob` presos à pasta de trabalho da execução, com as mesmas regras de recusa do agente que escreve, a recusa dita na conversa e marcada como bloqueada na atividade, sem afrouxar o filtro de segredo, a censura do resultado de busca nem a recusa de busca ampla, e sem mudar o agente que escreve.

Foram conferidos por leitura: o campo próprio (`read`/`readRoot`), a montagem dos hooks, o ponto onde a raiz é ligada nos três caminhos de leitura, a recusa relatada, o texto de catálogo e os testes.

## O que está certo

- O campo é próprio e não abre nada: `Edit`, `Write` e o shell continuam decididos só por `confine`, e um leitor confinado segue sem `Bash`. Para um leitor num espaço de trabalho com host de código, a ferramenta de shell fica desligada; a decisão não foi alterada.
- Os hooks do leitor **somam** em vez de substituir: o filtro de segredo e o guarda de caminho ficam os dois em `Read|Grep|Glob`, a recusa de busca ampla em `Grep|Glob` e a censura do resultado de busca segue no `PostToolUse`. A ordem com que já valiam foi mantida.
- A raiz de leitura é ligada nas três chamadas pedidas (etapa de leitura, cadeia de perguntas com pasta de trabalho existente, menção numa conversa de execução), e as chamadas de fora (canal, conversa geral, cerimônia, contato entre squads) ficam como estavam, como a resposta de escopo fixou.
- A guarda de caminho cobre absoluto fora, `..`, `~`, link que leva para fora, link que não leva a lugar nenhum, `.git` e arquivo de segredo; uma pasta de documentação dada como raiz extra é alcançável e uma irmã não é.
- A recusa do guarda cita o alvo, e a mensagem do motor aberto cita o caminho e as pastas permitidas. O texto novo do catálogo entrou no registro de mudanças intencionais do teste de catálogos congelados.

## O que precisa mudar (bloqueia)

**1. A recusa de leitura de um agente que escreve deixou de aparecer na conversa.** No agente que escreve, a guarda de leitura passou a ser montada sem repassar o retorno de recusa; antes, a recusa de leitura chamava o mesmo relato que as outras e virava a linha na conversa da execução. A atividade ao vivo continua marcando a chamada como bloqueada, mas a linha com o agente, a ferramenta, o alvo e o motivo se perdeu para quem só lê. A mudança não podia alterar o comportamento do agente que escreve, e a conversa da execução é a superfície onde a pessoa vê o que o agente tentou. O defeito não é pego por teste: o teste do agente que escreve afirma só o texto da recusa, não o relato.

**2. Uma menção numa conversa de execução ainda pode ler fora da pasta de trabalho.** Quando o agente nomeado não roda comandos, a chamada da menção fica com a pasta de projetos como diretório de trabalho, enquanto a raiz do guarda é a pasta de trabalho da execução. Como o guarda julga o caminho escrito contra a raiz e o motor resolve o mesmo caminho contra o diretório de trabalho, um caminho relativo é aprovado pelo guarda (que o vê dentro da pasta de trabalho) e lido de outro lugar (o diretório de trabalho, fora dela). No motor aberto isso apenas recusa demais; no motor do Claude Agent SDK, que é o alvo da issue, a leitura acontece fora da pasta de trabalho com a aprovação do guarda. Enquanto a origem da menção e a raiz do guarda não forem a mesma pasta, a promessa da issue não se sustenta nesse caminho.

## Abaixo disso (não bloqueia)

- Nenhum teste exercita o motor do Claude Agent SDK de verdade com um agente leitor: o que existe passa pelos motores falsos e pelo motor aberto, que compartilham a mesma guarda e os mesmos hooks. O risco é contido porque os dois motores usam os mesmos retornos de hook e o mesmo ponto escolhe a guarda, mas o caminho que a issue nomeia não foi observado.

## O que foi conferido por execução

- `npx tsc --noEmit`: sem erro.
- Os testes da guarda de leitura, do agente leitor no motor aberto, das menções e dos catálogos: verdes.
- `theme-audit`, `i18n:lint` (4054 chaves nos dois idiomas) e `public-audit` (910 arquivos): verdes.
- A suíte completa terminou com 32 falhas em 9 arquivos, todas estouro de tempo limite de teste (5s, 30s e 60s), nenhuma nos arquivos tocados pela mudança; uma delas se reproduz igualmente na árvore sem a mudança. O computador estava com carga muito alta no momento.

## O que não foi verificado

- Nenhum modelo real, nenhuma rede e nenhum host de código foram exercitados; o comportamento do Claude Agent SDK de verdade com um agente leitor confinado não foi observado.
- O gate de versão de Node do projeto não é executável nesta máquina; os demais comandos rodaram com o Node disponível.
