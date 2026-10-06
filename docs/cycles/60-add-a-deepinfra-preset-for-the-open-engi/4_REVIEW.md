# O atalho do DeepInfra confere com a especificação; sobra uma linha solta na documentação

## O que foi conferido

Revisão contra `1_SPEC.md`, `2_PLAN.md` e a fronteira de segurança, por leitura do
worktree e por execução de testes e verificações. Nada foi alterado.

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
modelo sugerido aparece como texto de exemplo do campo de modelo, que o teste de conexão
depois troca pela lista que o servidor devolver. Nenhum arquivo da tela foi tocado.

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
público. As outras verificações do repositório passam.

**Configuração intacta.** Conferi por execução que o provedor que o assistente monta a
partir do atalho passa inteiro pelo esquema da configuração e pela validação; que uma
exportação que o contém volta a importar; que uma exportação feita antes deste atalho
continua importando; e que os oito atalhos, um a um, produzem provedor válido. Uma
configuração gravada por versão anterior não muda de forma: nenhum arquivo de esquema,
tipos, padrões ou migração foi tocado.

**A suíte.** Os testes que tocam o atalho, os catálogos, a importação/exportação e as
varreduras de texto passam. Na suíte completa, um conjunto de arquivos falha por estouro
de tempo sob carga paralela, e um caso de cadeia de perguntas falha por disputa de tempo;
rodei os cinco arquivos em isolamento e todos passam (com a ressalva logo abaixo). Nenhuma
falha cita o atalho, o endereço, o rótulo ou qualquer arquivo da mudança. O caso de
varredura de texto que estourava sob carga passa em isolamento.

## O que esta revisão não conseguiu fechar

- O arquivo de teste de `release-git` foi posto a rodar em isolamento e a execução foi
  interrompida quando o tempo da etapa para comandos acabou: o resultado final dela ficou
  **não verificado** nesta revisão. Os outros quatro arquivos que falharam na suíte
  completa foram exercitados em isolamento e passaram.
- O teste de conexão contra o serviço real (conversa, ferramentas e `json_schema`), que é o
  critério 5 da especificação, segue **não exercitado**: o endereço de página de chave e o
  modelo sugerido não foram abertos nem conferidos contra o serviço, e a tela não foi
  aberta. É o que decide se a linha da tabela pode dizer "testado".

## Achados

1. **Bloqueante — resíduo de digitação na documentação.** O fim do `docs/llm-providers.md`
   traz uma linha solta `s.`, fora de qualquer seção, depois da última limitação
   conhecida. Entrou no commit do código e não pode seguir para o pull request: é texto
   quebrado num documento lido por quem usa. Não corrigido por esta etapa, que só lê.
2. **Cobertura incompleta da entrada nova.** O caso acrescentado prende o endereço base,
   `local` e `keyRequired`, além de exigir um `keyUrl` com `https://`, uma sugestão não
   vazia e identificadores únicos. Não prende os cabeçalhos (o `{}` conferido com as
   outras entradas de nuvem), a posição na lista nem a igualdade com as entradas
   existentes; uma troca de `headers` ou um `keyUrl` de outro serviço passaria.
