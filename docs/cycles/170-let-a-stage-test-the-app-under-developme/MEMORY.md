# Memória do ciclo

## Decisões

- Triagem concluiu: issue 170 é pedido de funcionalidade, compreensível como está; as alegações sobre o código existente (cofre de segredos global sem escopo, sandbox com ambiente vazio e rede off/proxy/open, shell de host sem confinamento, redação por padrão) conferem por leitura do código.
- Squad: plataforma; prioridade:high proposta (QA é o primeiro consumidor e hoje não consegue exercer integração real); marco proposto: test environment for QA stages.
- Refinamento concluído (1_SPEC.md): lista de ambiente de teste por workspace (sobreposição por repositório sequenciada depois); segredos por referência sob prefixo próprio no cofre; QA recebe por padrão, outros tipos opt-in; entrega como variáveis de ambiente do estágio escritas pelo launcher, sem mecanismo de arquivo-modelo; rede em modo registry, aberta só aos hosts declarados, endereço privado só com marcação explícita; máscara do valor exato (bruto/URL/JSON) em toda parte onde o texto do estágio é guardado ou mostrado, com a redação por padrão encadeada depois; imagens não redigidas e bloqueadas de sair do computador; estágio de host testando o Coxia recebe pasta de dados vazia imposta pelo launcher; confirmação da pessoa (uma vez por entrada, registrada em auditoria) para segredo não marcado test-only; recusas sempre com motivo.

## Restrições

- Issue é especificação funcional; nenhum critério envolve rede ou modelo real fora do computador da pessoa nos testes.
- Diferença com pedidos de plugin reconciliada: aqui o valor chega ao app testado dentro do ambiente que o agente também comanda; compensa-se com máscara exata em todo texto, bloqueio de imagens e confirmação de efeitos reais.

## Tentado e descartado

- Entrega via arquivo-modelo (.env/config escrita pelo app): descartada; ambiente do estágio é o único canal nesta mudança.
- Confinamento de arquivos do shell de host para apps que não o Coxia: fora do escopo desta mudança.

## Perguntas abertas

- Nenhuma bloqueante; sobreposição por repositório no mesmo lote ou depois fica para o planejamento.

## Onde o trabalho está

- 0_TRIAGE.md e 1_SPEC.md escritos. Comportamento de hoje verificado por leitura de código (triagem); nada executado nesta etapa. Próxima etapa: planejamento/contrato técnico pelo squad Plataforma.
- Passagem support → product-owner: Refinement and planning: decide the storage place of the test environment (workspace or workspace plus repository), which stage kinds receive it (QA by default?), the delivery mechanism (stage environment, a file written from a template outside the worktree, or the app's own env secret source for testing Coxia itself), how a secret's declared hosts open the stage network through the registry proxy (including the private-address case), the masking guarantees for exact values across stage text, run file, pull request and paired browser, the handling of screenshots that carry a value, whether tes… <!-- handoff:7 -->
