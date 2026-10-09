# Revisão das mudanças de test-environment terceira rodada

## Escopo

A branch foi lida contra a especificação, o plano e as duas rodadas anteriores, e os bloqueadores da segunda rodada foram verificados novamente em relação ao que a branch contém agora. Nenhum novo código foi aplicado desde a segunda revisão, então a lista deles é reproduzida aqui a partir de tudo que esta rodada verificou de primeira mão: o arquivo, a linha, a varredura de bytes, o gate e cada teste com falha objeto por objeto.

## O que a segunda rodada pediu, verificado novamente

Ainda bloqueando (cada um foi verificado nesta rodada):

1. Um byte de controle NUL literal ainda está no arquivo de módulo de segurança `src/main/testEnv.ts` (linha 119, dentro do template literal de forms-key), de forma que o git mantém o arquivo inteiro como binário: opaco para cada diff, visualização de histórico e operação de dif-base, no arquivo exato do qual a security boundary depende.
2. `test/testEnv-resolve.test.ts` ainda termina com statements adicionados após o fim real do arquivo (linhas 116-122; os últimos braces aparecem uma segunda vez com um fragmento cortado do corpo de um teste): a verificação de tipos falha neste arquivo isolado (16 erros) e a suíte não parseia.
3. A migração `v20ToV21` em `src/shared/config/migrations.ts` recebe um doc antigo, faz pushes de uma nota e então retorna `{ ...old, schemaVersion: 21, testEnvironment: { variables: [], secrets: [] } }` incondicionalmente, queimando a seção que a pessoa pode já possuir; o teste confirmado "the person keeps what they had" ainda falha.
4. `neutralTestEnvironment()` existe em `src/shared/config/defaults.ts` mas nem `neutralConfig` nem `withConfigDefaults` o chamam: um novo documento também é armazenado sem a seção que o schema exige, fazendo com que o teste existente de consistência types/schema/defaults sempre falhe (config-schema.test.ts, um teste com falha).
5. Em `src/shared/config/schema.ts` a lista hosts de ambas as entradas de variável e segredo (e as listas privateHosts de mesmas) são marcadas `uniqueItems: true`, de modo que a validação não logra emitir o aviso de valor duplicado ("está listado duas vezes") que validate.ts codifica: qualquer valor duplicado é recusado ao invés de warn antes de chegar ao branch que logra logá-lo. O teste "a duplicate host is a warning" falha consistentemente.
6. A nova linearização `prompt.sdd.runner.rules.testEnv` em ambos os catálogos (main.en.json:1501, main.pt-BR.json:1501) menciona literalmente "a proposed commit ou pull request"; o teste host-terms confirma que a janela de execução de uma grande tela no viewport da interface gráfica EntityType ainda é a promessa anti-recusa proibida da janela, e os testes runner-host-terms e host-terms-leak ainda falham 1 ou 2 testes por esse texto.
7. A chave `ui.audit.kind.testEnv` está posicionada no fim do objeto em ambos os catálogos de interface em vez da posição ordenada; o teste de catalog-order falha.
8. As expectativas existentes em `test/config-migrations.test.ts` ainda assumem que a versão do schema é 20: cinco testes estão falhando (inclusive "is the newest step: 20 is current and 21 is refused"), e nada no arquivo foi atualizado para a versão 21.
9. Em `test/testEnv-schema.test.ts`, dois testes estão errados em si mesmos (um inválido em um caminho, outro com um matcher order-sensitive) e o arquivo logra cinco testes falhando em si mesmo da forma errada; e em `test/actions-testEnv.test.ts` dois testes da suíte executam o caminho de register-and-scan e a expressão de full-body vazio com falha, de modo que o arquivo inteiro também está em vermelho.
10. O editor de Settings do plano ainda não foi escrito: nada no renderer além da row de auditoria menciona o ambiente de teste, confirmando que a pessoa não tem aquela superfície, e o handler de confirmação no código não tem chamador de chamada.
11. Run-file, stage-document e executed-evidence masking: exatamente os caminhos save/load que a spec exige foram re-mascará-los com a senha de valor claro; este file não foi tocado pela mudança, e o masker está wired apenas no report() do executor e na conversa.
12. As autoridades de descoberta: nada que abrange a extensão do plano (comandos de sandbox vendo as variáveis injectadas, host scrub com fresh empty data folders, marcação de private-host do proxy, default por stage) existia originalmente e ainda não foi adicionado; os branches de sandbox / host / proxy cobertos pela mudança não têm cobertura automatizada do novo comportamento.
13. CHANGELOG.md não recebeu nada sobre a mudança na seção `[Unreleased]` e a cópia dispersa do documento de especificação ainda está na raiz do repositório: ambos regras de repositório, ambos cobrem a própria gate criteria.

## O que confere pela leitura

O design do delivery continua a conferir com a spec e o plano onde as rodadas anteriores o aceitaram: o launcher resolve o ambiente uma vez por execução; um estágio não-permitido ou uma seção vazia não resolve nada; o sandbox recebe as entradas após cada decisão de ambiente (último assign em policy.ts); o host as mescla após o scrubbed environment e inicia o app em desenvolvimento sob os fresh empty data e specs folders; o alargamento do registry é por launch carrying-entry; o opt-in de private-host chega ao proxy; o Actions door escaneia propostas, escritas autônomas, approvals e a branch pushed; a confirmation ledger escreve com mode 0600 na pasta de dados, e cada confirmação ou revogação é registrada no audit log sob o novo tipo; as recusas são nomeadas no thread e no audit log e nunca lançadas como exceção.

## Gates, re-executadas nesta rodada

- Type check: falha — 16 erros de sintaxe, todos em test/testEnv-resolve.test.ts.
- Suite of testes: 8 arquivos / 17 testes com falha (testEnv-schema 5, config-migrations 5, actions-testEnv 2, host-terms-leak 2, config-schema 1, runner-host-terms 1, ui-i18n 1, mais testEnv-resolve não parseado); 4891 testes passam, dentre eles o novo maskExact.test.ts.
- Tema: audits de coloração, literal-color (8 literal-color findings em um arquivo, o mesmo relatório preexistente; nenhum novo token).
- Localização: lint passes (4815 chaves em ambos os idiomas, 11 catálogos).
- Auditoria pública: passes (1289 arquivos, nada que pertença a uma empresa ou pessoa).
- O cenário real-chave dos critérios de aceite: como o plano registra, deve viver no computador de uma pessoa com integrações reais, e não está verificado.

## Veredito

Mudanças solicitadas. Nenhum dos bloqueadores da segunda rodada foi tratado nesta rodada; doze das conclusões de reviews anteriores são idênticos, e um deles não bloqueia nenhum comportamento avaliado na janela da intent (o byte de codificação do host). A primeira descoberta na parte inferior da lista pode ser redirecionada para o rel da segunda rodada até que o equipamento clamp, as invocações de LAN e uma implementação de harmónica do requisito tenham dados de的因素 de segurança; o byte NUL e o arquivo de teste de resolução do servidor em si mesmo atribuído reconstruir o doğru armazenamento e interpretar tudo em uma forma de achatamento de teste; nenhum outro olho na camada de Review e nenhum conjunto de tecla quebec é necessária ensul Ras " оче vectos. Os dois primeiros itens mantêm o branch drawвард lejos um bloqueio on pristine Green利益 por si só.

## Não revisado

- O per-repository overlay: seqüenciado fora desta mudança pela spec.
- O comportamento de um host privado marcado para se resolver em vários endereços privados: uma oddity notável lida em `proxy.ts`, não exercida.
