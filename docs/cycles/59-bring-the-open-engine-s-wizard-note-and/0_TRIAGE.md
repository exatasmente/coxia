# Três textos sobre o motor aberto pararam de acompanhar o código

## Que tipo de issue é

Pedido de correção de documentação (docs desatualizadas). Não é bug de comportamento nem pergunta, e não há issue duplicada. Três textos divergem do que o app faz: a nota que o assistente mostra para provedores de motor aberto, a seção de escolha de motor em `docs/llm-providers.md` e a tabela de cobertura de modelos.

## Dá para entender e conferir como está escrita

Dá para entender: a issue diz onde cada texto está, o que ele afirma hoje e qual é o comportamento atual. Só foi lido — nada foi executado, nenhum teste foi rodado e nenhuma tela foi aberta. O que foi conferido lendo o código e os documentos:

- A nota que aparece para todo `kind` que não é Claude (`wizard.models.openEngineNote`, em `src/renderer/src/wizard/steps/ModelsStep.tsx`) diz que o provedor roda no motor aberto com "ferramentas só de leitura". Está errada: `buildTools` (`src/main/engine/open/loop.ts`) entrega `Write` e `Edit` quando a chamada tem raiz de escrita e a ferramenta está em `allowedTools`, `Bash` quando ela consta da lista, e as ferramentas MCP permitidas, entre elas a `Shell` da sandbox, que `agents.ts` acrescenta à lista quando a etapa tem sandbox. Um agente com permissão `worktree` recebe a raiz de escrita e escreve. A segunda frase da nota, sobre a qualidade depender do modelo, continua verdadeira.
- A seção de seleção de `docs/llm-providers.md` (as duas versões linguísticas, por volta da linha 27 em português e da 131 em inglês) chama o gancho de ambiente de "por enquanto a seleção" e diz que "a camada de configuração vai trocar". A camada existe: `LlmProvider` e `RoleModel` (`src/shared/config/types.ts`) têm `kind` e `engine` e o papel aponta o provedor; `engineFor` (`src/main/engine/registry.ts`) resolve isso e `openSelection` (`src/main/agents.ts`) monta a seleção a partir do config. O gancho continua no código (`openEngineFromEnv`, `src/main/engine/open/bridge.ts`) e hoje é descrito como gancho de teste nos comentários. Fatos da seção que derivam do gancho e podem mudar junto: "
  - Os documentos do assistente (`docs/configuration.md`, em português e inglês) e o próprio `bridge.ts` ainda dizem que a camada de configuração vai substituir `openEngineFromEnv`, a mesma afirmação desatualizada da issue — vale decidir se o mesmo trabalho os alcança.
  - A issue pede atualizar a tabela de cobertura "para o que rodou desde então". Não foi encontrada menção, no CHANGELOG nem em `docs/runner.md`, a execuções com modelo real depois das quatro (duas de ~50 chamadas, a US$ 0,3 cada, e mais duas a US$ 0,08 e ~US$ 0,14) que aquela tabela já conta; a própria tabela e a seção "Não verificado" de `docs/runner.md` dizem que só um modelo real foi testado, no runner. Se nada novo rodou, essa parte do pedido não tem o que atualizar e a etapa de implementação deve dizer isso em vez de inventar cobertura.
  - O mesmo texto "testado só contra um servidor falso" aparece nas notas honestas do README (as duas línguas) e no CHANGELOG de 0.1.0; a issue só cita a tabela de `docs/llm-providers.md`. Decidir o alcance é do refinamento, não da triagem.
  - `wizard.models.openEngineNote` existe em dois lugares do repositório, o catálogo real (`src/shared/i18n/wizard.{en,pt-BR}.json`) e uma cópia fixture (`test/fixtures/catalogs-main/wizard.*.json`); conferir se a mudança de texto precisa dos dois.

## O que falta

Nada que só quem abriu a issue possa dizer: os três pontos estão identificados e conferidos no código e nos documentos.

## Issues que parecem duplicadas

Nenhuma. Varri os registros de issue desta pasta: nenhum trata da nota do motor aberto, da seleção de motor em `docs/llm-providers.md` ou da tabela de cobertura.

## Prioridade sugerida

`priority:medium`, como a issue já propõe: é documentação visível (a nota aparece para quem configura um provedor) e não muda código nem corrige defeito de comportamento. Sugestão, não proposta.
