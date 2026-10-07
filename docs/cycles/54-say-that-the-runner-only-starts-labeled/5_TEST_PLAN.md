# Plano de testes: a atribuição por responsável aparece onde o gatilho é configurado e lido

## O que é verificado

A issue 54 pede que três lugares que falam do gatilho do runner — a configuração documentada, a dica do campo na tela de Configurações › Runner e o documento de provedores de código — passem a exigir as três condições juntas: a issue **aberta**, com o rótulo e **atribuída à pessoa**. Nada de comportamento muda. Este plano confere que os textos saíram como a especificação pede, nos dois idiomas, e que o restante do app não saiu do lugar.

O que cada texto deve dizer, em palavras do produto:

- a configuração do runner, nos dois idiomas, descreve o gatilho com as três condições juntas e aponta para o parágrafo do documento de execução que já diz isso;
- a dica do campo do rótulo diz que a issue precisa estar atribuída à pessoa e mantém o aviso de que a caixa não importa;
- o documento de provedores de código diz, em cada host, que a lista que alimenta o gatilho é a das issues atribuídas à pessoa, com o filtro de cada host;
- nenhum dos textos diz que o rótulo sozinho basta, e nenhum deles promete que o app reconfere o responsável em todos os caminhos de leitura.

## Cenários

### 1. A configuração documentada descreve as três condições, nos dois idiomas

Abre-se `docs/configuration.md` no bloco `runner`. No pt-BR (linha 73) e no inglês (linha 221) a frase do `enabled` deve dizer que o app inicia execuções sozinho **só para uma issue aberta**, com o rótulo `triggerLabel` (padrão `coxia`, caixa não importa) **e atribuída à pessoa**, e ligar ao parágrafo de `docs/runner.md` que já enuncia o requisito. O link deve apontar para o texto certo (`#autonomia-escalonador-e-reinício` no pt-BR, `#autonomy-the-scheduler-and-restarts` no inglês), e esse parágrafo (linha 60) deve de fato dizer que a lista é a das issues abertas atribuídas à pessoa que levam o rótulo.

Evidência: leitura dos trechos no estado final do arquivo. Resultado: as duas frases estão gravadas como pedido e o link leva ao parágrafo que cumpre o requisito.

### 2. A dica do campo nomeia a atribuição e mantém o aviso de caixa

Abre-se `src/shared/i18n/ui-team.pt-BR.json` e `ui-team.en.json`. A chave `ui.runner.triggerHint` (linha 253 nos dois) deve nomear que a issue precisa estar aberta e **atribuída a você** e manter "Maiúsculas e minúsculas não importam." / "Case does not matter.". A chave `ui.runner.enabledHint` (linha 192 nos dois) deve dizer o mesmo, com o rótulo do campo e a atribuição. As duas continuam sendo as chaves usadas pelo campo, sem chave nova nem texto órfão.

Evidência: leitura das quatro linhas e conferência de que `RunnerSection.tsx` continua referenciando as duas chaves (linhas 66 e 68). Resultado: as quatro frases estão nos dois idiomas, com o mesmo conteúdo, e as duas chaves continuam ligadas ao campo.

### 3. O documento de provedores diz o filtro por responsável de cada host

Abre-se `docs/vcs-providers.md`. Cada tabela de host deve ter uma linha própria ("O gatilho do runner" / "The runner trigger", linhas 34 e 179) dizendo que a leitura que alimenta o gatilho é a das issues **abertas atribuídas à pessoa** com o rótulo `runner.triggerLabel`, e o filtro de cada host: GitLab `issues?scope=assigned_to_me`, GitHub `issues?filter=assigned` ou `repos/<proj>/issues?assignee=<usuário>&state=open` com um projeto de issues, Bitbucket `assignee.uuid` com os estados abertos. O texto não pode afirmar que o app reconfere o responsável em todos os caminhos.

Evidência: leitura das duas linhas e, para confirmar a descrição, leitura dos pontos do código que filtram por responsável em cada host. Resultado: a linha está nos dois idiomas e descreve o que o código de cada host faz.

### 4. Os três textos contam a mesma história, sem prometer mais do que o código faz

Compara-se o conteúdo dos três textos com o parágrafo de `docs/runner.md` (linha 60) e com o funil comum do runner (`src/main/runner/module.ts:35-40`). Todos devem repetir: issue aberta, com o rótulo e atribuída à pessoa. Nenhum deve dizer que o rótulo sozinho basta, e nenhum deve prometer que o responsável é reconferido em todo caminho de leitura — o funil comum lê `listMyIssues` e depois filtra só por `state === 'open'` e rótulo, sem reaplicar a checagem de responsável.

Evidência: leitura cruzada dos textos e do funil. Resultado: os textos são consistentes entre si e com o que o código faz; nenhum promete o filtro como regra geral reaferida no app.

### 5. Nenhuma ação do app mudou e não há tela, mensagem ou aviso novo

Confere-se que a mudança foi só de texto: nenhum arquivo de `src/main/runner` ou `src/main/vcs` foi tocado, nenhuma tela foi criada, nenhuma chave de catálogo nova apareceu e o campo do rótulo continua com o mesmo nome e o mesmo rótulo padrão `coxia`. O aviso na tela de execuções para uma issue com o rótulo e sem responsável continua fora, em outra issue.

Evidência: leitura dos trechos e dos arquivos que os usam. Resultado: só os textos mudaram; nenhuma tela, mensagem ou aviso novo.

### 6. Os gates de qualidade afetados passam

Os comandos que a mudança de fato afeta: o lint de catálogos (não pode haver divergência entre os idiomas), a auditoria pública (os textos precisam ser neutros), o typecheck e a auditoria de tema (nada de código nem de cor mudou). Nenhum é tocado pelos textos, mas todos são gates do projeto.

### 7. A suíte de testes não cai por causa da mudança

A suíte inteira, com atenção aos testes que nomeiam as chaves dos catálogos e aos testes de provedores, que não mudam porque o código não muda.

## Fora do plano

- O aviso na tela de execuções para uma issue com o rótulo e ninguém atribuído, com um jeito de iniciar à mão: fica em outra issue (105) e não é verificado aqui.
- O comportamento do runner contra um host real, e o funil reaplicar ou não a checagem de responsável: não é verificado aqui; o texto não depende disso.
