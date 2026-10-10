# De uma issue ao pull request

Uma issue é aberta, o rótulo de gatilho vai nela, e a execução começa sozinha. Aqui está tudo o que
acontece com ela.

**Triagem.** A porta de entrada lê a issue e propõe quem deve trabalhá-la. Com vários squads
disputando a issue, a execução espera a escolha ou assume a proposta, conforme a autonomia do
agente.

**Refinamento e plano.** Um agente lê o código e escreve o que a issue realmente pede, e depois o
plano técnico: os arquivos, a ordem, os testes, os riscos. O plano é um documento na pasta do ciclo,
e a execução para num gate para você aprová-lo.

**Desenvolvimento.** O Desenvolvedor trabalha no worktree da execução, numa branch própria. Escreve,
roda os comandos que o espaço de trabalho permite numa sandbox e faz um commit por mudança lógica
pelo aplicativo. O que ele não consegue decidir vira uma pergunta, e a pergunta é respondida pela
pessoa ou pelo agente a quem ele recorre.

**Revisão e QA.** O Revisor lê o diff da branch e deixa achados com arquivo e linha; a QA roda as
verificações do próprio projeto e marca cada cenário que exercitou, citando o comando por trás dele.
Um achado ou um cenário que falhou devolve o trabalho à implementação, e o limite de rodadas diz
quando parar.

**O fim.** A última etapa escreve a descrição do pull request, e o envio e o pull request são
propostos. Eles esperam o seu "sim" em Ações. Quando o pull request é mesclado, a execução termina e
quem abriu a issue recebe a nota dele.

O que cada passo escreve no host de código, e a única regra por trás disso, está em
[O runner](/reference/runner.pt-br#o-que-fica-no-host-de-código).

<!-- site:image-placeholder -->
> **Captura (pendente).** A rodada de revisão com os achados e onde a conversa de cada um está no
> pull request. Sai do aplicativo, de um espaço de trabalho semeado com dados fictícios, refeita a
> cada versão.
