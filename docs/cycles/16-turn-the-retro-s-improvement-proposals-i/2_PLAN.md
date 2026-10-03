# Plano: as melhorias da retro viram tarefa do fluxo de agentes

## 1. O que muda, em uma frase

A retro para de pedir e de guardar propostas de melhoria; a melhoria passa a nascer na conversa da retro, aparecer como proposta de abrir uma issue em Ações e, aceita, virar uma execução do fluxo de agentes, com pasta de ciclo, conversa e documentos próprios. Nada é escrito no rastreador sem o "sim" da pessoa; sem rastreador, sem projeto de issues ou sem escrita de issue, a melhoria fica só na conversa, com o motivo dito. A retirada vale para a retro de todas as famílias de ciclo.

## 2. O que a leitura desta etapa confirmou (arquivo:linha)

Tudo abaixo foi lido no código desta árvore de trabalho. Nada foi executado; ver a seção 9.

| Fato | Onde |
|---|---|
| `prepareRetro` monta o prompt (`improvements`, linha 145), pede `melhorias` no schema (154) e grava `improvements` no registro (170) | `src/main/retro.ts:122-174` |
| A retro é lida com `JSON.parse(...) as Retro`, sem validação de schema: o campo extra de uma retro antiga é simplesmente ignorado (Regra 2 sai de graça) | `src/main/retro.ts:33-40` |
| `askRetro` faz uma chamada ao modelo, guarda o `sessionId`, empilha a fala e grava: é o único ponto por onde a conversa passa | `src/main/retro.ts:176-189` |
| `proposeVcsAction` valida, deduplica por `key` (só `pending`/`running`/`done` bloqueiam), monta `output = detail + describe(command)`; `write()` emite o evento `actions`, então o cartão aparece em Ações na hora | `src/main/actions.ts:164-194`, `:93` |
| `approveAction` chama `assertExternalWrite` antes de tudo (457) e só avisa quem propôs no sucesso (`told`, 506); falha e recusa não avisam | `src/main/actions.ts:456-513` |
| `supersede` é no-op sem `unit.runId`: a proposta da retro nunca substitui outra | `src/main/actions.ts:154-158` |
| `vcsProvider()` lança `VcsError('not_configured')` quando o espaço de trabalho não tem integração | `src/main/vcs/index.ts:99-101` |
| `issueProjectKey()`: id numérico no GitLab, caminho "grupo/nome" nos demais; lança `main.config.noIssueProject` sem projeto | `src/main/workspaceConfig.ts:146-151` |
| `checkTitle` recusa título acima de `ISSUE_TITLE_MAX` (256), e os três provedores criam issue com `labels: []` omitido | `src/main/vcs/util.ts:35-42`, `gitlab.ts:520-521`, `github.ts:530-531`, `bitbucket.ts:447-449` |
| O caminho modelo a imitar: `planWrite({op:'createIssue'})` → `propose({unit:{...purpose:'request-issue'}})` → na aprovação `createdIssueOf(responses[0])` | `src/main/runner/publish.ts:840-870` |
| `createdIssueOf` lê `number ?? iid ?? id` e devolve `{iid, url}` ou `null` | `src/shared/runs/links.ts:5-13` |
| `actionDone` sai cedo quando não há `unit.runId`: uma proposta da retro não entra no caminho de publicação dos runs | `src/main/runner/service.ts:683-685` |
| `start(ref, repoId?)` resolve a ref pelo `refPrefix` do config (`refPrefix + iid`) | `src/main/runner/service.ts:168,436-439` |
| O app já escuta as propostas concluídas, e `runs:start` chama `r.start`, no mesmo módulo que tem o `runner` | `src/main/runner/module.ts:65,77` |
| Num cartão de tipo `vcs`, o título é o `summary`, o subtítulo é `issueTitle · stageText(stage)` e o `output` aparece num `<pre>` | `src/renderer/src/screens/Actions.tsx:20-21,88,126` |
| `Improvement` e `Retro.improvements` | `src/shared/types.ts:356-379` |
| `improvementEntry`, o `copy` que só ele usa e a seção de melhorias | `src/renderer/src/screens/RetroScreen.tsx:17-28,110-114,175-190` |
| `{improvements}` no prompt da retro; `improvementsFormat`; o `ask` já convida a propor e não menciona melhorias | `src/shared/i18n/en.json:438,446,447` e `pt-BR.json` (mesmas linhas) |
| Os prompts de retro de Scrum e Kanban pedem "melhorias" em prosa, sem placeholder | `src/shared/i18n/en.json:517-518` e `pt-BR.json` |
| Entrada das melhorias e os dois textos de entrada da tela (ambos prometem o formato IMPROVEMENTS.md) | `src/shared/i18n/ui-docs.en.json:133-135,140-144` e `ui-docs.pt-BR.json` |
| A guarda dos catálogos congelados: `RENAMED`, `INTENDED` (só pt-BR, com substituição listada e motivo) e os quatro testes que os prendem | `test/gitlab-catalogs-unchanged.test.ts:39-60,78-113` |
| `LEFTOVER = /\{[A-Za-z]+\}/` é conferido no prompt da retro renderizado: manter `{improvements}` no texto sem passar o parâmetro reprova | `test/cycle-prompts.test.ts:188,312-316` |
| Em espaço de trabalho de teste a confirmação é recusada e nada roda | `test/vcs-writes.test.ts:132-138` |
| O modelo de teste do caminho "proposta → issue → run", com `boot`, `makeForge` e `approveAction` | `test/runner-squads-publish.test.ts:40-51,89-104,169-189` |
| O teste que imita a resposta do modelo com um mock de `askAgent` | `test/squad-ceremonies.test.ts:23-30` |
| `boot` monta o runner com engine e issues falsos, então mockar `askAgent` não atrapalha o runner | `test/helpers/runner.ts:211-241` |

