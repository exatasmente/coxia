# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade (enhancement), sem duplicatas, sem pergunta. Relacionadas: #208 (esta é o 1º passo, "131 → 16", paralela à #205), #204 (continua depois), #206 (depois de #204 e #205). Prioridade proposta: priority:high — aceite ou recusa é só da pessoa, sem resposta até aqui.
- Plano (2_PLAN.md) seguido na codificação: as portas são lidas no momento do uso e os valores de caminho viram funções; um único arquivo novo importa o runtime do desktop e é chamado como o primeiro comando do corpo do módulo principal; sem porta preenchida a criptografia fica em recusa fechada; chave-mestre AES-256-GCM, 32 bytes em hex mais quebra de linha, validada em toda operação sem cache (recusa: arquivo ausente, link, não regular, bits de grupo ou outros, conteúdo que não seja a chave, caminho dentro da raiz de dados); o arquivo da chave nunca é criado nesta mudança e o caminho dele é argumento da fábrica; o motivo da recusa vem de campo opcional da porta, com a chave nova `main.secrets.keyFile` nos dois catálogos; nenhuma mudança de configuração e nenhuma entrada no registro de versões.
- Codificado nesta etapa (3_IMPLEMENTATION.md detalha passo a passo): registro `setCryptoPort`/`setPathsPort` com encaminhador fixo no módulo de segredos; porta `masterKeyPort` do arquivo de chave; adaptador `installElectronPorts` como fronteira única do desktop; `unavailableReason?()` na porta de criptografia, com a mensagem atual como reserva por chamada; constantes de caminho viraram funções (`isPackaged`, `resourcesDir`, `sidecarDir`, `claudeBin`, `playwrightMcpCli`, `userDataDir`, `voiceVenvDir`, `voiceModelsDir`, `voiceToolsDir`, `legacyVenvDir`).
- Desvio do plano, dito aqui: o texto de `main.secrets.keyFile` cobre também a recusa quando a chave não abre os segredos (a redação do plano falava só de arquivo ausente ou legível por outros). O desktop mantém as mensagens atuais: a asserção sobre a frase do cofre continua valendo.
- Commit previsto: `move secrets and paths behind host ports`.

## Restrições

- Conteúdo do repositório é público: sem nome de empresa ou pessoa real, sem host privado, sem e-mail fora dos domínios reservados. O audit aceita os números 203, 204, 205, 206, 208, 212 e bloqueia outros. A memória anterior trazia a única ocorrência que o audit público acusava nesta árvore (o nome literal de um produto de team chat, citado como exceção): por isso esta versão não o repete e o portão voltou a fechar.
- Comentário da tracker: seções sem nomes de arquivo, função ou linha, sem nomes de ferramentas, sem caminhos locais nem comandos (vão só em technical); palavras da issue citadas em bloco; seção vazia quando não há o que dizer; impessoal.
- Não existe ainda host sem interface: o consumidor das portas vem de #205/#208; nesta mudança existem a porta e o adaptador.
- Ferramentas de arquivo recusam os catálogos de texto (os JSON de i18n): a chave nova entrou por comando, conferida por leitura e por JSON válido. Edições agrupadas no mesmo arquivo perderam trechos no disco: todo arquivo alterado foi reconferido por busca antes dos portões.

## Tentado e descartado

- Recalcular a contagem transitiva 131 → 16: não feita; segue marcada como não verificada.
- Suíte completa rodada nesta etapa: 420 arquivos, 411 verdes, 9 com falha. Quatro dependem de navegador real, de sandbox e do pacote do servidor de navegador embutido, que não está instalado nas dependências ligadas a este worktree (loja compartilhada, só com o núcleo do navegador); quatro caem fora dos módulos alterados e não puderam ser comparados com o estado de antes (sem histórico local); a nona era a auditoria de conteúdo do repositório sobre a palavra da memória antiga e já fecha depois da reescrita. Nenhuma falha vem do typecheck nem dos testes novos.
- Criar o arquivo da chave ou fixar o nome dele dentro do programa: fora desta mudança, como o plano decidiu (ausente é recusa fechada).

## Perguntas abertas

- Nenhuma pergunta técnica: a spec e o plano respondem tudo. A prioridade priority:high continua proposta à pessoa, e só ela aceita ou recusa.

## Onde o trabalho está

- Na worktree: os passos 1-7 do plano, os cinco testes novos (dois módulos sem o runtime, arquivo existente e registro de portas, chave-mestre, caminhos por host, portas do desktop com runtime simulado) e os ajustes em três testes existentes. O documento da etapa vai em 3_IMPLEMENTATION.md.
- Verificado nesta etapa: `npx tsc --noEmit` limpo; 53 testes dos oito arquivos novos ou tocados verdes; suíte completa rodada (resultado acima); portões de tema, i18n e auditoria pública verdes; compilação de empacotamento sem erro. Detalhe do que cada comando imprimiu na comprovação ev-3.
- Não verificado: a abertura manual sobre instalação real com cofre do sistema (passo 9 do plano); a contagem 131 → 16; se as oito falhas restantes da suíte são anteriores a esta mudança.
- Próximo passo: verificação — rodar os portões num checkout com as dependências de navegador instaladas, fazer a abertura manual do passo 9 e deixar a compilação de empacotamento da integração contínua para o fim.
- Passagem support → product-owner: Próxima etapa: refinamento do produto — decidir a prioridade (a sugestão aqui é priority:high) e levar os pontos de projeto que ficaram em aberto (formato, tamanho e geração do arquivo da chave-mestre). Nenhuma resposta está sendo esperada de quem abriu a issue; o código não foi tocado. <!-- handoff:9 -->
- Passagem product-owner → pessoa: Próxima etapa (estimativa/codificação) parte de 1_SPEC.md, que está fechada e sem pergunta pendente. A prioridade foi proposta à pessoa (priority:high, sugerida também na triagem) e ainda não há resposta: só ela aceita ou recusa. Os pontos técnicos em aberto (formato e tamanho da chave-mestre, nome do arquivo da chave e quem o cria quando não existe) decidem-se na codificação e não dependem de quem abriu a issue. Código não foi tocado nesta etapa; contagem transitiva 131 → 16, testes e build continuam não verificados. <!-- handoff:19 -->
- Passagem tl-plataforma → pessoa: Próxima etapa: codificação a partir de 2_PLAN.md — a ordem, cada mudança com arquivo e função, os testes novos e os existentes a ajustar estão todos lá, e os três pontos que a spec deixou em aberto já estão decididos no plano (formato e tamanho da chave, nome do arquivo, quem o cria). Nada foi executado nesta etapa: os portões (tipos, testes, auditorias, compilação) rodam na codificação e a contagem transitiva 131 → 16 segue não verificada. Nenhuma resposta está sendo esperada de quem abriu a issue; a prioridade priority:high segue proposta à pessoa, com aceite ou recusa só dela. <!-- handoff:41 -->
