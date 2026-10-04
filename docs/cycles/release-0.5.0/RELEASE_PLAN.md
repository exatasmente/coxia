# O que entra na versão 0.5.0

Plano da versão, montado a partir do que o serviço de código mostra. A branch de release já existe aqui e no remoto, então as atividades da versão são os pedidos de integração que apontam para ela — não um milestone nem uma etiqueta.

## O número

**0.5.0**, um minor acima do 0.4.2. Duas atividades entregam comportamento novo que a pessoa vê — cada melhoria da retro passa a virar uma proposta de abrir issue, e um agente pode ser autorizado a rodar comandos neste computador — e uma funcionalidade sobe o minor. As quatro correções que entram junto ficam no mesmo número.

A última beta da linha é a 0.5.0-beta.5; o próximo corte da branch seria a **0.5.0-beta.6**.

## O que entra

Seis atividades apontam para a branch e todas já estão integradas nela; nenhum pedido de integração está aberto. Nenhuma das seis carrega aprovação de revisor no commit atual, segundo o serviço de código.

1. **#31 Turn each retro improvement into an issue proposal** — https://github.com/exatasmente/coxia/pull/31 — A melhoria levantada na retro deixa de ser guardada no registro e passa a ser uma proposta, em Ações, de abrir uma issue, com o problema de hoje, o que seria e a retro de origem; aceitar cria a issue no serviço e começa a tarefa nela, pular não cria nada, e sem escrita de issue a melhoria fica só na conversa, com o motivo. Fecha #16. Integrada em 2026-10-03 (beta.2); head `df1c2fd`; a verificação do serviço nesse head está cancelada.
2. **#38 fix: never commit as the machine's global git identity** — https://github.com/exatasmente/coxia/pull/38 — Sem identidade própria configurada, o executor deixa de assinar commits com a identidade global da máquina: usa a identidade configurada ou a do próprio repositório e, sem nenhuma das duas, recusa o commit; nada escreve a configuração do git. Head `ab7433b`; integrada; verificações passando.
3. **#39 fix: link the release draft to its tag before checking it** — https://github.com/exatasmente/coxia/pull/39 — O rascunho de release passa a ser ligado à tag da versão antes de ser conferido, e a conferência falha quando o rascunho não aponta para a tag da versão; publicar o rascunho deixa de poder criar uma tag avulsa. Head `5e21259`; integrada; verificações passando.
4. **#41 fix: keep conflict verification commands in the workspace** — https://github.com/exatasmente/coxia/pull/41 — Os comandos de verificação de conflito passam da configuração compartilhada para a de cada workspace, com uma movimentação única na primeira abertura que copia cada comando para os workspaces que têm aquele repositório ou espelho e mantém à vista os comandos que nenhum workspace reivindica. Fecha #26. Head `405fb48`; integrada; verificações passando.
5. **#42 feat: run an agent's commands on this computer once the person allows each one** — https://github.com/exatasmente/coxia/pull/42 — Um quarto valor para os comandos de um agente: rodar neste computador, fora de qualquer sandbox, com cada comando esperando a pessoa permitir antes de começar (permitir uma vez, permitir até o fim da etapa, não permitir); sem resposta o comando não roda, e só o computador muda essa permissão. Head `7ed0dab`; integrada; verificações passando.
6. **#44 fix: keep the release flow when the flow editor saves** — https://github.com/exatasmente/coxia/pull/44 — Salvar no editor de fluxo deixou de apagar o fluxo de uma execução de release e as etapas do Release manager; o fluxo, que o editor não mostra, fica como está, e *Iniciar uma release* volta a funcionar. Head `9cc6afc`; integrada na branch depois da beta.5; verificações passando.

## O que será integrado

Nada. As seis atividades já estão na branch e nenhum pedido de integração aponta para ela em aberto; não há merge a pedir. Além disso, o passo de integração da release recusa uma atividade sem aprovação de revisor no commit atual, e nenhuma das seis tem essa aprovação — nenhuma delas poderia ser pedida de novo.

## O corte seguinte

A branch carrega, depois da última beta, a atividade #44. O corte da versão estável recusa uma branch com commit posterior à última beta — um commit que ninguém experimentou — então falta uma beta antes da estável.

O próximo corte da branch é a **0.5.0-beta.6**, a última beta da linha, que leva o que a beta.5 não levava (a #44) e a linha de changelog que ela deixou em `[Unreleased]`. Depois de essa beta existir e o serviço mostrá-la publicada, sem nada travando, vem a estável **0.5.0**.

## O changelog

A seção 0.5.0 do changelog reúne em um só lugar o que as betas da versão levaram e o que ainda está em `[Unreleased]`, por tipo de mudança. Em palavras simples, ela vai dizer:

- cada melhoria da retro passa a virar uma proposta de abrir issue, com o problema de hoje, o que seria e a retro de origem; aceitar cria a issue e começa a tarefa nela, pular não cria nada;
- um agente pode rodar comandos neste computador depois que a pessoa permite cada um, com o pedido aparecendo antes de o comando começar;
- o executor deixa de assinar commits com a identidade global da máquina;
- o rascunho de release passa a ser ligado à tag da versão antes de ser conferido;
- os comandos de verificação de conflito passam a pertencer ao workspace;
- salvar no editor de fluxo deixa de apagar o fluxo da release e as etapas do seu agente.

Não lidas nesta etapa: as seções de changelog das betas 2 a 5. O que está acima vem da descrição de cada atividade, lida no serviço de código, e da seção `[Unreleased]` da cópia da árvore de trabalho.

## Fora ou em risco

- Nenhuma das seis atividades carrega aprovação de revisor no commit atual, segundo o serviço de código; a #44 foi integrada assim mesmo, na branch, pela decisão da pessoa. Para o que já está na branch isso não muda nada, mas o passo de integração da release recusa uma atividade sem essa aprovação — nenhuma delas poderia ser pedida de novo.
- A verificação do serviço no head de #31 está cancelada; esse head não está verde no serviço.
- A estável só sai depois de uma beta que o serviço mostre publicada e sem issue aberta travando; a publicação da beta.5 não foi observada aqui, nem há como conferi-la nesta etapa.
- A #42 não foi vista no app em execução, nem com modelo real, nem no Windows, pela própria descrição: o cartão de permissão e uma chamada esperando minutos pela pessoa não estão verificados.
- A #44 também não foi vista no app em execução, pela própria descrição.
- A branch já carregava a beta.5 e estava congelada para correções do que a beta mostrou; a #42, uma funcionalidade, entrou por decisão da pessoa, como a própria descrição registra.

## Como foi conferido

O estado de cada atividade — integrada, verificações, aprovação no commit atual, branch de destino e head — foi lido no serviço de código nesta etapa. Nada foi integrado, cortado ou publicado aqui. Não verificado: o conteúdo da branch de release, a publicação da beta.5 e as seções de changelog das betas 2 a 5.