## 3. Ordem de trabalho (três commits)

Cada commit fecha um passo lógico e deixa a árvore verde (os gates da seção 6). A ordem evita qualquer estado intermediário quebrado: a tela perde a seção antes de o registro perder o campo, e o caminho novo nasce antes de o início da execução ser ligado.

### Commit 1 — `feat: drop the retro's improvement section from the screen and the record`

- `src/shared/types.ts`: tira `improvements` de `Retro` (376) e apaga a interface `Improvement` (356-361).
- `src/renderer/src/screens/RetroScreen.tsx`: apaga `improvementEntry` (17-28), o estado de copiado e a função que copia (110-114) e a seção inteira (175-190), inclusive o `ContinueInClaude` e os imports que só existiam por causa dela.
- `src/shared/i18n/ui-docs.{en,pt-BR}.json`: reescreve `ui.retro.intro` (143) e `ui.retro.introPlain` (144) para o que passa a acontecer, e apaga `ui.retro.improvements.{title,hint,hintPlain}` (140-142).
- `test/gitlab-catalogs-unchanged.test.ts`: a extensão descrita em 4.5.
- `test/retro-issues.test.ts` (novo, criado aqui): os dois primeiros casos de "Testes" (Regra 2 e a tela).

Regra 2 sai sem código: como `read()` não valida schema, uma retro gravada com `improvements` continua abrindo e o campo extra é ignorado. `ui.retro.entry.*`, `ui.retro.problem`, `ui.retro.proposal`, `ui.retro.copyEntry` e `ui.retro.copied` ficam sem uso e **não podem ser apagados** sem uma exceção na guarda congelada: ficam no catálogo, mortos e idênticos (decisão 5).

### Commit 2 — `feat: raise the retro's improvements in its conversation`

- `src/main/retro.ts`: `prepareRetro` perde o parâmetro `improvements` do prompt (145), a propriedade `melhorias` do schema (154) e a linha `improvements` da gravação (170); `askRetro` ganha `melhorias` no schema e chama o caminho novo antes de `write(retro)`.
- `src/main/retroIssues.ts` (novo): a proposta por melhoria e a nota na conversa (4.2).
- `src/shared/i18n/{en,pt-BR}.json`: tira `{improvements}` de `prompt.sdd.retro.main` (438), apaga `prompt.sdd.retro.improvementsFormat` (446), tira a frase de melhorias dos prompts de retro de Scrum e Kanban (517-518) — a retirada vale para a retro de todas as famílias de ciclo — e acrescenta as chaves `main.retro.issue.*` (4.5). `prompt.sdd.retro.ask` (447) **não muda**: ele já convida a propor e é o único jeito de o prompt da retro não mencionar melhorias.
- `test/golden/{en,legacy}-prompts{,-novoice}.json`: regenerados com `UPDATE_GOLDEN=1`.
- `src/renderer/src/screens/Actions.tsx:88`: o subtítulo só é renderizado quando há `issueTitle` ou `stage`, para o cartão da retro não mostrar " · " solto.
- `test/retro-issues.test.ts`: os casos de proposta, Regra 6, Regra 7 e deduplicação.

