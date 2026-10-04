# O que entra na versão 0.5.0

Plano da versão, montado a partir do que o host mostra hoje. A branch de release já existe aqui e no remoto, então as atividades são os pull requests que apontam para ela — não um milestone nem uma etiqueta.

## O número

**0.5.0**, um minor acima do 0.4.2. Duas atividades entregam comportamento novo que a pessoa vê — cada melhoria da retro passa a virar uma proposta de abrir issue, e um agente pode ser autorizado a rodar comandos neste computador — e uma funcionalidade sobe o minor. As três correções que entram junto ficam no mesmo número.

O próximo corte da branch seria a beta.6 (a última beta é a beta.5); a versão estável é a 0.5.0.

## O que entra

Os cinco pull requests que apontam para a branch já estão integrados nela. Nenhum está aberto; nenhum carrega aprovação de revisor no head segundo o host; as verificações do host passam em quatro deles.

1. **#31 Turn each retro improvement into an issue proposal** — https://github.com/exatasmente/coxia/pull/31 — A melhoria levantada na retro deixa de ser guardada no registro e passa a ser uma proposta em Ações de abrir uma issue, com o problema de hoje, o que seria e a retro de origem; aceitar cria a issue no host e começa a tarefa nela, pular não cria nada, e sem escrita de issue a melhoria fica só na conversa, com o motivo. Fecha #16. Integrada em 2026-10-03; head `df1c2fd`; a última verificação do host nesse head está cancelada.
2. **#38 fix: never commit as the machine's global git identity** — https://github.com/exatasmente/coxia/pull/38 — Sem identidade própria configurada, o runner deixa de assinar commits com a identidade global da máquina: usa a identidade configurada ou a do próprio repositório e, sem nenhuma das duas, recusa o commit; nada escreve `git config`. Head `ab7433b`; integrada; verificações passando.
3. **#39 fix: link the release draft to its tag before checking it** — https://github.com/exatasmente/coxia/pull/39 — O rascunho de release passa a ser ligado à tag da versão antes de ser conferido, e a conferência falha quando o rascunho não aponta para a tag da versão; publicar o rascunho deixa de poder criar uma tag avulsa na main. Head `5e21259`; integrada; verificações passando.
4. **#41 fix: keep conflict verification commands in the workspace** — https://github.com/exatasmente/coxia/pull/41 — Os comandos de verificação de conflito passam da configuração compartilhada para a de cada workspace, com uma movimentação única na primeira abertura que copia cada comando para os workspaces que têm aquele repositório ou espelho e mantém à vista os comandos que nenhum workspace reivindica. Fecha #26. Head `405fb48`; integrada; verificações passando.
5. **#42 feat: run an agent's commands on this computer once the person allows each one** — https://github.com/exatasmente/coxia/pull/42 — Um quarto valor para os comandos de um agente: rodar neste computador, fora de qualquer sandbox, com cada comando esperando a pessoa permitir antes de começar (permitir uma vez, permitir até o fim da etapa, não permitir); sem resposta o comando não roda, e só o computador muda essa permissão. Head `7ed0dab`; integrada; verificações passando.

## O que será integrado

Nada. As cinco atividades já estão na branch e nenhum pull request aponta para ela em aberto; não há merge a pedir.

## O changelog

Quando a versão estável for cortada, a seção 0.5.0 do changelog reúne em um só lugar o que as betas da versão levaram e o que ainda estava em `[Unreleased]`, por tipo de mudança. Em palavras simples, ela vai dizer:

- cada melhoria da retro passa a virar uma proposta de abrir issue, com o problema de hoje, o que seria e a retro de origem; aceitar cria a issue e começa a tarefa nela, pular não cria nada;
- um agente pode rodar comandos neste computador depois que a pessoa permite cada um, com a permissão pedida antes de o comando começar e o pedido aparecendo na corrida e nas notificações;
- o runner deixa de assinar commits com a identidade global da máquina;
- o rascunho de release passa a ser ligado à tag da versão antes de ser conferido;
- os comandos de verificação de conflito passam a pertencer ao workspace;
- a configuração migra para um esquema novo, sem mudar nada por si.

Não lido nesta etapa: as seções de changelog das betas 2 a 5. O que está acima vem da seção `[Unreleased]` e da seção da beta.1 presentes na árvore de trabalho e da descrição de cada atividade.

## Fora ou em risco

- Nenhuma das cinco atividades carrega aprovação de revisor no head, segundo o host; elas foram integradas por decisão da pessoa. Para o que já está na branch isso não muda nada, mas o passo de integração da release recusa um pull request sem essa aprovação — nenhuma delas poderia ser pedida de novo.
- A última verificação do host no head de #31 está cancelada; esse head não está verde no host.
- A branch já carrega a beta.5 e está congelada para correções do que a beta mostrou; #42 é uma funcionalidade e entrou por decisão da pessoa, como a própria descrição registra.
- #42 não foi visto no app em execução, nem com modelo real, nem no Windows, pela própria descrição: o cartão de permissão e uma chamada esperando minutos pela pessoa não estão verificados.
- Uma nova beta da branch não teria entrada de changelog nova e o corte do repositório recusa changelog vazio; o que a versão ainda pode receber é a estável, depois de uma beta que o host mostre publicada.

## Como foi conferido

O estado de cada pull request — integrado, verificações, aprovação no head, branch de destino e head — foi lido do host nesta etapa. Nada foi integrado, cortado ou publicado aqui. Não verificado: o conteúdo da branch de release, a publicação da beta.5, e as seções de changelog das betas 2 a 5.
