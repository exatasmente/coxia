# Memória do ciclo

## Decisões

- Triagem: pedido de funcionalidade (enhancement), sem duplicatas, sem pergunta. Relacionadas: #208 (esta é o 1º passo), #204 (continua depois), #205 (paralela), #206 (depois de #204 e #205). Prioridade proposta: priority:high — aceite ou recusa é só da pessoa.
- Plano (2_PLAN.md) seguido na codificação: portas lidas no momento do uso, valores de caminho viram funções; um único arquivo novo importa o runtime do desktop e é chamado antes de `installProcessHandlers()`; sem porta preenchida a criptografia fica em recusa fechada; chave-mestre AES-256-GCM, 32 bytes em hex mais quebra de linha, validada em cada operação sem cache; o arquivo da chave nunca é criado nesta mudança; motivo da recusa vem de campo opcional da porta, com a chave `main.secrets.keyFile` nos dois catálogos; nenhuma mudança de configuração e nenhuma entrada no registro de versões.
- Codificado: registro `setCryptoPort`/`setPathsPort`; porta `masterKeyPort`; adaptador `installElectronPorts` como fronteira única do desktop; constantes de caminho viraram funções (`isPackaged`, `resourcesDir`, `sidecarDir`, `claudeBin`, `playwrightMcpCli`, `userDataDir`, `voiceVenvDir`, `voiceModelsDir`, `voiceToolsDir`, `legacyVenvDir`). Desvio do plano: o texto de `main.secrets.keyFile` cobre também a recusa quando a chave não abre os segredos.
- **Revisão (rodada 2) aprovou.** Os dois bloqueantes da rodada 1 são artefactos do nome da pasta da worktree (o identificador da issue começa por `secrets`; a regra de nome do guarda de segredos casa com o caminho absoluto da pasta), não da mudança: os dois arquivos de teste passam 128/128 a partir de pasta neutra e o código das regras não é tocado pela branch.
- Limpezas desta entrega: saiu a constante morta `KEY_BYTES` de `src/main/masterKey.ts` e a linha solta `;` de `test/browser-quit.test.ts`.

## Restrições

- Repositório público: sem nome de empresa ou pessoa real, sem host privado, sem e-mail fora dos domínios reservados. O audit aceita os números 203, 204, 205, 206, 208, 212 e bloqueia outros.
- A regra de nome do guarda de segredos julga o caminho absoluto resolvido contra o diretório de trabalho: uma pasta com `secret`/`token`/`credential` no nome faz os caminhos relativos a ela contarem como segredo. Por isso a suíte desta etapa corre numa pasta neutra.
- Ferramentas de arquivo recusam os catálogos de i18n e os documentos da pasta do ciclo: escrever por comando.
- A suíte desta máquina não tem o pacote do servidor de navegador embutido nem as pastas de sandbox: quatro arquivos falham por isso e não entram no veredito.
- Não existe ainda host sem interface: o consumidor das portas vem de #205/#208.

## Tentado e descartado

- Recalcular a contagem transitiva 131 → 16: não feita; segue não verificada.
- Provar por que o hunk do arquivo removido desaparece nas propostas de conflito: causa isolada (o nome da pasta), não o hunk em si.

## Perguntas abertas

- Nenhuma pergunta técnica: a spec e o plano respondem tudo. A prioridade priority:high continua proposta à pessoa.

## Onde o trabalho está