### Commit 3 — `feat: start a run on the issue a retro improvement opens`

- `src/main/runner/module.ts`: o ouvinte de `onRunnerActionDone` para `unit.purpose === 'retro-issue'` (4.3).
- `test/retro-issues.test.ts`: aceitar cria a issue e começa a execução; pular não cria nada; espaço de teste recusa a confirmação.

## 4. Contratos

### 4.1 `askRetro` (`src/main/retro.ts:176-189`)

```ts
const r = await askAgent<{ fala: string; texto: string; melhorias?: { titulo: string; dimensao: string; problema: string; proposta: string }[] }>(
  'deep',
  cp('retro.ask', { question }),
  obj({ fala: str, texto: str, melhorias: { type: 'array', items: obj({ titulo: str, dimensao: str, problema: str, proposta: str }) } }),
  { maxTurns: 10, ...(retro.sessionId ? { resume: retro.sessionId } : {}) },
);
retro.sessionId = r.sessionId || retro.sessionId;
retro.talk.push({ me: true, ... }, { me: false, ... });        // como hoje
await proposeRetroIssues(retro, r.data.melhorias ?? []);        // antes do write
return write(retro);
```

O `?? []` é obrigatório: `obj()` marca toda propriedade como obrigatória, mas a resposta falsa dos testes e uma resposta parcial do modelo podem omitir o campo. Sem `minItems` e sem `description`, porque nenhum schema do repositório usa `description` (`src/main/agents.ts:307,316-318`) e `minItems` forçaria o modelo a inventar melhoria.

### 4.2 `src/main/retroIssues.ts` (novo)

Uma função exportada, `proposeRetroIssues(retro, melhorias)`, e uma nota na conversa por melhoria. Para cada melhoria, na ordem em que veio:

1. **Motivo de não dar (Regra 7), na ordem em que a primeira peça que falta aparece** — igual a `publish.ts:842-850`, menos a guarda de espaço de teste, que aqui **não** entra (decisão 4):
   - `try { provider = vcsProvider() } catch (e) { motivo = message(e) }`;
   - `if (!provider.caps.issues) motivo = t('main.retro.issue.noWrite')`;
   - `try { project = issueProjectKey() } catch (e) { motivo = message(e) }`;
   - `try { commands = await provider.planWrite({ op: 'createIssue', project, title: m.titulo, body, labels: [] }) } catch (e) { motivo = message(e) }` (pega o título acima de 256);
   - `if (!commands.length) motivo = t('main.retro.issue.noWrite')`.
   Com motivo: empilha `main.retro.issue.refused` com `{ title, reason }` e não propõe nada.
2. **Sem motivo**, monta o corpo e propõe:
   ```ts
   const key = `retro-issue:${retro.id}:${slug(m.titulo) || `i${i}`}`;
   const summary = t('main.retro.issue.summary', { title: m.titulo });
   const body = [
     t('main.retro.issue.dimension', { value: m.dimensao }),
     '',
     t('main.retro.issue.problem', { value: m.problema }),
     '',
     t('main.retro.issue.proposal', { value: m.proposta }),
     '',
     t('main.retro.issue.origin', { date: formatDate(new Date(retro.to)), id: retro.id }),
   ].join('\n');
   const made = proposeVcsAction({
     key, issue: 0, issueTitle: '', stage: '',
     summary, detail: body, command: commands[0],
     unit: { purpose: 'retro-issue', retro: retro.id, key },
     notify: { title: summary, body: t('main.retro.issue.proposed', { title: m.titulo }) },
   });
   if (made) retro.talk.push({ me: false, text: t('main.retro.issue.proposed', { title: m.titulo }), speech: /* a mesma frase */, at: now() });
   ```
   `made === null` é a proposta que já está pendente/feita (dedup por `key`, `actions.ts:178`): não repete a nota. `slug` é minúsculas, não alfanumérico → `-`, cortado em 40, para a mesma melhoria pedida duas vezes não virar duas propostas.

O título vai verbatim para o rastreador (Regra 3); a `key` usa o slug só para deduplicar.

### 4.3 O ouvinte (`src/main/runner/module.ts`, junto da linha 65)

```ts
onRunnerActionDone((action, responses) => {
  if (action.unit?.purpose !== 'retro-issue') return;
  const made = createdIssueOf(responses[0]);
  if (!made) { void noteRetroIssue(String(action.unit.retro), 'main.retro.issue.noIssue', {}); return; }
  void r.start(`${rc().issues.refPrefix}${made.iid}`).catch((err) => noteRetroIssue(String(action.unit.retro), 'main.retro.issue.noRun', { reason: message(err) }));
});
```

