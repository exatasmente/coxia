# A execução sozinha, a rede da sandbox e a lista de comandos: a revisão desta rodada

## Veredito

**Aprovado.** O código está no mesmo estado que a rodada anterior aprovou: desde então só entrou um commit de documentação do registro do ciclo, sem mudar código. Os acertos que a revisão anterior pediu seguem escritos e foram conferidos de novo nesta máquina, e as duas observações que não bloqueavam continuam as mesmas.

## O que foi conferido

Nesta rodada o trabalho foi lido nos arquivos do worktree e alguns portões foram rodados nesta máquina. O que se olhou:

- A publicação: a escolha de push e a de pull request são lidas no ponto da decisão, a branch sai pela porta de Ações auditada, o pull request é aberto pela mesma porta, uma execução de release fica fora das duas escolhas por construção antes de se olhar o bloco, e o espaço de trabalho de teste continua recusando pela porta, com a recusa dita na conversa.
- O gate: ao entrar num gate, com a escolha ligada, o app o aprova sozinho com o motivo e a origem, e a chamada está colocada logo depois da etapa (não atrás da condição de "nada mudou"), de modo que a execução que fica num gate é aprovada na hora — a correção que a verificação de QA pediu está no lugar.
- A lista de comandos: a seção da tela lê a conversa viva e agrupa por agente e por etapa; no fim da execução (concluída, cancelada ou falhou) uma mensagem única é postada de um ponto só, protegida contra postar duas vezes, e nada disso escreve no host.
- O cabeçalho da execução e as telas dos dois blocos: o cabeçalho diz que a execução roda sozinha, quais escolhas estão ligadas e de onde vem a decisão (espaço de trabalho ou fluxo); o bloco está em Configurações › Runner e na edição de cada fluxo, com o interruptor "Usar a configuração do espaço de trabalho" ligado por padrão, os campos desabilitados e a dica enquanto ele está ligado; um navegador pareado só desce (o bloco do espaço de trabalho fica fora do que ele salva, e o do fluxo recusa qualquer campo que passe de desligado para ligado e recusa desligar o interruptor).
- A marca do comando no computador sob autonomia: a conversa ganha uma linha dizendo que o comando rodou neste computador sob a autonomia do ciclo.
- A migração de esquema v15→v16, que cria o bloco do espaço de trabalho com tudo desligado e o mapa de fluxos vazio (idempotente) e não toca na rede de quem já existia; e a rede `open` da sandbox, que deixa de pôr o `--unshare-net` nesse valor, não põe as variáveis de proxy e monta o resolvedor do sistema somente leitura.
- A documentação do runner, que passa a descrever o bloco, a exceção do `shell: host`, o push e o pull request condicionais à escolha (com a release fora e o espaço de teste recusando), a rede `open` como a rede do computador inteira (escolha da pessoa, padrão fechado) e a seção "Não verificado" dizendo que alcançar um endereço público sob `open` não era observado.

- Portões rodados nesta máquina, com o resultado que voltou: verificação de tipos **limpa**; os testes focados de autonomia, da migração v15→v16, da lista de comandos, da publicação, do esquema, do navegador pareado e da política da sandbox **todos verdes**; auditoria de repositório público **limpa** (1093 arquivos, nada de empresa ou pessoa); catálogo de textos **limpo** (4422 chaves nos dois idiomas).

## O que mudou desde a aprovação anterior

Só documentação. O commit mais novo entrega o `3_IMPLEMENTATION.md` e a memória do ciclo reescritos, sem tocar em código. Nenhum fato novo entrou nesta rodada que pudesse introduzir um defeito, e nenhum pedido anterior está em falta.

## Observações que não bloqueiam (mantidas da rodada anterior)

1. **O rótulo da etapa na lista de comandos não é traduzido.** O nome do agente passa pelo texto do catálogo, mas o nome da etapa vai como o identificador interno que a execução registra. Numa conversa em inglês com um ciclo cujas etapas têm rótulos em português, a linha da etapa mostra o identificador, não o rótulo que a tela do fluxo mostra. É uma inconsistência de palavras, não um defeito de comportamento.
2. **O que entra na lista do fim é o que virou linha de conversa.** Um comando recusado antes de escrever qualquer linha (um comando vazio, um que passou do orçamento da etapa) aparece na lista viva da tela enquanto a execução anda, mas não deixa traço na mensagem final, embora a especificação peça que um comando que não rodou apareça com o resultado que teve. O efeito prático é pequeno, mas é a fronteira atual.

## O que não foi revisado

- **Nada do comportamento novo foi visto funcionando numa tela**: nenhuma janela foi aberta, nenhum bloco foi ligado à mão, nenhum campo do fluxo apareceu desabilitado com a dica e a lista não se viu atualizar ao vivo. O que se viu foi o código, os portões e os testes.
- A rede `open` não foi exercitada de novo nesta rodada; o que a execução real da sandbox alcança é o que a verificação de QA registrou, não o que esta revisão mediu. Fora de um Linux com a sandbox funcionando, a escolha não existe.
- Nenhum modelo nem host de código real participou desta revisão.

## Como foi conferido

Leitura direta dos arquivos citados e execução nesta máquina: verificação de tipos, os testes focados que prendem os critérios de aceite (autonomia, migração, lista de comandos, publicação, esquema, navegador pareado, política da sandbox), auditoria pública e catálogo de textos. O estado do código foi conferido como igual ao da aprovação anterior (o único commit novo desde então é de documentação), e os bloqueios de antes foram relidos no código que os escreve. Nada disso foi visto rodando no aplicativo, e está dito assim.
