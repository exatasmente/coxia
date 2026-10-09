# Memória do ciclo

## Decisões

- Triagem concluiu: issue 170 é pedido de funcionalidade; as alegações sobre o código existente (cofre global sem escopo, sandbox com ambiente vazio, proxy recusando endereços privados, shell de host sem confinamento, redação por padrão) conferem por leitura do código.
- Spec (1_SPEC.md): lista de ambiente de teste por workspace (sobreposição por repositório sequenciada depois); segredos por referência sob prefixo próprio no cofre; QA por padrão, outros tipos opt-in; entrega como variáveis de ambiente do estágio escritas pelo launcher; rede em modo registry, aberta só aos hosts declarados, endereço privado só com marcação explícita; máscara do valor exato (bruto/URL/JSON) em todo texto do estágio; imagens não redigidas e bloqueadas de sair; estágio de host testando o Coxia recebe pasta de dados vazia imposta pelo launcher; confirmação da pessoa (uma por entrada, em auditoria) para segredo não test-only; recusas sempre com motivo.
- Plano (2_PLAN.md, squad plataforma) escrito e verificado contra o código: prefixo de refs de teste `test.` (SECRET_REF não aceita dois-pontos); entrega por `testEnv.ts` `resolveStageTestEnv` chamado em `openStageSandbox`, com vars injetadas na session após `scrubbedEnv`; `ProxyOptions.privateHosts` para o opt-in privado; máscara em módulo novo `maskExact.ts` (formas do precedente de plugins) como objeto por estágio, encadeada antes de `redact` em report/forum/documentos; ledger de confirmação em arquivo próprio do data folder (nunca no config nem no export); recusas de commit/PR/imagem na porta Actions; pasta de dados vazia do Coxia imposta pelo launcher (CERIMONIAS_DATA_DIR/SPECS_DIR zerados e apontados a pastas novas do estágio); migração v20→v21 adiciona a seção vazia, campo `testEnv` em StageDef sem default na migração (templates salvos ficam desligados).

## Restrições

- Issue é especificação funcional; nenhum critério envolve rede ou modelo real fora do computador da pessoa nos testes do repositório (fakes em test/helpers).
- Diferença com pedidos de plugin reconciliada: o valor chega ao app testado dentro do ambiente que o agente também comanda; compensa com máscara exata, bloqueio de imagens e confirmação de efeitos reais.
- Confinamento de arquivos do shell de host (além da pasta de dados vazia do Coxia) fora do escopo.

## Tentado e descartado

- Entrega via arquivo-modelo (.env/config escrita pelo app): descartada; ambiente do estágio é o único canal.
- Sufixo `test:` para refs: não cabe em SECRET_REF.

## Perguntas abertas

- Nenhuma bloqueante; critério de aceite 7 (integração real no computador da pessoa) não é coberto pela suíte do repositório.

## Onde o trabalho está

- 0_TRIAGE.md, 1_SPEC.md e 2_PLAN.md prontos. Plano verificado por leitura de código (secrets-core, sandbox session/host/proxy, executor, types/migrations v20, auditoria, forum-core, errorlog-core, plugins/requests); nada executado nesta etapa. Próxima etapa: implementação pelo squad Plataforma.
- Passagem support → product-owner: Refinement and planning: decide the storage place of the test environment (workspace or workspace plus repository), which stage kinds receive it (QA by default?), the delivery mechanism (stage environment, a file written from a template outside the worktree, or the app's own env secret source for testing Coxia itself), how a secret's declared hosts open the stage network through the registry proxy (including the private-address case), the masking guarantees for exact values across stage text, run file, pull request and paired browser, the handling of screenshots that carry a value, whether tes… <!-- handoff:7 -->
- Passagem product-owner → pessoa: Planejamento e contrato: definir o esquema da seção do ambiente de teste na configuração do workspace, o prefixo do cofre de segredos de teste, a extensão da lista de permissões do proxy do registry (hosts declarados + marcação privado), o ponto do launcher que injeta as variáveis no shell de sandbox e de host, o encadeamento máscara-de-valor-exato antes da redação por padrão em todos os pontos onde o texto do estágio é guardado (conversa, log de auditoria, run file, documentos de estágio, proposta de PR), a recusa de imagens e commits com valor exato, a tela de confirmação de segredo não test… <!-- handoff:11 -->