`noteRetroIssue` (mesmo arquivo novo) relê a retro por id e empilha a nota; uma retro inexistente não é erro. O ouvinte só recebe propostas **concluídas**: `told` é chamado apenas no sucesso (`actions.ts:506`, contra o `catch` em 510-512), então recusa e falha não chegam aqui — quem as mostra é a tela de Ações, como em qualquer outra proposta. O `r.start` é o mesmo caminho do `runs:start` (module.ts:77) e é ele que dá pasta de ciclo, conversa e documentos à execução (Regra 5).

### 4.4 A tela

- `RetroScreen.tsx`: nada de novo; a seção some no commit 1 e o resto (relato, números, funcionou, travado, retrabalho, conversa) fica igual (Regra 1).
- `Actions.tsx:88`: o subtítulo passa a ser renderizado só quando há `issueTitle` ou `stage`. O cartão da retro mostra o título da melhoria como cabeçalho e, no `<pre>` de `output` (126), a dimensão, o problema, a proposta e a retro de origem — o "texto da melhoria à vista" da Regra 3.

### 4.5 Catálogos e a guarda congelada

Chaves novas, nos catalogs principais (é onde os textos de `src/main` moram; `src/main` nunca usa `ui.*`, verificado com busca):

| Chave | Papel |
|---|---|
| `main.retro.issue.summary` | O título do cartão: `Abrir a issue "{title}"` |
| `main.retro.issue.dimension` / `.problem` / `.proposal` | As três linhas do corpo, `**Rótulo:** {value}` |
| `main.retro.issue.origin` | `Da retro de {date} ({id}).` |
| `main.retro.issue.proposed` | A fala: a proposta está em Ações para a pessoa aceitar |
| `main.retro.issue.refused` | A fala da Regra 7: `"{title}" fica só aqui: {reason}` |
| `main.retro.issue.noWrite` | O motivo de o host não aceitar escrita de issue |
| `main.retro.issue.noIssue` | A fala quando o host não devolveu número de issue |
| `main.retro.issue.noRun` | A fala quando a execução não pôde começar: `{reason}` |

Toda edição vale para os dois idiomas: `test/main-catalogs.test.ts:24,27` e `test/i18n.test.ts:62-68` conferem paridade de chaves e de buracos.

A guarda `test/gitlab-catalogs-unchanged.test.ts` percorre as chaves de `main` e exige que cada uma renderize o texto do snapshot. Ela precisa de duas extensões pequenas e motivadas (decisão 6):

1. `INTENDED` ganha um `language?: 'pt-BR' | 'both'` (padrão `pt-BR`, como hoje) e o `replace` passa a ser opcional; o teste "an intended difference is exactly the listed replacement" aceita as duas línguas e só cobra a substituição quando ela existe.
2. Um novo `REMOVED: Record<string, string>` (chave → motivo), com um teste de que cada chave listada de fato sumiu de `CATALOGS`, e o filtro do diff pulando essas chaves.

Entradas: `REMOVED` para `prompt.sdd.retro.improvementsFormat`, `ui.retro.improvements.title`, `.hint`, `.hintPlain`; `INTENDED` com `language: 'both'` e substituição listada para `prompt.sdd.retro.main` (a linha `{improvements}\n` sai), `ui.retro.intro` e `ui.retro.introPlain` (a cauda que promete o IMPROVEMENTS.md vira a frase da proposta em Ações) e `prompt.scrum.retro.main` e `prompt.kanban.retro.main` (a frase de melhorias sai das retros de todas as famílias de ciclo).

## 5. Testes

`test/retro-issues.test.ts` (novo), no molde de `test/runner-squads-publish.test.ts` mais o mock de `askAgent` de `test/squad-ceremonies.test.ts` (o `boot` de `test/helpers/runner.ts:211-241` monta o runner com engine e issues falsos, então o mock não atrapalha o runner):

