# Um conjunto de modelos por papel: o provedor ocupado não derruba a etapa

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
   `explore` e `write` não têm piso (ordem de preço). A tabela mapeia id de modelo para nota
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

## O que não foi verificado

- O formato do catálogo foi conferido **hoje** contra um provedor real: `GET {baseUrl}/models`
  traz em `data[].metadata` o `context_length`, o preço (`pricing`: entrada, saída e leitura
  de cache, em dólares por milhão de tokens) e `tags` (`vision`, `prompt_cache`, `reasoning`).
  Nada disso é padrão do protocolo OpenAI; outros provedores trazem outro formato ou nada.
- A listagem mais rica, fora do protocolo OpenAI, que o provedor tem (etiquetas `tools`, `json`,
  `structured-output`), é **específica dele** e não entra: a sugestão lê só o `/models`.
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
2. **Fica no modelo em uso** até ele recusar; a próxima etapa recomeça do topo.
3. **Trocam de modelo:** taxa (429), sobrecarga (503/529) e os outros 5xx, depois das
   repetições do cliente. Tempo esgotado não troca.
4. **Descanso padrão de 5 minutos**, teto de 15 minutos para o `Retry-After`.
5. **Contexto mínimo da sugestão: 32.000 tokens.**
6. **Entra o segundo leitor de catálogo**, o formato de agregador (preço por token,
   `supported_parameters`, modalidades de entrada), escrito pela documentação pública e
   marcado no código como não conferido contra o serviço.

## Fora do escopo

- Conjunto global do workspace (a decisão é um por papel), troca de **provedor** de
  credencial, rodar benchmark no app, buscar notas na rede ou de endereço de provedor.
- Trocar de modelo em cerimônia por falha que não seja taxa ou sobrecarga; repetir etapa
  inteira; reenviar a etapa por conta própria quando o SDK recusa **depois** de usar
  ferramentas (a tentativa falha como hoje).
- Persistir o descanso em disco; mudar o formato do run (`RUN_VERSION` fica); tela nova para
  o descanso ou o custo; mudar o que o celular pareado edita.
