# O painel de conflito sai da conversa de desbloqueio

O que sai, onde o botão fica e o que precisa sair junto para nada quebrar. O documento assume que a
issue e o comentário de quem a abriu fixaram o escopo; o que se planeja aqui está sob o que já foi
registrado.

## Como a mudança é feita

O painel de conflito é uma das três seções da coluna direita da tela de desbloqueio: aparece quando o
card tem requisição de merge em conflito, mostra o título e a nota que explicam a resolução, e hospeda
o botão que prepara a resolução e abre a tela do conflito. A seção inteira sai, com os dois textos e a
chamada do botão que viviam só ali. Como consequência, o valor de marca de lugar reservado à tela de
desbloqueio perde o único uso e sai do componente do botão; os outros dois valores (linha do que
precisa de atenção e linha de atividade do card) ficam como estão.

Nada mais se move. A coluna direita passa a começar na seção das saídas possíveis; a lista do que o
agente leu, a conversa, o compositor e a ata continuam iguais. A detecção de qual requisição está em
conflito não é tocada: o botão continua sendo montado a partir da mesma função que lê os conflitos do
card, e os dois pontos da tela de Hoje continuam chamando o mesmo componente com as mesmas marcas.

As duas pontas dos catálogos saem juntas (os dois idiomas e as cópias espelhadas usadas pelos testes),
porque o portão de i18n compara os catálogos entre si e o portão de catálogo compara o código com as
cópias.

O apontamento do bloqueio para o botão já existe no código e não muda: a linha do bloqueio na lista do
que precisa de atenção não leva à tela de desbloqueio por causa do painel; ela monta o item com o card
em conflito e a referência exata da requisição que é o próprio bloqueio, e o botão da linha mostra só
essa requisição. O que a retirada muda para quem usa é que o painel deixa de ser uma segunda porta
para o mesmo botão.

## Arquivos e passos

1. `src/renderer/src/screens/Deep.tsx`
   - Apagar a seção do painel (hoje as linhas 245 a 251: o `{conflictMrs(card).length > 0 && (...)}`
     com `<section className="panel">`, o título `t('ui.deep.conflict')`, a nota
     `t('ui.deep.conflictNote')` e `<ResolveConflict card={card} go={go} place="deep" />`).
   - Remover os imports que ficam sem uso: `ResolveConflict` (linha 15) e `conflictMrs` (linha 16).
     `conflictMrs` e `ResolveConflict` não são usados em nenhum outro ponto do arquivo (conferido por
     leitura de todo o arquivo); o tipo `CSSProperties` segue usado pelos estilos do topo.
   - Nada mais da tela muda: a condição de conflito que abria a seção só existia ali.
2. `src/renderer/src/screens/ResolveConflict.tsx`
   - `ConflictPlace` passa a `'need' | 'act'` (linha 10). Os usos de `place="need"`
     (`TodayParts.tsx:114`) e `place="act"` (`TodayParts.tsx:224`) não mudam.
   - A chave de job `conflictmr:${place}:${card.ref}:` segue a mesma forma; só o valor `'deep'` deixa
     de existir. O segundo elemento do prefixo separa as três origens antigas; nada persistido é lido
     por essa chave entre sessões.
   - O rótulo do job e a tela para onde a linha de atividade aponta continuam iguais — inclusive a
     tela `deep` como destino do job, que é o que a linha de atividade do card sempre fez.
3. `src/shared/i18n/ui-call.en.json` e `src/shared/i18n/ui-call.pt-BR.json`
   - Remover `ui.deep.conflict` e `ui.deep.conflictNote` (linhas 105 e 106 nos dois arquivos; o pt-BR
     tem `{cr} com conflito`, o en tem `{cr} with a conflict`). As linhas vizinhas ficam.
