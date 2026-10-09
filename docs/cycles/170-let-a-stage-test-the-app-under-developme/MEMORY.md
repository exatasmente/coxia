# Memória do ciclo

## Decisões

- Triagem concluiu: issue 170 é pedido de funcionalidade; as alegações sobre o código existente (cofre global sem escopo, sandbox com ambiente vazio, proxy recusando endereços privados, shell de host sem confinamento, redação por padrão) conferem por leitura do código.
- Spec (1_SPEC.md): lista de ambiente de teste por workspace (sobreposição por repositório sequenciada depois); segredos por referência sob prefixo próprio no cofre; QA por padrão, outros tipos opt-in; entrega como variáveis de ambiente do estágio escritas pelo launcher; rede em modo registry, aberta só aos hosts declarados, endereço privado só com marcação explícita; máscara do valor exato (bruto/URL/JSON) em todo texto do estágio; imagens não redigidas e bloqueadas de sair; estágio de host testando o Coxia recebe pasta de dados vazia imposta pelo launcher; confirmação da pessoa (uma por entrada) para segredo não test-only; recusas sempre com motivo.
- Plano (2_PLAN.md, squad plataforma) aprovado; ordem de implementação: schema+migração, resolver, injeção sandbox/host, opt-in privado do proxy, máscara, frase de prompt, recusas de Actions, confirmação, editor de Settings.
- Implementação (em curso, tentativa 2, interrompida): schema 21 com migration v20→v21, testEnv em StageDef e testEnvironment em WorkspaceConfig (types/defaults/schema/validate), módulos novos src/main/testEnv.ts (resolver + ledger de confirmação) e src/main/maskExact.ts (precedente de plugins), entrega de variáveis via OpenOptions.testEnv → spec do sandbox aplicada por último e via host.ts sobre o scrub (pastas CERIMONIAS_DATA_DIR/SPECS_DIR vazias dentro da pasta descartável da sessão), ProxyOptions.privateHosts, editor de recusas em executor.ts (fórum + auditoria) e máximo da config por estágio em modo registry só quando há entradas.

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

- Código escrito na worktree (comando git status mostra 4 arquivos de config e os módulos de máscara/ambiente de teste), mas NENHUM comando verificador rodou nesta tentativa: tsc, testes e gates todos não verificados; testes e fio do ledger, frase de prompt, varredura de Actions e editor de Settings por fazer (lista no handoff). Próxima etapa: terminar implementação, começando por npx tsc --noEmit.
- Passagem support → product-owner: Refinement and planning: decide the storage place of the test environment (workspace or workspace plus repository), which stage kinds receive it (QA by default?), the delivery mechanism (stage environment, a file written from a template outside the worktree, or the app's own env secret source for testing Coxia itself), how a secret's declared hosts open the stage network through the registry proxy (including the private-address case), the masking guarantees for exact values across stage text, run file, pull request and paired browser, the handling of screenshots that carry a value, whether tes… <!-- handoff:7 -->
- Passagem product-owner → pessoa: Planejamento e contrato: definir o esquema da seção do ambiente de teste na configuração do workspace, o prefixo do cofre de segredos de teste, a extensão da lista de permissões do proxy do registry (hosts declarados + marcação privado), o ponto do launcher que injeta as variáveis no shell de sandbox e de host, o encadeamento máscara-de-valor-exato antes da redação por padrão em todos os pontos onde o texto do estágio é guardado (conversa, log de auditoria, run file, documentos de estágio, proposta de PR), a recusa de imagens e commits com valor exato, a tela de confirmação de segredo não test… <!-- handoff:11 -->
- Passagem tl-plataforma → pessoa: Implementation by squad Plataforma, in the order of 2_PLAN.md section 2: schema+migration first, then resolver, sandbox/host injection, proxy private opt-in, masking module and its attach points, prompt sentence, Actions refusals, confirmation gate, Settings editor. Each module ships with its named test file; the real-key acceptance scenario (spec criterion 7) belongs to the person's machine, not the repository's suite. <!-- handoff:23 -->
