# As imagens do README e das páginas saem de um workspace fictício, e o release as refaz

## Tipo

Pedido de funcionalidade. Não relata defeito, não é pergunta e não repete outra issue: pede que as imagens da documentação deixem de ser uma lista de "a fazer" e passem a ser tiradas do próprio aplicativo, por um agente, de um workspace semeado com dados fictícios, um script por funcionalidade, e que a passagem de release as refaça para não ficarem atrás das telas.

## Dá para entender como está escrita

Dá para entender como está escrita. O comportamento pedido tem forma de comportamento (o que o workspace semeado contém, o que uma captura faz, onde a lista de funcionalidades mora, o que muda no fluxo de release, o que a checagem compara) e uma seção de aceitação com seis condições verificáveis. Nada aqui foi executado: a conferência foi só de leitura, contra a árvore do repositório.

O que foi conferido por leitura, e que a issue descreve como o estado de hoje:

- **A tela virtual.** Ela já não depende apenas do tipo de saída do stage. Um stage que produz a saída de QA a ganha, um agente com a chave de tela ligada a ganha em qualquer etapa, e há um pedido explícito de tela (`wantsDisplay`) na abertura da sessão: `src/main/runner/executor.ts:440` (`outputKindOf(stage.kind) === 'qa' || (own && agent.screen === true && …) || wantsDisplay`). O pedido é usado hoje na abertura do sandbox de um agente chamado numa conversa de execução e não vem de um campo do fluxo; nenhum template declara um stage que queira tela.
- **O campo `display` existe, mas é da sandbox do espaço de trabalho.** `runner.sandbox.display` (esquema 26) faz a sandbox de um stage de QA subir um Xvfb e definir `DISPLAY` (`src/shared/config/schema.ts:568`, `src/shared/config/types.ts:902-903`, padrão `false` em `src/shared/config/defaults.ts:26`); para um agente `shell: host` o app sobe uma tela própria (`src/main/sandbox/display.ts:21`, `1280x800`, `-nolisten tcp`) e não pede o "sim" de um comando. A flag por stage que a issue pede não existe: `StageDef` (`src/shared/config/types.ts:302-337`) não tem esse campo, e o veredito de tela do executor não recebe a etapa.
- **O fluxo de release não tem onde encaixar a regeneração.** Os stages declarados (`src/shared/cycles/templates/releaseFlow.ts:15-33`) vão de planejar/gate a montar a branch, cortar a beta, esperar a beta no host, o dia de feedback, o gate da estável, cortar a estável, esperar a estável e publicar; nenhum é de documentação. Não há um stage de documentação onde uma regeneração de imagens caiba.
- **O fluxo de documentação existe, mas é de outro assunto.** `docs-flow` (`src/shared/cycles/templates/docsFlow.ts:18-26`) é sobre o `AGENTS.md` da raiz: esboçar, gate, aplicar, esperar o merge. Não toca em imagens nem em documentação de telas.
- **O corte é um passo único, que sempre espera o "sim".** `scripts/release.sh` roda as conferências do CI, incrementa `package.json` e `package-lock.json`, move/acha a seção do `CHANGELOG.md`, commita um commit por corte, cria a tag anotada e para (`scripts/release.sh:355-390`). Ele recusa uma árvore suja antes (`scripts/release.sh:361`) e para antes de imprimir os pushes (`scripts/release.sh:407-417`). A decisão D18 do projeto põe `beta` e `stable` sempre atrás do "sim" da pessoa em Ações, mesmo com o Release manager autônomo (`docs/runner.md:220`; etapa 3 de `RELEASING.md`). Ou seja: não existe hoje um ponto "depois do incremento e antes das notas finais" no fluxo, e regenerar imagens antes do corte cairia na recusa por árvore suja.
- **As telas existem e as fixtures são por teste.** O caminho de teste de interface existe desde a 0.8.0 (pasta de navegadores por `PLAYWRIGHT_BROWSERS_PATH`, tela virtual, `ViewImage` da pasta de saída da etapa; `docs/runner.md:132`), e há um auxiliar de arranque de Electron para testes (`test/helpers/electron.ts:1-3`). Os dados de cada tela vivem em fixtures locais de cada teste.
- **`docs/images/` guarda um único arquivo.** O README da pasta (`docs/images/README.md:3-11`) lista cinco capturas como pendentes, e os dois READMEs trazem a mesma tabela marcada como pendente (`README.md:9-17`, `README.pt-BR.md:9-17`); o índice de documentação aponta a pasta como "as capturas planejadas" (`docs/README.md:35`). Não há `scripts/seed-docs-workspace.mjs` nem `scripts/captures/`: a pasta `scripts/` não tem nada parecido (saída — a lista dos scripts do repositório vai de `i18n-lint` a `verify-release-*`).
- **A auditoria pública aceita ser apontada para uma pasta.** O uso por CLI é `node scripts/public-audit.mjs [--root <dir>]`, e o cabeçalho diz que o `--root` é o usado pelos testes (`scripts/public-audit.mjs:4-6`, resolução em `:184-185`); sem ele, a varredura é a árvore do repositório (`git ls-files --cached --others --exclude-standard`, `:148-170`). Uma pasta fora da árvore não exige entrada no `.gitignore` para isso funcionar. Para um caminho que ficasse dentro da árvore, seria só a lista de permissão em `scripts/public-audit.allow.json` a resolver, e a varredura respeita o `.gitignore` pelo `--exclude-standard`.
- **O arquivo binário é conferido só pelo caminho.** `scripts/public-audit.mjs:109-131`: um conteúdo binário é pulado no conteúdo e conferido pelo nome do arquivo. A auditoria passa hoje sobre `docs/images/` porque a pasta só tem o README em texto.

