# Um conjunto de modelos por papel: o provedor ocupado não derruba a etapa

> **Nota (renumeração):** ao trazer a `release/0.9.0` (0.9.0-beta.13), o esquema 25 já era de outro trabalho (`runner.unconfined`, #230). Onde este texto diz `v24ToV25` ou "esquema 25" para o conjunto de modelos, leia `v25ToV26` e "esquema 26"; a seção "Renumeração para o esquema 26" de `3_IMPLEMENTATION.md` explica. O texto abaixo fica como foi escrito.

## O que se pede

Hoje uma etapa falha quando o provedor recusa por limite de taxa ou por sobrecarga
("Model busy, retry later"), mesmo com outros modelos do mesmo provedor, ou de outro,
livres. A recusa é por modelo: tentar de novo no mesmo modelo continua falhando, e a pessoa
aperta "Tentar de novo" à mão. A issue pede:

> Each LLM role keeps an ordered **pool** of models (provider + model), from the cheapest to the most expensive. When a model is busy, the call moves to the next one in the pool and the stage goes on. Within a role, each **activity** of an agent [...] can have its own pool.

E que o conjunto seja **sugerido a partir do catálogo do provedor**, onde ele publica um, e
que o cliente da API pare de repetir o mesmo modelo sem limite quando o servidor manda
`Retry-After`.

## Onde as coisas estão hoje

| O quê | Hoje | Onde |
|---|---|---|
| Modelo por papel | um só: `llm.roles[papel] = { provider, model }` | `src/shared/config/types.ts:90`, `:96` |
| Modelo de um agente do time | um papel emprestado, ou um provedor e modelo próprios | `types.ts:517-523`, `src/main/config-resolve.ts:177` |
| Recusa por taxa ou sobrecarga | 429 vira `rate_limit`, 503/529 vira `overloaded`, ambos repetíveis | `src/main/engine/open/errors.ts:89-117` |
| Repetição do cliente | até `maxRetries ?? 2`; **com `Retry-After` o contador não sobe** e a repetição não tem fim até o limite de 15 min da chamada | `src/main/engine/open/client.ts:270` |
| Troca de modelo | não existe: o laço recebe um cliente, de um modelo | `src/main/engine/open/loop.ts:64`, `:239` |
| Falha da etapa | o erro do modelo vira o texto de falha; só `turns` e `budget` têm tratamento próprio | `src/main/runner/executor.ts:1185`, `src/main/runner/service.ts:682` |
| Uso por chamada | a sessão grava o modelo de cada resposta; o registro da etapa não guarda modelo | `src/main/engine/open/session.ts:19-23`, `src/shared/runs/types.ts:84` |
| Teste de conexão | testa **um** modelo e lista os ids; lê `context_length` do catálogo, mais nada | `src/main/engine/open/probe.ts:75-86` |
| Motor Claude (SDK) | 429 só aparece como texto da resposta | `src/main/agents.ts:732` |

## O que a issue entrega

1. **Conjunto por papel.** Cada um de `turn`, `reply`, `deep`, `teams`, `fix` e cada agente
   do time com modelo próprio guarda uma lista ordenada. A primeira entrada é o modelo de
   hoje; o resto são reservas. Do mais barato ao mais caro. Um agente que empresta o modelo
   de um papel usa o conjunto desse papel.
2. **Troca no meio da etapa.** Esgotadas as repetições do cliente, uma recusa por taxa ou
   sobrecarga passa a chamada para o próximo modelo, **na mesma sessão** do motor aberto: o
   histórico é reenviado ao novo modelo e só o cache de prompt se perde. A etapa segue sem
   clique.
3. **Descanso do modelo ocupado.** O modelo que recusou descansa no app inteiro pelo
   `Retry-After` do servidor, ou por um tempo padrão (proposta: 5 minutos), e as outras
   execuções o pulam. Volta depois do descanso. O descanso vive na memória: reiniciar o app
   o esquece.
4. **Conjunto esgotado.** Todos ocupados: a etapa falha como hoje, com uma mensagem que cita
   o **conjunto** (os modelos e quando o primeiro volta), não um modelo só.
5. **Modelo por atividade.** Dentro de um papel, cinco atividades podem ter lista própria:
   `explore` (ler e buscar), `edit` (escrever e editar), `shell` (saída de comando), `screen`
   (a tela virtual, que precisa de imagem) e `write` (começo de etapa, cerimônias e
   documentos). Atividade sem lista usa a do papel. A atividade de um turno vem do que ele
   responde: o tipo dos resultados de ferramenta da última mensagem; o primeiro turno de uma
   etapa, e as chamadas de fechamento da resposta, são `write`. `screen` só roda em modelo
   que aceita imagem.
6. **Sugestão a partir do catálogo, com piso de qualidade por atividade.** O teste de
   conexão lê preço, contexto e etiquetas do catálogo do provedor, quando ele traz (o
   `/models` de servidores compatíveis com OpenAI que publicam `metadata`), e sugere um
   conjunto por papel e atividade: só modelos com ferramentas e saída estruturada e contexto
   suficiente, ordenados pelo custo estimado de uma etapa típica **entre os que passam do
   piso daquela atividade**; o que fica abaixo do piso vai depois dos que passam, ou sai da
   lista. O piso vem de uma tabela pequena e versionada de notas por atividade, que o app
   traz e a pessoa pode sobrescrever (nunca buscada em tempo de execução, nunca de um
   endereço de um provedor): `shell` usa uma nota tipo Terminal-Bench, `edit` uma nota de
   alteração de repositório tipo SWE, `screen` uma nota tipo OSWorld (e exige imagem);
   `explore` e `write` não têm piso (ordem de preço, mas ver a decisão 10). A tabela mapeia id de modelo para nota
   por atividade e nomeia a fonte; modelo fora da tabela não tem nota e vem depois dos que
   têm, em `edit` e `shell`. Exemplo do resultado pretendido: em `shell` e `edit` um modelo
   mais forte e um pouco mais caro (por exemplo 90,6 contra 87,6 no Terminal-Bench 2.1;
   74,2 contra 67,9 em refatoração de repositório) passa à frente do mais barato; em
   `screen` vai primeiro o modelo com imagem mais barato que tem 80,8 no OSWorld-Verified.
   **Esses números são autodeclarados pelos fornecedores dos modelos**, servem de piso e de
   desempate, não de garantia, e a pessoa reordena como quiser. A pessoa revisa e salva;
   **nada é salvo sozinho**.
7. **Visível.** Cada troca aparece na conversa da execução (qual modelo estava ocupado, qual
   assumiu, até quando descansa). O uso de cada chamada mantém o modelo que respondeu.
8. **Correção do cliente.** O `Retry-After` conta como uma tentativa; o cliente nunca repete
   um modelo além do limite, com ou sem o cabeçalho.
9. **Raciocínio por modelo.** Alguns modelos de raciocínio exigem receber de volta o
   `reasoning_content` dos turnos anteriores nas chamadas de ferramenta em vários turnos. Hoje
   o cliente o tira, a menos que tenha aprendido o contrário por um erro 400. Passa a ser
   por modelo: quando o catálogo (etiqueta `reasoning`) ou o teste de conexão diz que o
   modelo raciocina, o cliente o devolve desde a primeira chamada, e a escolha fica gravada
   com a entrada do modelo, então sobrevive ao reinício. Depois de uma troca, o raciocínio
   escrito pelo modelo A **nunca** vai ao modelo B (os formatos diferem): é descartado ao
   mudar de modelo.
10. **Motor Claude.** Uma entrada do conjunto no SDK só serve **no começo** de uma etapa
   (escolhida antes de ela abrir a sessão); nunca no meio de uma sessão do motor aberto,
   nem o contrário.

## Como fica na tela

- **Passo "Modelos" do assistente:** cada papel ganha, abaixo do seletor de hoje, a lista de
  reservas (adicionar, remover, subir, descer) e, recolhidas, as listas por atividade. Cada
  linha mostra provedor, modelo, preço, contexto e, quando a tabela tem, a nota e a fonte.
- **Depois do teste de conexão:** o quadro "Conjunto sugerido", com o custo estimado de uma
  etapa por modelo e a marca "não verificado" onde o catálogo não disse se há ferramentas ou
  saída estruturada. "Usar a sugestão" copia para o rascunho da tela; o "Salvar" é o de hoje.
- **Editor de agente:** modelo próprio ganha as mesmas listas; modelo emprestado mostra "usa o
  conjunto de <papel>". **Conversa da execução:** "O modelo A estava ocupado; o B assumiu (A
  descansa até 14:05)."; sem nenhum disponível, a falha nomeia o conjunto.

## Regras

- **Workspace existente não muda.** Sem lista de reservas nada é trocado e nada na tela
  muda, a não ser o campo vazio de reservas. A migração do esquema só sobe a versão e
  **não liga nem levanta permissão alguma**.
- **A reserva é um modelo que a pessoa já cadastrou.** Cada entrada aponta um provedor que
  existe em `llm.providers`; a troca nunca leva o conteúdo de uma etapa a um endereço que a
  pessoa não configurou. Um celular pareado não edita configuração (`paired-phone`).
- **Só recusa por taxa, sobrecarga ou erro 5xx do servidor troca de modelo.** Chave inválida, orçamento esgotado
  (a espera que já existe), modelo inexistente e erro do pedido seguem como hoje.
- **Nenhuma troca perde o resto da regra de segurança:** ferramentas, confinamento e filtro
  de segredo são os da sessão, não do modelo.
- **Texto novo** passa por `t()` com a chave nos dois catálogos; cores só por tokens.

## Critérios de aceite

1. Recusa de ocupado no primeiro modelo do conjunto leva a etapa ao seguinte, sem clique, e a
   conversa diz isso.
2. O modelo ocupado é pulado por outras execuções enquanto descansa e volta depois.
3. Conjunto todo ocupado falha a etapa com mensagem que nomeia o conjunto.
4. Um turno que responde a uma captura de tela só roda em modelo com imagem.
5. A sugestão ordena por custo estimado entre os modelos que passam do piso da atividade,
   deixa de fora modelo sem ferramentas ou sem saída estruturada, mostra a nota e a fonte
   ao lado de cada entrada; a pessoa salva explicitamente.
6. Workspace sem conjunto se comporta como antes; o esquema migra sem subir permissão.
7. O cliente não repete um modelo além do limite, com ou sem `Retry-After`.
8. Um modelo de raciocínio devolve o seu `reasoning_content` desde a primeira chamada e,
   depois de uma troca, o novo modelo não o recebe.
9. Uma etapa do motor aberto que troca de modelo termina com o histórico inteiro na mesma
   sessão, e o `.jsonl` da sessão mostra o modelo de cada resposta.

## Modos de uso do conjunto

A troca por atividade (itens 5 e 2 acima) perde o cache de prompt a cada troca, e um modelo mais barato que recebe o histórico inteiro só para editar um arquivo gasta o que economizou. Por isso a pessoa escolhe **como** o conjunto é usado, entre três modos:

| Modo (`poolMode`) | Nome na tela | O que faz |
|---|---|---|
| `fallback` | Só reserva | Um modelo. O conjunto só entra quando o modelo em uso está ocupado. Nenhuma troca por atividade; uma volta de tela nunca vai a modelo que se sabe sem imagem. |
| `switch` | Trocar por atividade | O que as partes anteriores entregam: cada volta vai ao modelo da lista da sua atividade (fica no em uso se ele alcança o piso). |
| `delegate` | Principal com subagentes | O modelo principal fica fixo e guarda o seu cache (só reserva por ocupado, mais a regra da imagem). Edição, comando e tela vão a subagentes, cada um no modelo da lista da atividade dele. |

**Onde se escolhe, e quem vence.** O agente do time (campo novo de `agents.team[]`), depois a etapa do modelo de ciclo (campo novo da etapa), depois o padrão do workspace (`llm.poolMode`, no passo "Modelos"). Vazio = herda do próximo. Cerimônia e `@menção` não têm etapa: vale o agente (na cerimônia, o agente de sistema do papel), depois o workspace. **Padrão: `delegate`**, em workspace novo e existente (campo ausente lê como `delegate`). Não é permissão e não levanta nenhuma.

**`delegate`, na prática**
- A ferramenta `Agent` ganha um tipo (`kind`): `explore` (ler e buscar), `edit` (escrever e editar), `shell` (comandos) e `screen` (a tela virtual). O subagente começa com o histórico vazio, recebe só a tarefa que o principal escreveu, tem **só as ferramentas do tipo** e devolve ao principal apenas a resposta final. Não aninha.
- Cada subagente roda na lista da atividade dele: o primeiro modelo que não descansa, com a reserva por ocupado dentro da própria lista. As ferramentas dele são sempre um **subconjunto** das do principal: o confinamento ao worktree, a raiz de escrita, o filtro de segredo, a política de shell e a tela do agente são os mesmos.
- Só se oferece o tipo que serve: `explore` sempre; `edit`, `shell` e `screen` quando a atividade tem **lista própria** e o principal tem ferramenta daquele tipo (um leitor não ganha `edit`; um agente sem tela não ganha `screen`). O principal é avisado, no prompt do sistema, de delegar edição, comando e tela ao tipo certo e de escrever a tarefa completa.
- Subagentes de `edit`, `shell` e `screen` rodam **um de cada vez**; os de `explore` podem rodar juntos. A conversa diz "O principal (modelo A) passou o trabalho de edição a um subagente (modelo B)." quando o modelo difere. O uso dos subagentes soma ao da etapa. Esgotados os turnos, o principal recebe um erro claro e decide.
- A tela: o subagente de `screen` usa a **mesma sessão** da etapa (não abre outra); a espera, o passe por site e a entrega à pessoa valem como se o principal tivesse feito o passo.

**Sem lista por atividade, nada muda.** `switch` e `delegate` só têm efeito quando o papel (ou o agente) tem lista própria de `explore`, `edit`, `shell` ou `screen`; sem ela, o modo vale `fallback` e a ferramenta `Agent` fica como hoje. Nenhum workspace já publicado tem lista (o recurso não saiu), então o padrão `delegate` não muda o comportamento de ninguém ao atualizar. Os modos valem para o motor aberto; no Claude SDK a entrada do conjunto só vale no começo da etapa (item 10) e o modo não tem efeito.

**Critérios de aceite dos modos.** (a) Em `fallback`, uma volta de `shell` com lista de `shell` fica no modelo em uso, e um ocupado passa à reserva. (b) Em `switch`, o comportamento da parte 1 não muda (testes existentes). (c) Em `delegate`, o principal não troca de modelo por atividade; um subagente `shell` roda no modelo da lista de `shell`, só com ferramentas de comando e leitura, e o principal recebe só a resposta final. (d) A precedência agente > etapa > workspace, com o padrão `delegate`. (e) Um tipo sem ferramenta no principal não é oferecido. (f) O celular pareado pode mudar o modo de um agente ou de uma etapa (não dá alcance), e não o do workspace. (g) Sem lista por atividade, nenhuma ferramenta nem prompt muda.

**Confirmado pelo mantenedor (gate da parte 2):** sem lista própria por atividade, `switch` e `delegate` valem como `fallback`; e a chave `tools.subagents` também governa a ferramenta `Agent` no modo `delegate` (os textos dela passam a explicar o uso nas execuções).

## Parte 3: o que o provedor oferece

Cinco coisas que um provedor da família OpenAI oferece além do protocolo e que o conjunto de modelos passa a aproveitar. Decididas pelo mantenedor na #213 (parte 3). **Conferido em 2026-10-09** contra um provedor real: toda resposta de chat traz `usage.estimated_cost` (US$), `prompt_tokens_details.cached_tokens` e `cache_write_tokens` (nulo), `completion_tokens_details.reasoning_tokens`, `service_tier` na raiz e o cabeçalho `x-request-id`; o cache é automático (a segunda chamada idêntica serviu 3.840 de 4.013 tokens do cache; `prompt_cache_key` não mudou nada e fica fora); `service_tier: "flex"` custou exatamente 0,8x, com fila maior (3,9 s contra ~1 s) e funciona junto com `fail_fast`; `fail_fast: true` devolveu `429` com `code: engine_overloaded` em 0,4 s, num modelo que sem ele respondia em ~1 s (entrava na fila); `reasoning_effort: "none"` foi aceito.

| O quê | Hoje | Onde |
|---|---|---|
| Custo da chamada | só `usage.cost` (o formato de um agregador); sem ele a etapa fica sem custo | `client.ts:183`, `types.ts:50` |
| Cache gravado, tokens de raciocínio, camada servida | não lidos | `types.ts:45-52` |
| `service_tier`, `reasoning_effort`, `fail_fast` | nunca enviados; `DROPPABLE` não os conhece | `client.ts:221-242`, `errors.ts:189` |
| Um 429 | o cliente repete 2 vezes (1 s, 2 s), qualquer que seja o código, antes de o conjunto trocar | `client.ts:272`, `errors.ts:122` |
| Catálogo | o `/models` traz as etiquetas `reasoning`, `reasoning_effort`, `vision`, `prompt_cache` (conferido nas 179 entradas salvas hoje); **não** traz `flex` nem `deprecated`/`replaced_by`, que só a listagem rica do provedor (`/models/list`) traz | `modelCatalog.ts:55-76` |

1. **Custo real.** O cliente lê `usage.cost` e `usage.estimated_cost` (o que o servidor diz vale sobre qualquer estimativa) e `cache_write_tokens`. O custo da etapa, o do procedimento e o registro da sessão usam o valor do servidor, sem a marca de estimativa. A estimativa continua só onde o servidor nada diz (o valor de tabela do SDK fora da API da Anthropic, e a ordem da sugestão).
2. **Camada flex (-20%) nas etapas de execução.** `service_tier: "flex"` vai nas chamadas de etapa que ninguém espera (etapa, pergunta entre agentes, volta final de procedimentos); cerimônia e `@menção` ficam no padrão. Só quando o servidor tem o recurso ligado **e** o catálogo (etiqueta `flex` da listagem rica) ou a pessoa diz que o modelo o aceita; chave `runner.flex`, ligada por padrão. Um servidor que recusa o parâmetro ensina o cliente a tirá-lo. Um 429 de uma chamada flex sem `fail_fast` reenvia a mesma chamada no padrão, uma vez, em vez de sair do modelo.
3. **Esforço de raciocínio por atividade.** `reasoning_effort` por atividade: proposta `explore` e `shell` baixo, `edit` médio, `write` e `screen` o padrão do modelo (nada enviado); configurável por atividade em `llm.effort` (`none`, `low`, `medium`, `high` ou "do modelo"). Só para modelo que raciocina (etiqueta `reasoning_effort`; sem ela na listagem, `reasoning` ou o teste de conexão). Um subagente de um tipo usa o esforço do tipo; o modelo principal em `fallback` e `delegate` usa o de `write`, para não variar a cada volta.
4. **Modelo obsoleto.** `deprecated` (segundos desde 1970) e `replaced_by` da listagem rica viram um aviso no teste de conexão, ao lado das entradas do conjunto e dos modelos dos papéis e dos agentes, sugerindo o substituto. Só avisa: nunca troca sozinho, nem em execução.
5. **Recusar na hora.** `fail_fast: true` em todo membro do conjunto que **não é o último** ainda disponível da lista em uso: o modelo ocupado recusa de imediato (429 `engine_overloaded`, sem repetir) e o conjunto passa ao seguinte; o último espera na fila como hoje. Só onde o servidor tem o recurso ligado (a listagem não diz).
6. **Bloco de recursos do servidor.** Um bloco opcional por provedor (`features`: `serviceTier`, `failFast`, `reasoningEffort` e `catalogUrl`) liga estes parâmetros; o que o catálogo sabe de cada modelo (`flex`, `effort`, `deprecated`, `replacedBy`) fica na entrada do modelo (`offer`). A predefinição do provedor em questão o traz ligado; os outros provedores e os workspaces que existem não mudam. `catalogUrl` tem de ser da mesma origem que o endereço do provedor: a chave nunca vai a outro lugar.

**Na tela.** Cartão do provedor: "Recursos do servidor" (três caixas, o endereço da listagem rica e "Usar os da predefinição"); linhas do conjunto: marcas "flex" e "esforço" (a pessoa corrige à mão) e o aviso "obsoleto desde <data>; substituto: <modelo>"; passo Modelos: cinco seletores de esforço, um por atividade; seção do runner (só no computador): "Usar a camada flex nas etapas".

**Critérios de aceite.** (a) Uma resposta com `estimated_cost` entra em `costUsd` da etapa, sem `costEstimated`. (b) Etapa de execução em modelo com flex envia `service_tier: "flex"`; cerimônia, menção e provedor sem o recurso, não. (c) Entrada `shell` envia o esforço de `shell`; modelo sem a marca não envia nada; um 400 que cita o parâmetro o tira e o cliente não o manda mais. (d) Num conjunto de três modelos o primeiro e o segundo enviam `fail_fast`, o terceiro não; a recusa troca de modelo sem repetir. (e) Modelo obsoleto aparece com o substituto, no teste e na linha; nada muda sozinho. (f) Provedor sem o bloco: nenhum campo novo no pedido e o comportamento é o de antes. (g) `catalogUrl` de outra origem é recusado.

**Fora do escopo.** `prompt_cache_key`, a camada `priority`, o parâmetro `reasoning` em objeto, buscar a listagem rica na execução (só no teste de conexão), mostrar o cache gravado na tela do run (pediria o formato 7), trocar de modelo por obsolescência, estimar custo de chamada sem o valor do servidor.

**Respondido no gate da parte 3:** a recusa por `fail_fast` descansa 60 s; provedor já cadastrado liga as opções pelo botão "Usar os da predefinição" (a migração não liga nada); o principal de `fallback`/`delegate` usa o esforço de `write`; as etiquetas `tools` e `structured-output` da listagem rica tiram o "não verificado" da sugestão.

## O que não foi verificado

- O formato do catálogo foi conferido **hoje** contra um provedor real: `GET {baseUrl}/models`
  traz em `data[].metadata` o `context_length`, o preço (`pricing`: entrada, saída e leitura
  de cache, em dólares por milhão de tokens) e `tags` (`vision`, `prompt_cache`, `reasoning`).
  Nada disso é padrão do protocolo OpenAI; outros provedores trazem outro formato ou nada.
- A listagem mais rica, fora do protocolo OpenAI, que o provedor tem (etiquetas `tools`, `json`,
  `structured-output`), é **específica dele** e não entra na sugestão, que lê só o `/models`; a parte 3
  lê dela apenas `flex`, `deprecated` e `replaced_by`, no teste de conexão.
- Nenhum teste da suíte chama a rede; a troca real entre dois modelos de um servidor vivo é
  verificação manual da etapa de teste.

## Decisões do mantenedor (gates 1 e 2, 2026-10-09)

1. **Tabela inicial de notas**, todas autodeclaradas pelo fornecedor do modelo, salvo onde dito:
   `deepseek-ai/DeepSeek-V4.1-Flash` shell 90,6 (Terminal-Bench 2.1), edit 74,2 (DeepSWE v1.1);
   `XiaomiMiMo/MiMo-V2.6-Flash` shell 87,6 (Terminal-Bench 2.1), edit 67,9 (DeepSWE v1.1),
   screen 80,8 (OSWorld-Verified); `zai-org/GLM-5.3-Flash` shell 84,3, edit 63,4 (comparativo
   de terceiros, não do fornecedor). **Pisos:** shell 85, edit 65, screen 70; revistos depois da
   implementação para **shell 90, edit 70, screen 70** (com 85/65 os dois modelos mais fortes
   passavam e o mais barato ia primeiro em shell e edit, o contrário do pretendido).
7. **"Usar a sugestão" reordena o papel** (depois da implementação): o primeiro da lista sugerida
   passa a ser o modelo do papel, e o modelo de hoje fica no conjunto, no seu lugar pelo custo.
2. **Fica no modelo em uso** até ele recusar; a próxima etapa recomeça do topo. Revisto depois da
   implementação: numa atividade com lista própria e piso (`shell`, `edit`, `screen`), o modelo em uso
   só fica se a nota dele alcança o piso; senão o turno vai ao primeiro da lista da atividade (sem
   isso, com listas que se sobrepõem, a troca por atividade nunca acontecia).
3. **Trocam de modelo:** taxa (429), sobrecarga (503/529) e os outros 5xx, depois das
   repetições do cliente. Tempo esgotado não troca.
4. **Descanso padrão de 5 minutos**, teto de 15 minutos para o `Retry-After`.
5. **Contexto mínimo da sugestão: 32.000 tokens.**
6. **Entra o segundo leitor de catálogo**, o formato de agregador (preço por token,
   `supported_parameters`, modalidades de entrada), escrito pela documentação pública e
   marcado no código como não conferido contra o serviço.
8. **Três modos de usar o conjunto (2026-10-09, depois da parte 1):** `fallback` ("só reserva"), `switch` ("trocar por atividade", o que está feito) e `delegate` ("principal com subagentes", o **padrão**, em workspace novo e existente). Escolha: agente > etapa do modelo de ciclo > padrão do workspace; cerimônia e `@menção` só agente > workspace. Não é permissão. Ver "Modos de uso do conjunto" e a parte 2 do plano.
9. **O que o provedor oferece (2026-10-09, parte 3):** custo real do servidor (`estimated_cost`, além de `cost`) sobre a estimativa; camada `flex` nas etapas de execução; `reasoning_effort` por atividade; aviso de modelo obsoleto (`deprecated`, `replaced_by`) sem trocar sozinho; `fail_fast` em todo membro que não é o último. Tudo atrás do bloco de recursos do provedor e do que o catálogo diz de cada modelo; provedor sem o bloco não muda. Ver "Parte 3" na spec e no plano.
10. **Ordem de `explore` e `write` (2026-10-09, depois do teste manual; confirmada pelo mantenedor):** só pelo preço, a lista padrão do catálogo real abria com modelos pequenos que ninguém mediu (um de 3 bilhões de parâmetros, um "flash" desconhecido), e "Usar a sugestão" fazia do primeiro o modelo do papel. Em atividade sem piso, vão primeiro os modelos com nota em **qualquer** atividade (da tabela ou do que a pessoa escreveu), por custo; depois os sem nenhuma nota, por custo. Os pisos de `shell`, `edit` e `screen` não mudam. Fica em commit próprio (`rankForActivity`), para ser revertido sozinho.

## Fora do escopo

- Conjunto global do workspace (a decisão é um por papel), troca de **provedor** de
  credencial, rodar benchmark no app, buscar notas na rede ou de endereço de provedor.
- Trocar de modelo em cerimônia por falha que não seja taxa ou sobrecarga; repetir etapa
  inteira; reenviar a etapa por conta própria quando o SDK recusa **depois** de usar
  ferramentas (a tentativa falha como hoje).
- Persistir o descanso em disco; mudar o formato do run (`RUN_VERSION` fica); tela nova para
  o descanso ou o custo; mudar o que o celular pareado edita.