1. **Regra 2, no commit 1** — grava um `retros/<dia>.json` com `improvements` preenchido e confere que `latestRetro()` devolve a retro e que `RetroScreen.tsx` não menciona mais melhorias (asserção sobre o texto do arquivo, como `test/vcs-writes.test.ts:180-209` faz com as fontes).
2. **Regra 1** — `prepareRetro()` com o mock: o arquivo gravado não tem `improvements` e o prompt capturado não tem o parâmetro de melhorias.
3. **Regra 3 e 6** — `askRetro(id, pergunta)` com uma resposta falsa de duas melhorias: duas ações com `unit.purpose === 'retro-issue'`, `unit.retro === id`, chaves distintas, `summary` igual ao título de cada uma, `output` contendo dimensão, problema, proposta e o id da retro; duas falas na conversa; nada de issue criada ainda.
4. **Deduplicação** — a mesma resposta pedida de novo não cria outra proposta (chave igual).
5. **Regra 5** — `boot({ publish: true })` sobre o forge falso, `actions.approveAction(id)`: a issue existe com o título e o corpo montados, a linha de auditoria da criação está lá, e `b.runner.list()` tem uma execução com aquele `iid`.
6. **Regra 4** — espaço de trabalho de teste: a proposta aparece, `approveAction` rejeita com `/Workspace de testes/`, nenhuma issue e nenhuma execução.
7. **Regra 4, o "não"** — `skipAction`: nada criado, e a retro gravada continua sem melhorias.
8. **Regra 7** — sem projeto de issues (config sem `project`/`projectId`), sem `vcsProvider` (via a costura de teste) e com título acima de 256: nenhuma proposta, uma fala com o motivo em cada caso.

Atualizações: os quatro `test/golden/{en,legacy}-prompts{,-novoice}.json` são regenerados com `UPDATE_GOLDEN=1`; a diferença esperada é o `retro` perder a menção a melhorias (texto e chave de schema), os prompts de retro de Scrum e Kanban perderem a frase de melhorias e o `retro-ask` ganhar `melhorias` nas chaves de schema, com o texto do prompt igual (a conferir no diff); `test/squad-ceremonies.test.ts:28` deve continuar passando sem mudança (a resposta falsa carrega `melhorias: []`, que o `?? []` absorve); `test/gitlab-catalogs-unchanged.test.ts` cresce com as duas extensões de 4.5.

Não há teste de tela renderizada para a retro neste repositório; a prova de que a seção sumiu é a asserção sobre a fonte (caso 1), que é um substituto, não a tela rodando.

## 6. Gates

Um commit só está pronto com os cinco do `CLAUDE.md` verdes, mais o build do CI:

```
nvm use
npx tsc --noEmit
npx vitest run
node scripts/theme-audit.mjs
npm run i18n:lint
node scripts/public-audit.mjs
electron-vite build
```

`i18n:lint` não acusa chave não usada (verificado no script), então o texto morto da decisão 5 não o reprova. A regeneração dos goldens é o único comando que escreve no repositório, e vem antes do `vitest` final.

## 7. Riscos e como são cobertos

1. **O modelo pode nunca preencher `melhorias`.** Sem nenhuma menção no prompt (a aceitação exige que o prompt da retro passe sem falar de melhorias), só o schema pede o campo. **Não verificado** — exige execução real com o modelo. Cobertura: o teste prova a fiação com resposta falsa; o comportamento do modelo fica para a revisão e o QA. Se falhar, é decisão do PO (voltar a mencionar, ou fazer a melhoria nascer de um pedido explícito da pessoa).
2. **A guarda dos catálogos congelados.** Exceções em até 9 chaves de prompt/ui; é a maior superfície de revisão e um enfraquecimento, ainda que listado e motivado, de um gate duro. Cobertura: `REMOVED` com teste de ausência, `INTENDED` mantendo a forma de substituição estrita onde dá, e motivo de mais de 20 caracteres por chave.
3. **Texto morto nos catálogos** (`ui.retro.entry.*`, `ui.retro.problem`, `ui.retro.proposal`, `ui.retro.copyEntry`, `ui.retro.copied`): fica, porque apagar exigiria mais exceções. Aceito e registrado.
4. **Título de melhoria acima de 256 caracteres** não vira issue: o `planWrite` lança e o motivo vai para a conversa (Regra 7). Nada é criado.
5. **A execução pode não começar** depois de a issue existir (espaço de trabalho com quadros e sem quadro que aceite a issue nova, falha ao buscar a issue recém-criada no host). A issue fica criada e a conversa diz o motivo. **Não verificado** — depende do host real.
6. **`issue: 0` na proposta** da retro: invisível no cartão, mas gravado no `origin` da auditoria. Alternativa rejeitada na decisão 3.
7. **Ordem das falas**: as notas entram depois da resposta do moderador; com voz ligada, a última fala é a nota. É o desejado, mas muda o que se ouve ao fim de uma pergunta que levantou melhoria.
8. **Os três prompts de retro mudam** (o do ciclo de agentes, o de Scrum e o de Kanban), então os textos de ouro das três retros mudam junto. Cobertura: a regeneração dos goldens é conferida no diff, e cada chave tocada entra na guarda congelada com motivo.

