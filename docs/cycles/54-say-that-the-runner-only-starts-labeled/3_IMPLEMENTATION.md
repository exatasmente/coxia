# A atribuição por responsável passou a estar dita onde o gatilho é configurado e lido

## O que foi escrito

Três lugares que falam do gatilho passaram a exigir as três condições juntas — issue
**aberta**, com o rótulo **e atribuída à pessoa** —, nos dois idiomas. Nenhuma ação do
app mudou.

1. **`docs/configuration.md`, bloco `runner`.** No pt-BR (linha 73) e no inglês (linha
   221), a frase do `enabled` deixou de dizer que o app inicia execuções sozinho "para
   as issues que levam o rótulo `triggerLabel`" e passou a dizer que é só uma issue
   **aberta**, com o rótulo (padrão `coxia`, caixa não importa) e **atribuída à
   pessoa**, ligando ao parágrafo de `docs/runner.md` que já enunciava o requisito
   (`runner.md#autonomia-escalonador-e-reinício`, na versão em inglês
   `#autonomy-the-scheduler-and-restarts`). O link entrou no lugar em que a lista de
   issues do gatilho aparece na frase.
2. **Catálogos `src/shared/i18n/ui-team.pt-BR.json` e `ui-team.en.json`.** As **duas**
   chaves do bloco do gatilho mudaram, sem chave nova:
   - `ui.runner.enabledHint` (linha 192): "Ligado, o app começa uma execução para cada
     issue aberta, com o rótulo abaixo e atribuída a você. Começar uma execução à mão
     não depende disto." / "On, the app starts a run for each open issue that carries
     the label below and is assigned to you. Starting a run by hand does not need it."
   - `ui.runner.triggerHint` (linha 253): "A issue precisa estar aberta e atribuída a
     você. Maiúsculas e minúsculas não importam." / "The issue must be open and
     assigned to you. Case does not matter."

   As duas continuam ligadas ao campo em `RunnerSection.tsx` (linhas 66 e 68); nada no
   renderer mudou.
3. **`docs/vcs-providers.md`, nos dois idiomas.** Cada tabela de host (pt-BR linhas
   33-34, inglês 178-179) ganhou uma linha nova, "O gatilho do runner" / "The runner
   trigger", logo abaixo da linha "Lista 'minhas'", dizendo que a leitura que alimenta
   o gatilho é a das issues **abertas atribuídas à pessoa** com o rótulo
   `runner.triggerLabel`, com o filtro de cada host: GitHub `issues?filter=assigned` (ou
   `repos/<proj>/issues?assignee=<usuário>&state=open` com um projeto de issues) e a
   busca `is:issue is:open assignee:@me` por label; GitLab `issues?scope=assigned_to_me`
   com o `state=opened` da própria leitura; Bitbucket `assignee.uuid="<uuid do meu
   usuário>"` com os estados abertos.
4. **`CHANGELOG.md`, `## [Unreleased]` › `### Changed`.** Uma linha visível à pessoa,
   sem referência interna: **The trigger label now says what it needs.**

## O que não foi feito

- Nada de comportamento: o gatilho continua iniciando sozinho só uma issue aberta, com
  o rótulo e atribuída à pessoa, como o código já fazia. Nenhum arquivo de
  `src/main/runner` ou `src/main/vcs` foi tocado.
- Nenhuma tela, mensagem ou aviso novo; o aviso na tela de execuções para issue com o
  rótulo e sem responsável continua na issue 105.
- A linha de `vcs-providers.md` **não** promete que o app reconfere o responsável em
  todo caminho de leitura: o funil comum do runner só acrescenta estado e rótulo sobre a
  lista "minhas", e isso não foi reverificado nesta etapa.

## Verificação nesta etapa

Rodado, e o que voltou:

| Comando | Resultado |
|---|---|
| `npm run i18n:lint` | passou: 4054 chaves nos dois idiomas, 11 catálogos, 0 divergências |
| `node scripts/public-audit.mjs` | passou: 909 arquivos, nada de empresa ou pessoa |
| `npx tsc --noEmit` | passou, sem saída |
| `node scripts/theme-audit.mjs` | passou: 55 pares de contraste ok nos dois temas, 4.5:1 |
| `npx vitest run` | passou numa execução completa, antes dos últimos ajustes de texto: 222 arquivos, 3664 testes |

Os quatro primeiros comandos foram rodados **depois** do último ajuste de texto e
passaram. A suíte completa foi rodada uma vez, antes desse último ajuste; uma segunda
execução, depois dele, foi iniciada e não terminou dentro do tempo de comandos da etapa,
então não há relatório dela. `tsc` e a auditoria de tema não foram rodados depois desse
último ajuste (o ajuste foi só texto de Markdown, e a auditoria pública e o lint de i18n
foram).

Conferência por leitura, no estado final de cada arquivo: os dois trechos de
`docs/configuration.md` (linhas 73 e 221), as quatro chaves dos catálogos (192 e 253 nos
dois), as duas linhas de `docs/vcs-providers.md` (34 e 179) e a entrada do `CHANGELOG.md`
(linha 15). O JSON dos dois catálogos foi aberto e lido pelo Node: válido, 442 chaves em
cada.

**Não verificado:** o comportamento do runner (nenhuma execução foi iniciada), a tela de
Configurações › Runner (nada foi aberto no app) e qualquer host de código real. O texto
não depende disso; ele descreve o que o código já faz.

## Nota do ambiente

Duas gravações de arquivo voltaram como concluídas e o conteúdo foi revertido para o
original; uma delas deixou um bloco duplicado no fim de `ui-team.pt-BR.json`, que foi
reparado. Cada arquivo foi relido depois de gravado e os trechos que faltavam foram
escritos de novo. Vale conferir os seis trechos de novo antes do commit.
