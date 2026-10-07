# O atalho do DeepInfra confere com a especificação, e os dois achados da rodada anterior foram fechados

## O que foi conferido

Revisão contra `1_SPEC.md`, `2_PLAN.md` e a fronteira de segurança, por leitura do
worktree e por execução de testes e verificações. Nada foi alterado.

**Os achados da rodada anterior.** O resíduo de digitação que bloqueava a entrega não
existe mais: a linha solta `s.` no fim de `docs/llm-providers.md` foi removida, e o fim
do arquivo foi conferido byte a byte — ele termina hoje na última limitação conhecida da
seção inglesa, sem nenhuma linha órfã nem espaço residual. A cobertura pedida também
entrou: o caso de `test/wizard-shared.test.ts` prende agora o `keyUrl` exato
(`https://deepinfra.com/dash/api_keys`), o `headers: {}`, a igualdade das chaves da
entrada com as de `OPEN_PRESETS[0]` e a ordem exata dos oito ids. Uma troca de cabeçalhos,
um endereço de chave de outro serviço ou uma reordenação passam a ser acusadas. As duas
correções foram lidas no diff e exercitadas pelos testes.

**O atalho.** A entrada nova (`deepinfra`) está entre as de nuvem e o "outro endereço",
logo depois de `deepseek` e antes de `ollama`, exatamente como o plano decidiu. Carrega
`baseUrl: 'https://api.deepinfra.com/v1/openai'`, `local: false`, `keyRequired: true`,
`suggestedModels: ['meta-llama/Meta-Llama-3.1-8B-Instruct']`,
`keyUrl: 'https://deepinfra.com/dash/api_keys'` e `headers: {}`, os mesmos campos das
vizinhas. O identificador entrou também no tipo `PresetId`, então o compilador cobre quem
trata a lista por tipo.

**O que a tela faz com esses campos**, conferido no código que já os lê: o seletor monta
uma opção por atalho com o rótulo `wizard.preset.<id>`; escolher o atalho preenche o
endereço base e marca a chave como obrigatória; o `keyUrl` vira o link "criar chave"; e o
modelo sugerido aparece como texto de exemplo do campo de modelo, cujo valor de partida
`buildProvider` transforma em `models` do provedor, que o teste de conexão depois amplia
com a lista que o servidor devolver. Nenhum arquivo da tela foi tocado.

**O endereço base contra a resolução do motor aberto.** O endereço do atalho tem o sufixo
`/v1/openai`, diferente do `/v1` das outras entradas de nuvem. Conferi por leitura que a
resolução do motor aberto o aceita como raiz: a normalização remove barras finais e as
rotas `/chat/completions` e `/models`, e não reescreve o caminho quando ele não está
vazio. As chamadas montam `${base}/chat/completions` e `${base}/models` a partir do que
foi informado, então "escolher o atalho e testar a conexão" cai nos endereços que a issue
cita. Isso é leitura de código: nenhuma chamada foi feita ao serviço.

**Os dois catálogos.** A chave `wizard.preset.deepinfra` com o texto "DeepInfra" entrou
nos dois idiomas, na mesma posição. Nenhum texto de chave existente mudou — em especial
`wizard.kind.openai-compatible.hint`, que lista outros serviços como exemplo —, e o
snapshot de catálogos usado pelo teste que compara o que um workspace lê agora com o que
lia antes não ganhou a chave nova.

**Documentação e lançamento.** As duas tabelas de `docs/llm-providers.md` (português e
inglês) citam o serviço com a legenda "esperado funcionar; não testado" / "expected to
work; untested", coerente com o que ninguém exercitou, e o changelog ganhou a linha da
mudança sob `## [Unreleased] › ### Added`. A tabela de motores, que lista os provedores de
cada motor, não cita o serviço novo — é a decisão que o plano já registrava de não mexer
em texto existente.

**A fronteira de segurança.** Nenhum caminho novo escreve no host de código: o atalho é
dado de lista lido pela interface e pela construção do provedor; a única escrita segue
passando por Ações, com a mesma política de canais e nenhum canal novo. Nada de segredo,
host real, pessoa, empresa ou número de issue, e nenhum arquivo com nome que não possa ser
público.

**Configuração intacta.** Nenhum arquivo de esquema, tipos, padrões ou migração foi
tocado; o atalho é uma entrada de lista, não um campo novo de configuração, então não há
migração a fazer. O provedor criado pelo atalho é validado pelas mesmas regras dos outros.

## O que foi executado nesta revisão

- `npx tsc --noEmit`: sem erros (código de saída 0).
- Os seis arquivos que tocam o atalho, os catálogos e as varreduras de texto
  (`test/wizard-shared.test.ts`, `test/wizard-i18n.test.ts`, `test/i18n.test.ts`,
  `test/gitlab-catalogs-unchanged.test.ts`, `test/host-terms-leak.test.ts`,
  `test/voice-terminology.test.ts`): 6 arquivos, 52 casos, todos passam. Nenhum deles
  foi exercitado contra a rede.
- `node scripts/theme-audit.mjs`: sem literais de cor novos (código de saída 0).
- `npm run i18n:lint`: 4055 chaves nos dois idiomas, nada a corrigir (código de saída 0).
- `node scripts/public-audit.mjs`: 911 arquivos, nada que pertença a uma empresa ou a uma
  pessoa (código de saída 0).

A suíte completa não foi exercitada nesta revisão: sob carga paralela ela passa da janela
de tempo de um comando, como já registrado. Os arquivos que a suíte completa derrubava por
estouro de tempo sob carga foram exercitados em isolamento na passagem de implementação
(`conflict-from-mr`, `conflict-resolve`, `runner-chain`, `release-git`, `update-script`) e
passam; nesta revisão nenhum deles voltou a ser exercitado, e a leitura do diff não mostra
nada que os toque.

## O que esta revisão não conseguiu fechar

- O teste de conexão contra o serviço real (conversa, ferramentas e `json_schema`), que é o
  critério 5 da especificação, segue **não exercitado**: nenhuma chave foi usada, nenhuma
  chamada saiu para a rede. É o que decide se a linha da tabela pode dizer "testado".
- O endereço da página de chave e o modelo sugerido não foram abertos nem conferidos
  contra o que o serviço oferece; só se sabe que o `keyUrl` começa com `https://`, que é o
  que o teste prende.
- A tela não foi aberta: o que a entrega faz com o atalho foi conferido no código que já
  lê a lista, o `keyRequired` e o `keyUrl`, não numa execução da interface.

## Achados

Nenhum. O achado bloqueante da rodada anterior foi corrigido e conferido; a sugestão de
cobertura foi atendida. O que pende é o que nunca esteve no diff — o exercício contra o
serviço real —, registrado acima como não verificado, e não como achado.
