# Memória do ciclo

## Decisões

- Triagem concluída: pedido de funcionalidade (enhancement), entendível como está escrito, sem duplicatas. Nenhuma pergunta feita (question e reporterQuestion nulos).
- Relacionadas achadas na lista de issues do tracker: #208 (ordem do trabalho sem Electron — esta é o 1º passo, "131 → 16", paralela à #205), #204 (continua depois dela: "After secrets and paths (#203), 16 files ... still reach electron"), #205 (paralela), #206 (depois de #204 e #205).
- Sugestão de prioridade deixada só como sugestão no documento: priority:high (entrada da cadeia do #208, #204/#206 esperam por ela, escopo pequeno com aceite escrito); alternativa medium se o 1.0 não estiver no topo. Campos priority e milestone não preenchidos.

## Restrições

- Etapa só lê: nada alterado na worktree, nenhum teste nem build executado; o commit desta etapa é vazio.
- Conteúdo público do repositório: sem nome de empresa ou pessoa real, sem endereço privado, sem e-mail fora dos domínios reservados. O audit público bloqueia outros números de issue (não os desta linha: 203, 204, 205, 206, 208, 212) e a palavra "Teams" literal.
- Comentário da tracker: sem nomes de arquivo, função ou linha (ficam fora das seções), sem nomes de ferramentas, sem caminhos locais nem comandos; seções vazias quando não há o que dizer.

## Tentado e descartado

- Recalcular a contagem transitiva 131 → 16: não feita (exigiria caminhar o grafo de imports à mão); fica marcada como não verificada.
- Busca de duplicatas no tracker: feita com os termos "headless" e "secrets" e leitura de #208 e #204; achou relacionadas, nenhuma duplicada — não precisa ser repetida.

## Perguntas abertas

- Nenhuma pergunta feita: a issue traz comportamento, formato atual, permissão, comportamento em falha e aceites.
- Em aberto como decisão de projeto (não de quem abriu): formato e tamanho da chave-mestre, nome do arquivo da chave e quem o cria quando não existe.

## Onde o trabalho está

- Entregue em docs/cycles/[redacted]/: 0_TRIAGE.md (tipo, o que foi conferido por leitura, o que ficou não verificado, faltas, relacionadas, sugestão de prioridade) e MEMORY.md reescrita. Nenhuma alteração de código.
- Conferido por leitura/busca nesta etapa: 13 arquivos de src/main importam electron direto; 292 arquivos .ts sob src/main; 7 importam secrets.ts (safeStorage na linha 5, secrets() 37-40) e 8 importam paths.ts (app na linha 2, getPath('userData') 24-26); o bloco keychain ocupa hoje as linhas 13-32 (issue cita 13-28, deriva de linha); createSecretsStore já recebe crypto (SecretsDeps) e cinco arquivos de teste já injetam uma CryptoPort falsa (lidos, não executados).
- Não verificado: contagem transitiva 131 → 16, testes e build.
- Não existe ainda host sem Electron: "headless" no código só aparece ligado ao navegador; o consumidor das portas vem de #205/#208.
- Próximo passo: refinamento do produto (prioridade) e, depois, estimativa; nenhuma espera de resposta.
