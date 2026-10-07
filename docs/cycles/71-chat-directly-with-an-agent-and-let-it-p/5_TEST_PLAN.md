# Como a conversa direta e as propostas de escrita foram testadas

Este plano diz o que foi exercitado para a conversa que pertence a um agente e para a
resposta que propõe escritas no rastreador, o que se viu em cada caso, e o que ficou
fora e por quê. Os testes são os do repositório, com hosts e motores falsos; nada
alcança um modelo real, um host real ou a rede.

## O que foi exercitado

Comandos rodados nesta árvore de trabalho, na ordem em que aparecem:

1. `npx vitest run test/mentions-agent-chat.test.ts test/actions-batch.test.ts test/agent-team.test.ts test/runner-mention-actions.test.ts` — 4 arquivos, 57 testes, todos passando (exit 0).
2. `npx vitest run` — a suíte inteira: 223 arquivos, 3657 testes, todos passando (exit 0).
3. `npx tsc --noEmit` — sem erros (exit 0).
4. `node scripts/theme-audit.mjs` — exit 0, sem cor literal fora de token.
5. `npm run i18n:lint` — 4074 chaves nos dois idiomas, 0 faltando (exit 0).
6. `node scripts/public-audit.mjs` — 914 arquivos, nada que pertença a uma empresa ou a uma pessoa (exit 0).
7. `npx electron-vite build` — construído (exit 0), incluindo os componentes de tela novos.

O que cada bloco cobre:

### Conversa que pertence a um agente

- A conversa de um agente é criada uma vez e é listada como conversa (não como canal),
  identificada pelo agente e com um título que o nomeia; chamar a criação de novo mantém
  a que já existe (idempotência).
- O cabeçalho que o formato escreve é aceito de volta ao ler: uma conversa do tipo novo
  volta com o dono certo.
- Uma mensagem de pessoa na conversa chama o agente dono **sem `@`**, e ele é chamado
  primeiro; um `@outro` na mesma mensagem também chama o outro, dentro do teto de 3; uma
  mensagem escrita por um agente não chama ninguém.
- Duas mensagens seguidas são respondidas na ordem, uma após a outra, e a segunda
  resposta traz a primeira mensagem como contexto.
- O lugar da conversa é o do espaço de trabalho (os repositórios para leitura), sem
  squad, com o dono nomeado.
- Uma conversa **não** dá confinamento ao agente: a chamada sai sem confinamento, de modo
  que as ferramentas de escrita em arquivo continuam fora. Isso vale **mesmo quando o
  próprio agente liga as ferramentas de arquivo só para ele**, com o espaço de trabalho
  desligado: a chamada continua sem confinamento e o agente continua em leitura.

### As escritas que uma resposta propõe

- Cada operação (comentar, rótulos, mudar estado, fechar, abrir issue) vira uma proposta
  em Ações, com o comando à vista, agrupada pelo mesmo lote da resposta, e **nada roda
  antes do "sim"**.
- **Uma escrita que o host planeja em vários comandos não é cortada no primeiro**: três
  chamadas de rótulos viram três propostas, e nenhuma remoção é perdida em silêncio.
- Duas escritas iguais na mesma resposta são propostas distintas; a mesma resposta
  reenviada não repete o que já espera; outra resposta da mesma conversa é uma proposta
  nova.
- Um host que não tem a operação (rótulos) é dito indisponível e **não propõe nada**, sem
  escrever.
- Com a autonomia de um agente ligada, **só um comentário e uma mudança de rótulo** saem
  sozinhos, auditados, com o agente como autor; fechar, mudar o estado e abrir uma issue
  **continuam esperando** a pessoa.
- Num espaço de trabalho de teste, a confirmação da proposta é recusada e nada é
  escrito nem auditado.

### O lote em Ações

- As propostas de uma mesma resposta agrupam-se num lote; duas respostas da mesma
  conversa, e qualquer proposta sem lote, ficam separadas.
- O lote só mantém o que ainda espera: uma escrita já feita ou pulada sai do grupo; uma
  que falhou permanece (a pessoa a repete).

### Permissões por agente

- Um agente sem ferramentas próprias segue as do espaço de trabalho; um agente com
  ferramentas próprias sobrepõe campo a campo, **inclusive ligando uma ferramenta que o
  espaço de trabalho desligou**, e isso não muda a dos outros.
- O esquema aceita o campo e o descreve; a migração de configuração da versão anterior
  acrescenta o campo como ausente para todo agente, sem levantar nada e sem mudar o
  comportamento.

### A resposta que propõe numa execução

- A issue proposta na conversa de uma execução espera em Ações como as demais
  (`mention-write`), com a linha de sistema correspondente.

## O que se viu

Todos os comandos acima terminaram com código de saída 0. Os 57 testes dos arquivos de
comportamento e os 3657 da suíte inteira passaram. A verificação de tipos, a auditoria de
tema, a de idiomas, a pública e a construção da aplicação passaram.

Nada foi visto funcionando **dentro do aplicativo em execução**: o repositório não tem
teste de renderer, então o que foi exercitado da tela é a regra pura do lote e a
compilação dos componentes, não os botões clicados.

## O que não foi verificado, e por quê

- **A conversa direta no telefone pareado.** A lista e a leitura do fórum são abertas ao
  navegador pareado, e a conversa é uma conversa comum de id estável; mas a tela não foi
  aberta num navegador pareado, e nenhum teste exercita esse caminho. Não verificado.
- **A ausência de memória entre conversas.** O contexto é a janela das últimas mensagens
  da própria conversa e não nasce arquivo de memória, mas abrir duas conversas seguidas
  para ver que a segunda não traz a primeira não foi feito. Não verificado.
- **A tela de Ações com o alvo de uma conversa sem referência.** Numa conversa sem
  referência, o alvo do registro de uma proposta fica no número 0; a tela de Ações não
  foi exercitada com esse alvo. O que a pessoa lê vem do resumo e do título, mas o
  número da issue fica sem valor no registro. Não verificado em execução; observado por
  leitura.
- **O aviso na conversa de uma execução** sobre a issue que ela propôs: a unidade da
  proposta não leva o `runId`, então a conversa não recebe de volta a linha dizendo o que
  ocorreu com aquela proposta. O que espera em Ações continua esperando. Observado por
  leitura; não há teste que o exercite.
- **Um host de código real** e **dados reais**: só há host falso. Nenhuma dessas
  operações foi enviada a um host de verdade.

## Risco que resta, e o que fazer com ele

Os pontos não verificados são de verificação de tela e de telefone, não de regra de
negócio: a regra do lote, a da chave das propostas, a dos limites da autonomia e a da
leitura somente do código estão exercitadas. Nenhum deles impede a entrega; ficam
registrados para quem for conferir no aplicativo.