- Na worktree: os passos 1-7 do plano, cinco arquivos de teste novos, ajustes em três testes existentes, o commit `move secrets and paths behind host ports` (e992bc94), as limpezas e os documentos 0_ISSUE a 4_REVIEW.
- Verificado na revisão: `npx tsc --noEmit` limpo; tema, catálogos (5483 chaves) e auditoria pública (1611 arquivos) verdes; os cinco arquivos das portas 20/20; os dois arquivos apontados na rodada 1 passam 128/128 a partir de pasta neutra; a suíte inteira da pasta neutra 413/420 arquivos, 6913/6934 testes.
- Não verificado: a abertura manual do passo 9 (cofre real do sistema); a contagem 131 → 16; se todas as falhas que sobram são anteriores à branch; se o desktop mostra alguma vez a mensagem nova.
- Próximo passo: verificação e teste com a pessoa, rodando a suíte fora da pasta cujo nome carrega `secret`.
- Passagem support → product-owner: Próxima etapa: refinamento do produto — decidir a prioridade (a sugestão aqui é priority:high) e levar os pontos de projeto que ficaram em aberto (formato, tamanho e geração do arquivo da chave-mestre). Nenhuma resposta está sendo esperada de quem abriu a issue; o código não foi tocado. <!-- handoff:9 -->
- Passagem product-owner → pessoa: Próxima etapa (estimativa/codificação) parte de 1_SPEC.md, que está fechada e sem pergunta pendente. A prioridade foi proposta à pessoa (priority:high, sugerida também na triagem) e ainda não há resposta: só ela aceita ou recusa. Os pontos técnicos em aberto (formato e tamanho da chave-mestre, nome do arquivo da chave e quem o cria quando não existe) decidem-se na codificação e não dependem de quem abriu a issue. Código não foi tocado nesta etapa; contagem transitiva 131 → 16, testes e build continuam não verificados. <!-- handoff:19 -->
- Passagem tl-plataforma → pessoa: Próxima etapa: codificação a partir de 2_PLAN.md — a ordem, cada mudança com arquivo e função, os testes novos e os existentes a ajustar estão todos lá, e os três pontos que a spec deixou em aberto já estão decididos no plano (formato e tamanho da chave, nome do arquivo, quem o cria). Nada foi executado nesta etapa: os portões (tipos, testes, auditorias, compilação) rodam na codificação e a contagem transitiva 131 → 16 segue não verificada. Nenhuma resposta está sendo esperada de quem abriu a issue; a prioridade priority:high segue proposta à pessoa, com aceite ou recusa só dela. <!-- handoff:41 -->
- Passagem developer → revisor-plataforma: Etapa seguinte (verificação): rodar os portões num checkout com as dependências de navegador instaladas — nesta worktree o node_modules é um link para uma loja compartilhada sem o pacote do servidor de navegador embutido, o que derruba quatro arquivos de teste —, fazer a abertura manual do passo 9 do plano (instalação real com segredos gravados e cofre do sistema: lista igual, gravar e usar segredo funcionando, arquivo sem mudança de conteúdo nem de permissão) e conferir se as oito falhas restantes da suíte (construção de propostas de conflito, máscara de resultados de segredo, status de sandb… <!-- handoff:111 -->
- Passagem revisor-plataforma → developer: Revisão da entrega da 203 contra a spec e o plano, com os portões rodados nesta tentativa. O código da mudança (as duas portas, a chave-mestre, o adaptador do desktop e os pontos de chamada) foi lido linha a linha e responde aos critérios de aceite: nenhum dos dois módulos alcança o runtime do desktop nem pelos imports; a chave-mestre valida o arquivo em cada operação, falha fechada e cifra em AES-256-GCM; o arquivo de segredos mantém formato e permissão; as mensagens de recusa são texto fixo dos catálogos e os testes afirmam que a chave não aparece. Tipos, auditoria de tema, catálogos de idio… <!-- handoff:379 -->
- Passagem developer → revisor-plataforma: Os dois bloqueantes da revisão são falsos positivos: a causa é o nome da pasta da worktree (o slug da issue começa com `secrets`), e não a mudança — provado pelas funções de regra do commit de partida `98f1bb95` exercitadas nos dois diretórios e pelos dois arquivos de teste passando 128/128 a partir de pasta neutra. Revisar de um checkout cujo caminho não contenha `secret`/`token`/`credential`, ou rodar a suíte a partir de uma pasta neutra com links para `src`, `test`, `node_modules` e `vitest.config.ts`. Seguem não verificados, como antes: a abertura manual do passo 9 (cofre real do sistema),… <!-- handoff:486 -->
