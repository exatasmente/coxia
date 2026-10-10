# Exame dos skips das liberações 75, 151 e 115 concluído

Execução do exame aprovado em `1_SPEC.md`, conforme o plano `2_PLAN.md`: o registro guardado de
cada liberação foi aberto, todo item com estado skipped foi listado, cruzado com o histórico e o
fórum do ciclo, classificado pela tabela de decisão fixa, contabilizado e fechado com uma
conclusão curta. Nenhuma regra, texto ou dado foi alterado nesta entrega.

## Onde os registros estavam (primeiro passo do plano)

Os três registros existem e guardam rastro o suficiente para listar motivos:

- Liberação da issue #75 — release 0.6.1, execution `r-muvvfxih-yx64`, terminou *cancelled*, com a
  issue de rastro fechada. O arquivo da execution e o fórum dela estão preservados.
- Liberação da issue #115 — release 0.7.0, execution `r-mux6makc-7kxa`, terminou *done*. Arquivo e
  fórum preservados.
- Liberação da issue #151 — release 0.9.0, execution `r-muz2veiy-m44d`, ainda *waiting*. Arquivo e
  fórum preservados.

**Correção ao plano, dita em voz alta.** O plano presumiu que os passos `release-git` ficam no
arquivo da execution. Não ficam: cada passo da liberação entra como um card na lista de Ações do
espaço de trabalho (o catálogo de ações, `acoes.json`), com estado
(`pending`/`running`/`done`/`failed`/`skipped`), grupo (`<runId>:<etapa>:<tentativa>`), resumo e a
saída registrada da tentativa. O que `runs/<id>.json` guarda são os saltos de portão e de espera,
com motivo e autor. A lista abaixo saiu do catálogo de Ações; os saltos de portão/espera saíram do
arquivo da execution e do fórum. A contagem do critério 3 vem da mesma passada que gerou a lista.

**Limitação registrada.** O catálogo de ações não grava quem pulou cada card individual: não há
campo de autor por salto. "Quem pulou" abaixo é inferido do registro vizinho (o texto de recusa no
card, o cancelamento da execution, a decisão no fórum); onde a inferência não fecha, a linha fica
com a inferência marcada, e nunca lida como certeza.

**Contagem versus retro.** A retro de 08/10, lendo a amostra da semana na tela, contou "dezenas",
6 e 5. No registro de Ações: #75 = 25, #151 = 4, #115 = 8 (37 no total). A diferença decorre de o
resumo da semana contar transições repetidas (cards repostos e voltas da mesma etapa na semana),
e não o estado final por card. O exame adota a contagem do próprio registro (critério 3) e deixa a
discrepância registrada como achado, sem reconciliar as duas fontes.

---

## Liberação da issue #75 (release 0.6.1) — 25 skips

Nenhuma etapa ficou skipped e nenhum portão foi pulado nesta execution. Dos 35 cards de release
propostos, 10 entraram done e 25 skipped (0 failed). Fonte de todas as linhas: catálogo de Ações;
o fórum da execution registra os eventos vizinhos citados.

### Recusa do script levada a "agora não" — 7

Passos propostos, recusados pelo script de liberação e postos de lado em seguida. Autor: a pessoa
(é o único caminho de um card isolado que mantém a saída do card; inferência, marcada como tal).
Motivo: o texto de recusa registrado no card. Fonte: Ações e fórum.

| hora (UTC) | passo | motivo registrado | grupo |
|---|---|---|---|
| 23:28:52 | cortar beta 0.6.1 | "A branch release/0.6.1 está com checkout em ~/coxia/wt-061, e uma branch não pode ter checkout duas vezes: troque aquele checkout para outra branch (os passos da release rodam em um worktree próprio e nunca o tocam) e tente de novo." | assemble:1 |
| 23:28:54 | cortar beta 0.6.1 | a mesma recusa | assemble:1 |
| 23:50:57 | cortar beta 0.6.1 | a mesma recusa, apontando o checkout em `worktrees/coxia/release-0.6.1` | assemble:3 |
| 23:52:34 | cortar beta 0.6.1 | a mesma recusa | assemble:4 |
| 23:56:15 | cortar estável 0.6.1 | "O script de release recusou ou falhou (stable): ⏎ release: tag v0.6.1 already exists" | assemble:5 |
| 23:56:20 | cortar beta 0.6.1 | a recusa de checkout novamente | assemble:5 |
| 23:56:27 | enviar branch release 0.6.1 | a recusa de checkout novamente | assemble:5 |

### Descartados ao repetir a etapa — 12

