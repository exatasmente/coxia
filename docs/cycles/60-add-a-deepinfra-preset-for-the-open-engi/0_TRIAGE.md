# Atalho de provedor que falta na lista do motor aberto

## Que tipo de issue é

Pedido de funcionalidade, com o rótulo `enhancement`. Não é um defeito: nada se comporta
errado. Falta um atalho. Quem configura o motor aberto precisa hoje escolher "outro
endereço" e digitar de cabeça o endereço de um serviço compatível com OpenAI que já passa
no teste de conexão; o pedido é que ele apareça na lista de atalhos, do mesmo jeito que os
outros serviços compatíveis.

## Dá para entender como está escrita

Dá para entender, e o que a issue afirma sobre o código foi conferido na leitura. Só foi
lido o código: nenhuma tela foi aberta, nenhuma configuração foi montada e nenhum teste de
conexão foi rodado nesta etapa.

Conferido na leitura:

- A lista de atalhos do motor aberto (`OPEN_PRESETS`, `src/shared/wizard.ts:101`) traz
  openai, openrouter, groq, deepseek, ollama, lmstudio e custom. Nenhum outro serviço
  compatível com OpenAI está lá, e o tipo `PresetId` (`src/shared/wizard.ts:86`) fecha essa
  lista com os mesmos sete nomes. O serviço que a issue pede não aparece em lugar nenhum do
  código.
- Cada atalho carrega endereço base, se exige chave, modelos sugeridos, um `headers` e um
  `keyUrl` opcional (`OpenPreset`, `src/shared/wizard.ts:88`). O `keyUrl` é o que vira o link
  "criar chave" na tela (`src/renderer/src/wizard/steps/ModelsStep.tsx:295`), e a lista de
  atalhos alimenta o seletor da mesma tela (`ModelsStep.tsx:285`).
- O rótulo de cada atalho é uma chave de catálogo `wizard.preset.<id>`; ela existe hoje nos
  dois catálogos (`src/shared/i18n/wizard.en.json:88`, `src/shared/i18n/wizard.pt-BR.json:88`)
  e é cobrada por `test/wizard-i18n.test.ts:28`, que exige a chave para cada atalho da lista.
- A tabela de provedores e o que foi testado estão em `docs/llm-providers.md`, na seção
  "Provedores: o que foi testado" (e a equivalente em inglês), que hoje não cita esse
  serviço.

Não verificado: que o serviço realmente passa no teste de conexão do app (chat, chamadas de
ferramenta e `json_schema`). A issue afirma que passa; nada foi exercitado aqui. Também não
verificado se o endereço de página de chave e o modelo sugerido que a issue menciona são os
corretos para o serviço.

## O que falta

Nada que só quem abriu possa dizer. O escopo foi reduzido por quem abriu e o comentário diz
por quê: a entrada de atalho no motor aberto, com endereço base, chave exigida e a página de
chave como `keyUrl`; uma linha na tabela de provedores testados; e o texto novo nos dois
catálogos. O aviso do wizard para modelo não reconhecido fica explicitamente de fora. A
issue ainda diz que o serviço passa no teste de conexão e descreve por que o endereço em
formato Anthropic não serve para modelos que não são Claude — o que basta para entender o
pedido.

## O que parece duplicada ou relacionada

Nenhuma duplicada. Os outros ciclos registrados neste repositório de trabalho tratam de
orçamento de chave de provedor, de chamar um agente com `@`, de memória de ciclo, de aviso
em execução, de um provedor alternativo por agente e de propostas de retro; nenhum pede um
atalho novo para o motor aberto. O aviso de wizard para modelo não reconhecido que a
própria issue cita foi empurrado para outra issue, se fizer falta; essa issue não existe
aqui.

## Squad proposto

`plataforma`. O que a issue pede vive na lista de atalhos e na configuração de provedores do
motor aberto (`src/shared/wizard.ts` e a camada de provedores do runtime), com um texto novo
nos dois catálogos e uma linha em `docs/llm-providers.md`; é o escopo de motores de agente e
configuração de provedores desse squad. A parte de catálogo é pequena e acompanha a entrada
nova, não muda a tela.

## Prioridade sugerida

`priority:medium`, como já está no rótulo. O serviço é o provedor em uso neste workspace,
segundo o comentário de quem abriu, o que dá valor a curto prazo; não é um defeito nem
bloqueia ninguém, então não parece `high`.