A resposta registrada na issue (o comentário do time logo abaixo da pergunta do revisor) confirma o que a leitura acima mostrou: a pasta semeada fica **fora do repositório**, descartável; o que o repositório versiona é o script de semeadura e o de captura; a aceitação "a auditoria pública passa na pasta que ele escreveu" se confere **apontando** a auditoria para a pasta com `--root <dir>`, que já existe e é usado pelos testes. A pasta não deve ficar na árvore nem ignorada: `--exclude-standard` esconderia uma pasta ignorada da varredura. Isso tira do caminho a única dúvida que a triagem tinha posto em question. Como era uma conversa entre agentes do time, não uma resposta da pessoa, **foi conferido antes de escrever**: os dois arquivos foram lidos (`docs/cycles/221-.../0_ISSUE.md` e `0_TRIAGE.md` na cópia em que o time trabalhou).

## O que falta

Para entender como está escrita, nada: quem abriu já respondeu a única dúvida que era dela, e a pergunta pendente na conversation (o caminho da pasta semeada) está respondida.

O que falta é decisão de desenho do refino, e uma delas é grande porque toca uma regra fixa do projeto:

- **Onde a regeneração entra no fluxo de release.** A issue pede "depois da versão incrementada e antes de as notas de release fecharem", e esse ponto não existe. `scripts/release.sh` faz incremento, changelog, commit e tag de uma vez, dentro de um passo que sempre espera o "sim" e recusa árvore suja; uma etapa de fluxo que regenerasse imagens antes de o corte rodar cairia na recusa, e depois do corte já tem tag. Há mais de uma saída (a regeneração depois do corte, num step novo, antes do push; ou as imagens entrarem no release pela rota do pull request, como qualquer outra mudança), e escolher uma é do refino, não da triagem.
- **Se a flag de tela vai para o stage do fluxo ou para o agente.** A pergunta já está na issue e a decisão D18 do projeto é o pano de fundo dela: o agente já carrega `screen`, `allowedHosts` e `browserProfile`, e um stage não tem campo de tela hoje. O pedido é que fique no stage do fluxo; a decisão é do refino.
- **A primeira lista de funcionalidades.** O README pede cinco ou seis e o site quer mais; a issue pede que a lista seja um arquivo (`scripts/captures/index.json`) e deixa a lista em aberto. Repare que hoje a lista de pendências do README tem cinco itens, mas um deles é o assistente de configuração, que a própria issue nota que abre com um `CERIMONIAS_DATA_DIR` vazio (a primeira tela do pedido já existe sem semente).
- **O ponto de captura da tela do celular.** A issue diz "do modo web a 390 px", e a leitura mostra que esse ponto não é óbvio: um agente com a tela ligada recebe o **navegador do app** (Playwright MCP), que não é a mesma coisa que o app empacotado num launcher de Electron. Qual das duas rotas serve cada captura é decisão de desenho.
- **A plataforma em que a captura roda.** A tela virtual do projeto é Linux (`docs/runner.md:132-133`), a tela da pessoa nunca é usada, e o release publica para Linux e Windows: quem captura numa máquina de outra plataforma é decisão de desenho.
- **O verde da checagem de CI.** A aceitação pede que o que é referenciado e o que existe não divirjam, mas não diz em que job do fluxo de integração contínua isso entra. Hoje as conferências correm no job "Typecheck, tests and build" (`.github/workflows/ci.yml:17-52`), e a resposta sobre a pasta semeada (fora do repositório) decide se a checagem é local ou também na CI.