## 8. Registro de decisões

1. **A melhoria nasce na conversa, não no resumo.** `prepareRetro` perde tudo o que é melhoria (prompt, schema, gravação) e `askRetro` ganha o campo. Alternativa descartada: manter a melhoria no resumo e só mudar o destino dela — contradiz a Regra 1 ("não pede mais propostas de melhoria ao modelo") e mantém a seção viva na tela.
2. **Sem `minItems` e sem `description` no schema.** `minItems` obrigaria o modelo a inventar melhoria onde não há; `description` seria um padrão novo (nenhum schema do repositório usa).
3. **`issue: 0`, `issueTitle: ''`, `stage: ''` na proposta.** `proposeVcsAction` exige um número de issue, e a issue ainda não existe; nada no cartão de tipo `vcs` lê esse campo. Alternativa descartada: tornar `issue` opcional, o que mexeria numa assinatura compartilhada por todas as propostas e no `blank()`. Junto: o subtítulo vazio do cartão deixa de ser renderizado.
4. **A guarda de escrita externa entra na confirmação, não na proposta.** A proposta precisa aparecer num espaço de trabalho de teste (Regra 4); quem recusa é o `assertExternalWrite` que `approveAction` já chama antes de tudo. Nenhuma linha nova para isso.
5. **As chaves de melhorias da tela são reescritas, as de entrada também; as de uso interno ficam.** `ui.retro.improvements.*` descrevem o fluxo que morre: saem (com exceção na guarda). `ui.retro.entry.*` e companhia ficam mortas para não somar exceções. Alternativa descartada: manter tudo e criar chaves novas — deixaria textos que prometem o IMPROVEMENTS.md no catálogo, ao lado dos que dizem o contrário.
6. **A guarda congelada é estendida, não contornada.** Duas extensões mínimas (língua em `INTENDED`, lista `REMOVED` com motivo), cobrindo exatamente as chaves desta mudança. Alternativa descartada: não mexer na guarda deixando texto morto que descreve a funcionalidade retirada.
7. **O ouvinte mora no módulo do runner.** É onde o `runner` e o `runs:start` já vivem e onde o app já escuta propostas concluídas; um módulo novo só para o ouvinte não teria nada a registrar além dele.
8. **Só o sucesso avisa a retro.** `told` não é chamado em falha nem em recusa; recusa e falha de escrita são assunto da tela de Ações, como em qualquer outra proposta. As falhas que a Regra 7 pede são as do momento de propor.
9. **A remoção vale para a retro de todas as famílias de ciclo; as outras cerimônias não são tocadas.** Decisão confirmada: a frase de melhorias sai do prompt da retro do ciclo de agentes e também dos prompts de retro de Scrum e Kanban, e a frase que promete o IMPROVEMENTS.md sai dos textos de entrada da tela. A Regra 1 fala da retro sem qualificar família, e a Regra 8 fala das outras cerimônias (gate, QA, release), não das outras famílias de retro. Assim a tela, o registro e os três prompts de retro ficam coerentes: nenhum pede o que o aplicativo descarta. Alternativa descartada: deixar os prompts de Scrum e Kanban como estão, o que faria essas retros pedirem melhorias que o aplicativo descarta silenciosamente.
10. **`prompt.sdd.retro.ask` não muda.** É o que sustenta "o prompt da retro passa sem a menção a melhorias" e evita mexer no texto do único prompt que sobrou para o modelo propor.

## 9. O que esta etapa não verificou

Nada foi alterado nem executado nesta etapa: nenhum gate foi rodado, nenhum teste, nenhum build, o aplicativo não foi aberto e nenhum modelo real foi chamado. Tudo acima é leitura de código e de documentos. Em particular, **não verificado**: se o modelo preenche `melhorias` sem instrução no prompt; se o texto de ouro do `retro-ask` muda só nas chaves de schema e se o diff dos goldens das três retros corresponde ao esperado; se o cartão da retro renderiza como descrito; se a execução começa de fato logo depois da criação da issue num host real; e se a recusa em espaço de trabalho de teste se comporta como o teste existente documenta.