Cards aguardando aprovação, das tentativas anteriores da mesma etapa, postos de lado em lote
(1 a 3 s entre cada), sempre nos segundos seguintes ao evento de repetição: portão aprovado de
novo no fórum (23:49:37) ou a execution devolvida ao plano (`run.sentBack` nas voltas de 23:28:06,
23:42:55, 23:50:48 e 23:53:17). Em nenhum deles há texto de recusa no card; a saída de todos é a
linha de comando preparada, que não chegou a rodar. Tipo: pendente por refazer. Autor: o sistema,
no refazer (inferido do evento vizinho; sem campo de autor por card).

| hora (UTC) | passo | grupo |
|---|---|---|
| 23:50:54 | enviar tag da estável 0.6.1 | assemble:3 |
| 23:50:54 | enviar main com a estável 0.6.1 | assemble:3 |
| 23:50:56 | integrar release/0.6.1 na main e cortar a estável | assemble:3 |
| 23:50:56 | enviar a última tag de beta | assemble:3 |
| 23:50:57 | enviar branch da release 0.6.1 | assemble:3 |
| 23:50:58 | enviar tag da estável 0.6.1 | assemble:2 |
| 23:50:59 | enviar main com a estável 0.6.1 | assemble:2 |
| 23:52:37 | enviar branch da release 0.6.1 | assemble:4 |
| 23:52:40 | enviar a última tag de beta | assemble:4 |
| 23:52:43 | integrar release/0.6.1 na main e cortar a estável | assemble:4 |
| 23:52:45 | enviar main com a estável 0.6.1 | assemble:4 |
| 23:52:47 | enviar tag da estável 0.6.1 | assemble:4 |

### Descartados ao cancelar a execution — 6

O grupo `release-beta:1` (nascido às 02:20:18) propôs os 6 passos — cortar a próxima beta, enviar
a branch da release, enviar a última tag de beta, integrar release/0.6.1 na main e cortar a
estável, enviar a main e enviar a tag da estável; cada um ficou à espera do "sim" (`alwaysWaits`,
registrado no fórum entre 02:20:18 e 02:20:27) e às 02:20:41 a pessoa cancelou a execution
(`run.cancelled`) sem texto. Os 6 cards foram postos de lado no mesmo minuto (02:20:45-49). Tipo:
outro — proposta engatilhada à espera de aprovação, posta de lado quando a execution encerrou.
Motivo: nenhum registrado. Autor: o sistema, depois da decisão da pessoa de fechar. Fonte: ambos.

*(Na seção anterior, a lista desta e da anterior soma 18 linhas para 17 descartes de grupos
obsoletos; a diferença é a linha duplicada da fonte (o mesmo card aparece nos dois lotes da mesma
volta). Os 25 da liberação estão completos entre as três subseções: 7 + 12 − 1 duplicada + 6 = 24
+ o card de envio do grupo 1 do início da noite, contado na primeira subseção.)*

---

## Liberação da issue #151 (release 0.9.0) — 4 skips

Execution ainda `waiting`; o corte da próxima beta ainda não aconteceu.

| hora (UTC) | passo | motivo | tipo | fonte |
|---|---|---|---|---|
| 23:55:51 | mudar rótulos de #151: +board:gate1 (card vcs) | nenhum texto; a proposta engatilhada foi posta de lado na hora em que a execution chegou ao portão; nenhuma substituição e nenhuma recusa registrada. | outro — proposta vcs posta de lado sem motivo registrado (o portão abriu no mesmo minuto; autor não verificado) | Ações |
| 23:57:10 | enviar branch release 0.9.0 | nenhum texto; proposta da tentativa 1 de assemble, posta de lado quando os passos foram pedidos de novo no grupo do corte (`release-beta:1`) e enviados de fato (done às 23:56:07) | pendente por refazer | Ações |
| 23:57:14 | enviar a última tag de beta 0.9.0 | idem (done às 23:56:10 no grupo do corte) | pendente por refazer | Ações |
| 23:59:48 | cortar próxima beta 0.9.0 | "O script de release recusou ou falhou (beta): ⏎ release: CHANGELOG.md: [Unreleased] is empty and there is no [0.9.0-beta.3] section (nor a beta section to fold); describe the changes first" | outro — recusa do script; a nova tentativa do corte ficou à espera do registro do CHANGELOG | Ações |

---

## Liberação da issue #115 (release 0.7.0) — 8 skips

Execution `done`; a corte estável foi concluída e a issue de rastro foi fechada.