4. `test/fixtures/catalogs-main/ui-call.en.json` e `.../ui-call.pt-BR.json`
   - Mesmas duas chaves, nas mesmas linhas (105 e 106). A cópia mantém o texto em forma neutra ("MR
     com conflito" / "MR with a conflict").
5. Fora desses arquivos, nada muda. Não há outro uso de `ui.deep.conflict`, `ui.deep.conflictNote` nem
   do valor `'deep'` de `ConflictPlace` no código, nos testes ou nos fixtures (verificado por busca em
   `src/` e `test/`; a única outra ocorrência é num documento histórico de um ciclo antigo, que não é
   tocado).

## O que muda, por área

- Tela de desbloqueio: deixa de mostrar o painel de conflito, em qualquer situação. A conversa, as
  saídas e a ata continuam; a coluna direita começa nas saídas.
- Tela de Hoje: nada muda de lugar. O botão de resolver conflito continua na linha do que precisa de
  atenção (junto ao item do bloqueio) e na linha de atividade do card, como hoje.
- Catálogos: as duas frases do painel saem dos dois idiomas e das cópias dos testes.
- Resolução de conflito: continua igual — preparar, propor, aplicar e verificar, publicar.
- Configuração: nada a migrar; nenhuma opção e nenhuma cerimônia mudam por causa desta retirada.

## Riscos e como são cobertos

- **Texto órfão em um catálogo só.** O portão de i18n compara as chaves dos dois idiomas e o de
  catálogo compara o código com as cópias dos testes: remover das quatro partes na mesma passada
  mantém os dois verdes. Se uma parte ficar, o portão acusa na hora.
- **Um dos dois pontos da tela de Hoje perder o botão sem querer.** Nenhum dos dois é tocado; o teste
  do botão continua cobrindo a linha do que precisa de atenção (com e sem conflito, e a requisição que
  o item nomeia). Um olhar final confere que os dois seguem montando o componente.
- **A linha do bloqueio deixar de apontar para onde o botão está.** A linha não é tocada: ela já monta
  o item com o card em conflito e a referência exata do bloqueio, o que faz o botão da linha mostrar só
  aquele merge request. Fica coberto pela asserção existente de `conflictCard`/`conflictRef` no teste
  do botão.
- **A guarda de escrita externa ficar órfã.** A guarda vive no processo principal: a aprovação de uma
  ação (`approveAction`) chama a guarda antes de qualquer escrita, e é por essa porta que o push da
  resolução passa; o botão de conflito apenas cria a ação e abre a tela do conflito, sem escrita para
  fora. Nada preso ao painel sai com ele. Fica como verificação de leitura, não como teste novo.
- **Nenhum teste afirma que a tela de desbloqueio mostra o painel.** Verificado por leitura: os testes
  vizinhos cobrem a origem do dado de conflito, a linha de Hoje e o botão; nenhum renderiza a tela de
  desbloqueio nem cita os textos do painel. O roteiro de teste de um ciclo anterior descreve a tela
  mostrando o painel e precisa de ajuste quando aquele arquivo estiver ao alcance desta issue.
- **Notificação ou apontamento que aponte para o painel.** Verificado por leitura: a tela de
  desbloqueio continua sendo um destino válido por outros motivos (a linha do bloqueio e a pergunta
  aberta levam a ela, e a tela tem outros conteúdos); nenhum destino automático aponta para o painel.

## Como será testado

- `npx tsc --noEmit`: o tipo `ConflictPlace` sem `'deep'` não pode deixar nenhum uso antigo; se algum
  sobrou, o typecheck acusa.
- `npx vitest run`: a suíte inteira, com atenção em `test/resolve-conflict-button.test.ts` (a linha de
  Hoje continua oferecendo o botão e nomeando o merge request), `test/dashboard.test.ts` (a detecção de
  conflito não muda) e `test/main-catalogs.test.ts` (as cópias dos catálogos continuam batendo).
- `npm run i18n:lint`: os dois catálogos continuam com as mesmas chaves, sem as duas que saíram.
- `node scripts/theme-audit.mjs`: nenhuma cor literal nova nem contraste quebrado (a mudança só tira
  uma seção).
- `node scripts/public-audit.mjs`: nada de nome, host, pessoa ou número de issue de verdade entra no que
  for escrito.
- Conferência manual, sem depender de modelo nem de host: abrir a conversa de desbloqueio de um card
  com conflito e ver a conversa sem o painel; na tela de Hoje, ver o botão na linha do que precisa de
  atenção e na linha de atividade. Para um card com conflito que não é o primeiro bloqueio, ver o botão
  da linha nomear a requisição. Isso não foi executado nesta etapa (só leitura de código); a retirada em
  si segue não verificada até a implementação rodar os portões.

## Fora do escopo

- Mudar como o conflito é resolvido, quem o resolve ou quando.
- Mudar a detecção de conflito e os dois pontos onde o botão já aparece em Hoje.
- Criar botão novo ou migrar configuração.
- Fazer sinais de bloqueio de fora das cerimônias chegarem à conversa de desbloqueio (item irmão).
- Renomear termos internos deste fluxo (`ConflictPlace` e os textos `ui.resolver.*` continuam como
  estão; são a ferramenta de conflito, não o painel retirado).