As dúvidas que a própria issue listou para o refino (o relógio fixo, se a semeadura serve também aos testes, um ou dois temas, a flag no stage ou no agente) continuam abertas e são do refino: nenhuma delas impede entender o pedido.

## Issues relacionadas

- #220 (o site de documentação no pages do host de código): a issue diz que alimenta essa. Relacionada, não duplicata — #220 publica o site, esta entrega as imagens que ele usa.
- As páginas de documentação que já prometem capturas (`docs/images/README.md` e os dois READMEs) não são uma issue, mas dependem desta: enquanto ela não fizer as imagens, a tabela fica marcada como pendente.
- Nenhuma outra pasta de ciclo desta cópia trata do mesmo pedido. A busca foi feita nos documentos de ciclo da cópia (título e conteúdo por "site", "capturas", "imagens" e "documentação"); não foi feita uma busca por issues além do que a issue cita e do que existe na cópia de trabalho.

## Squad

`Plataforma`. O que o pedido mexe é o runtime: semeadura de workspace, captura por Playwright dentro de uma etapa de fluxo, a tela virtual que uma etapa não-QA hoje não recebe, o fluxo de release e a auditoria do repositório. Nada aqui é tela do aplicativo nem texto de interface.

## Prioridade sugerida

`priority:medium`, como sugestão a quem decide. Sem imagem a documentação fica com promessas no lugar de telas, mas nenhuma instalação quebra: hoje a pasta só tem a página de regras, e o trabalho é grande (semeadura, scripts de captura, flag de tela, etapa de release, checagem de CI, as imagens em si), então não é `high`.

## O que esta triagem não fez

Não reproduziu nem exercitou nada, e não propôs solução nem decidiu prioridade. Tudo o que está dito como existente foi lido em arquivo desta cópia de trabalho; o que não foi lido está marcado como não verificado. Não foi verificado: que a aplicação abra o workspace semeado sem aviso de migração, que uma captura produza imagens iguais byte a byte em duas execuções, e que uma etapa com tela guarde a imagem como comprovação e a veja com a ferramenta de imagem — as três são condições de aceitação de quem implementar, não algo que esta etapa tenha exercitado.

A nota de lançamento é material de quem mexe no código: a entrada da versão que a issue pede para o usuário entra no arquivo de mudanças do repositório na etapa que implementa, ou no fecho do ciclo, e por isso não é um documento desta etapa.
