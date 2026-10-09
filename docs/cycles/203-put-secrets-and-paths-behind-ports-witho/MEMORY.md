# Memória do ciclo

## Decisões

- Triagem (etapa anterior): pedido de funcionalidade (enhancement), entendível como escrito, sem duplicatas, nenhuma pergunta feita. Relacionadas: a ordem do trabalho sem Electron (#208 — esta é o 1º passo, "131 → 16", paralela à #205), #204 (continua depois), #206 (depois de #204 e #205).
- Refinamento entregue: 1_SPEC.md — 8 regras, o que fica fora, 5 critérios de aceite, sem pergunta bloqueante.
- Prioridade proposta à pessoa: priority:high (entrada da cadeia do #208; #204 e #206 esperam). Aceite/recusa é da pessoa; sem resposta até aqui.
- Plano (esta etapa, 2_PLAN.md): as portas ficam num registro lido no tempo de uso e as constantes de caminho viram funções (descartado exportar ligações vivas: congelariam no registro e envelheceriam se a pasta de dados mudar). Um único arquivo novo importa o runtime e é chamado como o primeiro comando do corpo do módulo principal. Sem porta preenchida, criptografia fica em recusa fechada. Chave-mestre: AES-256-GCM, 32 bytes em hex no arquivo, validada em toda operação sem cache (recusa: ausente, não regular, link, bits de grupo/outros, conteúdo inválido, dentro da raiz de dados); arquivo nunca é criado nesta mudança. Nome do arquivo = argumento da fábrica (quem hospeda nomeia). Motivo opcional da porta em nova chave de i18n nos dois catálogos; desktop mantém as mensagens atuais. Nenhuma mudança de configuração (sem migração de tipos/padrão/esquema), nenhuma entrada de versão (nada visível muda). Commit previsto: `move secrets and paths behind host ports`.
- Os três pontos que a spec deixou em aberto estão decididos no plano: formato/tamanho, nome do arquivo, quem cria (ninguém; ausente = recusa).

## Restrições

- Etapas de leitura/plano: nada alterado na worktree, nenhum comando de teste/build concedido; commit vazio e documentos vão pelo campo artifacts.
- Conteúdo do repositório é público: sem nome de empresa ou pessoa real, sem host privado, sem e-mail fora dos domínios reservados. O audit aceita os números 203, 204, 205, 206, 208, 212 e bloqueia outros, e a palavra "Teams" literal.
- Comentário da tracker: seções sem nomes de arquivo, função ou linha, sem nomes de ferramentas, sem caminhos locais nem comandos (vão só em technical); palavras da issue citadas em bloco; seção vazia quando não há o que dizer; impessoal.
- Não existe ainda host sem interface: o consumidor das portas vem de #205/#208.
- Ferramenta recusou caminhos de configuração nesta etapa: docs/ (inclusive a guia de i18n), scripts/ e arquivos de configuração não puderam ser lidos; a localização dos catálogos se resolve pela guia de i18n na codificação.

## Tentado e descartado

- Recalcular a contagem transitiva 131 → 16: não feita (exigiria caminhar o grafo de imports à mão). Fica marcada como não verificada, nunca como concluída.
- Busca de duplicatas no tracker: feita na etapa anterior com "headless" e "secrets"; não repetir.
- Glob/listagem em docs/cycles, scripts e i18n: recusados pela ferramenta (fora do alcance da cerimônia).
- Descartadas no plano: ligações vivas para manter constantes; variável de ambiente para o nome da chave (a fábrica recebe o caminho); fazer a porta parecer disponível e recusar só na operação (mentiria o estado); automação do cofre real (fica em verificação manual).

## Perguntas abertas

- Nenhuma pergunta feita (question nulo): a issue traz comportamento, formato atual, permissão, falha e aceites; os pontos técnicos abertos foram decididos no plano. Só a prioridade priority:high aguarda aceite ou recusa da pessoa.

## Onde o trabalho está

- docs/cycles/[redacted]/: 0_TRIAGE.md, 1_SPEC.md, 2_PLAN.md (esta etapa) e MEMORY.md. Sem alteração de código; commit vazio.
- Conferido por leitura/busca nesta etapa (base da comprovação ev-2): 13 importações diretas do runtime em src/main; 7 importadores do módulo de segredos e 8 do de caminhos; nenhuma chamada da loja no nível de módulo; as duas leituras apressadas em nível de módulo são o script da voz (voice.ts:17, usado só dentro de função) e `defaults.bundled` (claudeSdk.ts:31); o fecho dos dois módulos dispensa o runtime além dos dois imports a remover; testes ligados aos nomes antigos: voice-gating (simulação), browser-quit (linhas 6 e 36), build-profiles (linha 39); os testes chamam a loja singleton só com fontes de ambiente/comando; test/secrets.test.ts:79 exige a frase atual do cofre.
- Não verificado: testes, portões, compilação, contagem transitiva 131 → 16.
- Próximo passo: codificar pelo 2_PLAN.md na ordem dele (passos 1-4 segredos e chave, 5-6 caminhos, 7 testes existentes, testes novos, 8 portões, 9 manual). Nenhuma espera de resposta técnica; prioridade segue com a pessoa.
- Passagem product-owner → próxima: spec fechada, nenhum bloqueio; prioridade proposta à pessoa (priority:high). <!-- handoff:10 -->
- Passagem support → product-owner: refinamento feito; pontos técnicos decididos no plano de codificação. <!-- handoff:9 -->
- Passagem product-owner → pessoa: prioridade priority:high proposta, só a pessoa aceita ou recusa; código não foi tocado nas etapas de planejamento. <!-- handoff:19 -->