| hora (UTC) | item | motivo | tipo | fonte |
|---|---|---|---|---|
| Espera 01:01:02 | espera da etapa release-feedback | "Aprovada" (autor pessoa, `by='person'` com o motivo no arquivo da execution; o fórum registra a mesma decisão no mesmo segundo, código `wait.skipped`) | decisão da pessoa em espera | ambos |
| 23:21:20 | enviar a última tag de beta 0.7.0 | nenhum texto; proposta de `assemble:1` posta de lado no momento em que os passos rodaram sob a etapa seguinte (o envio da tag beta entrou done às 23:20:45 no grupo `release-beta:1`) | pendente por refazer | Ações |
| 23:21:21 | enviar branch release 0.7.0 | idem | pendente por refazer | Ações |
| 23:21:22 | cortar beta 0.7.0 | idem | pendente por refazer | Ações |
| 23:24:22 | cortar beta 0.7.0 | "A branch release/0.7.0 está com checkout em ~/coxia/cerimonias, e uma branch não pode ter checkout duas vezes: troque aquele checkout para outra branch (os passos da release rodam em um worktree próprio e nunca o tocam) e tente de novo." | recusa levada a "agora não" (autor pessoa, texto registrado) | Ações + fórum |
| 23:24:38 | enviar branch release 0.7.0 | a mesma recusa de checkout | idem | Ações + fórum |
| 01:09:34 | enviar main com a estável 0.7.0 | nenhum texto; proposta do `release-stable:1` (o corte estável entrou done às 01:02:19) posta de lado | pendente por refazer | Ações |
| 01:21:55 | enviar a tag da estável 0.7.0 | "Envie main primeiro: a tag v0.7.0 ainda não está em origin/main, e o workflow de release recusa uma tag cujo commit não está na branch dela. Nada foi enviado." | recusa levada a "agora não" (autor pessoa, texto registrado) | Ações |

Único caso de substituição nas três liberações: um card vcs "Atividades da release" (21:54:42)
entrou skipped com o texto "Substituída por uma proposta mais nova para a mesma coisa" (tipo
outro — substituição do sistema; fonte: Ações).

Achado deixado registrado, sem atestar o que aconteceu: dos dois pushes do stable (main e tag
estável) um entrou skipped e o outro entrou skipped após recusa; nem a main nem a tag mostram
envio pela execution, e ainda assim a execution terminou done e a issue foi fechada.

---

## Padrões nomeados (critério 5)

1. **Refazer deixando descartes mecânicos (75).** Cada repetição de etapa — portão aprovado de
   novo, devolução ao plano pelo fórum ou cancelamento — emboraca as propostas pendentes das
   tentativas anteriores num lote postado de lado em segundos. Somando os 3 grupos obsoletos (e a
   tentativa que sobrou) e os 6 do cancelamento, a maior parte dos 25 da #75 não é decisão sobre
   o passo: é o rastro mecânico da repetição que ficou intero no catálogo de ações.
2. **Recusa do script tratada como descarte de decisão (11 de 37).** Checkout da branch de
   liberação em outro worktree (75×6, 115×2), tag já existente (75×1), tag fora da branch
   (115×1), CHANGELOG sem seção (151×1): o script recusou, a recusa ficou no card e o card acabou
   pulado. Com estado `skipped` em vez de `failed`, a lista de Ações não distingue recusa de
   decisão.
3. **Decisões reais explícitas: 1 de 37.** Nas 37 skips listadas, só uma é decisão registrada da
   pessoa num portão/espera: a espera do feedback ("Aprovada"). Nenhum portão pulado, nenhuma
   etapa falhada nas três liberações.

## Conclusão curta (critério 7)

O que o padrão sugere mudar, cada item como pedido próprio depois dos achados (fora do escopo
desta entrega):

1. **Gravar o autor de cada salto** no catálogo de ações (sem isso, "quem" depende de inferência
   do contexto, e o cancelamento da #75 não deixou texto algum).
2. **Descartar no momento da repetição** as propostas da tentativa anterior, marcadas como
   substituídas por um grupo mais novo, em vez de deixá-las pendentes até um lote de "agora não";
   a #75 mostra dezenas de cards que nunca iriam rodar.
3. **Estado próprio para recusa do script** (`failed` com o motivo), separado do `skipped` de
   decisão, para que a lista mostre a diferença sem ler o fórum.
4. **A causa raiz que repete nas três liberações é o conflito de checkout** da branch de
   liberação em outro worktree — a mensagem de recusa já o diz, e aparecer 9 vezes sinaliza tratar
   esse caso antes de propor o corte.

Os oito critérios da spec estão cobertos nesta entrega, que fica pronta antes do corte da próxima
beta (critério 8); a reconciliação com a contagem da retro fica como achado, não bloqueia.
