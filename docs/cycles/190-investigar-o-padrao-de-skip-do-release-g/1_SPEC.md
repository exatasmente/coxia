# Detectar e explicar o conflito de worktree antes de um passo de release falhar

## O que muda para quem usa

Ao pedir um passo de release (abrir a branch de release, mesclar um pull request nela, cortar uma beta ou estável, enviar branch ou tag), a app hoje executa o script de release do repositório e, quando o git recusa, o passo falha ou é pulado e quem conduz a releasePage:17reade descobrir depois, lendo a saída, que a branch da release estava com checkout em outro worktree. Nas releases passadas isso se repetiu dezenas de vezes no mesmo corte, porque nada no começo do passo avisava do conflito.

Com a melhoria, a app olha o próprio estado do repositório antes de rodar o passo e, se a branch de release (ou a branch que o passo precisa) já está com checkout em outro worktree do mesmo repositório, o passo não chega a falhar: ele para cedo com uma mensagem que nomeia o conflito e diz onde a branch está presa, e oferece resolver — soltar o checkout nos outros worktrees — sempre com o passo de confirmar a pessoa antes de mexer em qualquer worktree. Quem conduz a release sai do loop de "tentar, recusar, pular, tentar de novo" e resolve a causa uma vez.

As outras recusas que apareceram no padrão investigado continuam portões e continuam justos: tag já existente significa que a versão já foi cortada; [Unreleased] vazio significa que falta descrever as mudanças. O que melhora é que cada recusa chega a quem conduz com o que fazer em seguida, no lugar em que o passo para, sem exigir ler a saída crua do script.

## Regras

1. Antes de rodar qualquer passo de release que precise da branch de release mesclada, cortada ou enviada, a app verifica se essa branch está com checkout em outro worktree do mesmo repositório.
2. Se está, o passo para antes de executar qualquer mudança, com uma mensagem que diga qual branch, em qual worktree está presa e o que fazer para liberá-la; a saída crua do script de release não substitui essa mensagem.
3. Soltar o checkout do outro worktree é uma ação que confirma a pessoa antes de acontecer; a app não move nem desanexa worktrees sem esse sim.
4. Depois que a pessoa libera a branch (ou recusa), o passo pode ser repetido de imediato, sem acumular um novo registro de pulado.
5. A recusa "tag já existe" permanece: a app não re-corta uma versão já publicada; a mensagem passo a passo diz que a versão já está cortada e que nada há a repetir.
6. A recusa de [Unreleased] vazio permanece um portão de conteúdo: a app não escreve o changelog por conta própria; a mensagem diz que as mudanças precisam ser descritas primeiro.
7. Skip de passo continua possível por decisão da pessoa, com motivo registrado; o que muda é que os conflitos de ambiente acima são explicados antes de virarem recusa percebida como pulo.

## O que fica fora

- Escrever ou sugerir texto de changelog automaticamente.
- Mover, criar ou desanexar worktrees sem a confirmação da pessoa.
- Mudar a ordem dos passos de release ou os portões de confirmação de push, corte e mesclagem já definidos.
- Regeristrar os skips antigos das releases passadas ou reprocessar os feeds anteriores.
- Relatório ou painel de histórico de skips para além do registro já existente no histórico do run.

## Critérios de aceite

1. Com a branch de release com checkout em um segundo worktree do mesmo repositório, pedir um corte de release pela app: o passo para antes de falhar, e a mensagem exibida nomeia a branch e o worktree que a detém; nada da release é alterado nesse momento.
2. Na mesma situação, a pessoa confirma resolver: após a confirmação, a branch volta a estar livre em outros worktrees e o mesmo passo pode ser repetido e concluído sem novo pulado no histórico do run.
3. Com a branch livre nada muda: cada passo de release se conduz como hoje, confirmado por um corte de beta simulado em repositório de teste.
4. Recusas "tag já existe" e "[Unreleased] vazio" continuam parreando o passo, e a exibição do motivo no feed de ações mostra orientação de proximo passo na mensagem; confirmar lendo o feed após um passo que recusa por cada motivo.
5. Um skip manual de passo de release, se a pessoa o fizer, continua exigindo motivo e aparece no histórico do run com o estado e o motivo, como hoje.

## Perguntas em aberto (bloqueiam)

Nenhuma que bloqueie a especificação: o escopo decidiu-se nesta etapa (detectar e explicar o conflito de worktree; resolver com confirmação da pessoa). Se na implementação a confirmação de soltar o checkout se revelar unsafe de outra forma que não prevista (por exemplo, worktree de outro repositório ou caminho inexistente), a regra é parar e pedir, não inferir.
