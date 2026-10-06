# Memória do ciclo

## Decisões

- A issue é pedido de correção de documentação: três textos desatualizados sobre o motor aberto (a nota do assistente, a seção de seleção de `docs/llm-providers.md` e a tabela de cobertura de modelos).
- Nada falta que só quem abriu a issue possa dizer; nenhuma pergunta a quem abriu.
- Nenhuma issue duplicada entre as registradas na pasta.
- Sugestão de prioridade: `priority:medium` (documentação visível; sem defeito de comportamento). Proposta é de quem tem a prioridade, não desta etapa.
- Squad proposto: `experiencia` (a nota é texto de interface; a página de provedores é documentação, sem squad próprio).

## Restrições

- Tarefa de documentação e textos de interface: sem mudança de comportamento no código.
- Nada foi executado nesta etapa; o que a triagem afirma foi lido no código e nos documentos, não rodado.
- Toda string de interface passa por `t()`, com a chave nos dois catálogos; a nota existe no catálogo real (`src/shared/i18n/wizard.{en,pt-BR}.json`) e numa cópia fixture (`test/fixtures/catalogs-main/wizard.*.json`).
- Sem número de issue, nome real, host ou segredo nos textos; audit público vale para docs e comentários.

## Tentado e descartado

- Testar o pedido de cobertura: procura no CHANGELOG e em `docs/runner.md` por execuções novas com modelo real depois das quatro já contadas não achou nenhuma; a hipótese de que a tabela já esteja correta foi guardada como algo a confirmar, não como conclusão.

## Perguntas abertas

- O alcance do pedido de cobertura depende de existir execução nova com modelo real (OpenRouter/DeepSeek) depois das quatro registradas em `docs/runner.md` — melhor perguntar à pessoa do que afirmar que não há.
- Se a cópia fixture dos catálogos precisa acompanhar a mudança do catálogo real (não verificado).

## Onde o trabalho está

- Etapa de triagem concluída; `0_TRIAGE.md` escrito. Não verificado: nenhuma tela foi aberta, nenhum teste foi rodado.
- Pontos conferidos no código: a nota do assistente (`wizard.models.openEngineNote`, em `src/renderer/src/wizard/steps/ModelsStep.tsx`) diz \"ferramentas só de leitura\" para todo `kind` que não é Claude, enquanto `buildTools` (`src/main/engine/open/loop.ts`) oferece `Write`/`Edit` com raiz de escrita, `Bash` da lista e as ferramentas MCP permitidas (a `Shell` da sandbox entra por `agents.ts`); a seleção por config existe (`LlmProvider`/`RoleModel` com `kind` e `engine`, `engineFor` em `src/main/engine/registry.ts`, `openSelection` em `src/main/agents.ts`), e o gancho `openEngineFromEnv` segue no código como auxílio de teste.
- Textos que ainda repetem a afirmação velha e podem entrar no alcance: a mesma frase \"a camada de configuração vai trocar\" em `docs/configuration.md` (pt e en) e no `bridge.ts`, e o \"testado só contra um servidor falso\" no README (pt e en) e no CHANGELOG de 0.1.0.
- Onde segue: implementação dos três textos; depois revisão, QA e a nota de quem abriu a issue.
