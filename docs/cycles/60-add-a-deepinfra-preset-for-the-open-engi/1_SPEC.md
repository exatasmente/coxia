# O atalho que faltava para o DeepInfra no motor aberto

## O que se pede

Quem configura um provedor no motor aberto escolhe hoje entre os atalhos da lista
(OpenAI, OpenRouter, Groq, DeepSeek, Ollama, LM Studio) ou "outro endereço". O
DeepInfra serve uma API compatível com OpenAI no mesmo endereço em que os mesmos
modelos abertos são usados por outros gateways e passa no teste de conexão do app,
mas não está na lista: hoje "é preciso escolher *outro endereço* e saber o endereço".

O pedido, nas palavras da issue:

> - **A DeepInfra preset for the open engine:** base URL `https://api.deepinfra.com/v1/openai`, key required, the key page as `keyUrl`, and a suggested model the connection test then replaces with the listed ones.
> - **`docs/llm-providers.md`** lists DeepInfra with what was tested.

O escopo foi reduzido por quem abriu:

> Escopo reduzido ao preset do DeepInfra no motor aberto, com a linha em `docs/llm-providers.md`; o aviso no wizard para `unrecognized_model` fica para outra issue, se fizer falta.

Ou seja: entra a entrada de atalho no motor aberto, entra a linha na tabela de
provedores testados e entra o texto novo nos dois catálogos. Fica de fora o aviso do
wizard para modelo não reconhecido.

## O que muda para quem usa

Na tela em que um provedor de modelo é adicionado, quem escolhe o motor aberto (tipo
"Compatível com OpenAI") passa a ver **DeepInfra** na lista de servidores, junto de
OpenAI, OpenRouter, Groq e DeepSeek. Escolher o DeepInfra preenche o endereço base
sozinho, marca a chave como obrigatória e mostra o link para criar a chave.

Com o endereço preenchido e a chave informada, o teste de conexão do app confere o que
o servidor oferece e troca o modelo sugerido pela lista real de modelos do servidor,
como já faz com os outros atalhos. Um campo de modelo já vem com uma sugestão, para o
teste ter por onde começar.

Na documentação, a tabela de provedores e o que foi testado passa a citar o DeepInfra,
com o que se sabe dele.

Nada muda para quem já usa outro provedor, nem para quem está no motor Claude.

## As regras

- **Entrada nova na lista do motor aberto.** O atalho tem um identificador próprio,
  distinto dos sete existentes, e um rótulo legível ("DeepInfra") nos dois idiomas.
- **Endereço base.** `https://api.deepinfra.com/v1/openai`. É o endereço da API
  compatível com OpenAI; escolher o atalho o preenche no campo, que continua editável.
- **Chave exigida.** O atalho marca a chave como obrigatória, e o campo de chave é
  oferecido junto dos demais, com o link "criar chave" apontando para a página de chave
  do DeepInfra.
- **Modelo sugerido.** O campo de modelo traz uma sugestão de partida; o teste de
  conexão a substitui pelos modelos que o servidor listar, como nos outros atalhos.
- **Documentação.** A tabela de provedores e o que foi testado passa a listar o
  DeepInfra, em português e em inglês, dizendo o que foi exercitado.
- **Fora do escopo, por decisão de quem abriu:** o aviso do wizard quando um provedor
  de tipo `anthropic` no Claude Agent SDK aponta para um endereço que não é da
  Anthropic e a conexão falha por modelo não reconhecido (`unrecognized_model`). Vai
  para outra issue, se fizer falta.
- **Fora do escopo:** qualquer mudança no motor Claude, no endereço em formato Anthropic
  do DeepInfra, na tela em si (além do atalho novo) e em outros provedores.

## Critérios de aceite

Cada um é algo que uma pessoa consegue conferir na tela ou na documentação:

1. Na lista de servidores do motor aberto, o DeepInfra aparece como uma opção a mais,
   com o rótulo "DeepInfra", ao lado das opções que já existiam.
2. Escolher o DeepInfra preenche o endereço base com
   `https://api.deepinfra.com/v1/openai`, e esse endereço continua editável.
3. Escolher o DeepInfra marca a chave como obrigatória e mostra o link para criar a
   chave, que leva à página de chave do DeepInfra.
4. O campo de modelo vem com uma sugestão de partida.
5. Rodar o teste de conexão com uma chave válida devolve os modelos listados pelo
   servidor e troca a sugestão por eles; o mesmo teste mostra o que o servidor consegue
   fazer (conversa, ferramentas e `json_schema`), como nos outros atalhos.
6. A tabela de provedores testados na documentação cita o DeepInfra, nos dois idiomas.
7. Nenhum outro atalho, provedor ou tela muda de comportamento; e nada é exibido no
   motor Claude por causa desta entrada.

## O que ainda não foi verificado

- **Não verificado nesta etapa:** que o DeepInfra realmente passa no teste de conexão
  do app (conversa, chamadas de ferramenta e `json_schema`). A issue afirma que passa;
  nenhuma tela foi aberta e nenhum teste foi rodado. Quem implementar precisa exercitar
  o teste de conexão contra o serviço real.
- **Não verificado:** que o endereço de página de chave e o modelo sugerido citados na
  issue são os corretos para o serviço.

## Perguntas em aberto

Nenhuma. A issue traz o endereço base, a exigência de chave, a página de chave, um
modelo sugerido e o que foi testado; o escopo foi reduzido por quem abriu. Nada falta
que só quem abriu possa responder.

## Fora do escopo

- O aviso do wizard para modelo não reconhecido (`unrecognized_model`), que fica para
  outra issue.
- O endereço do DeepInfra em formato Anthropic e qualquer mudança no motor Claude.
- Mudanças em outros provedores ou na tela além do atalho novo.
