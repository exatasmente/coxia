# Revisão: sessões do Claude Code no app, rodada 2

## Veredito

Aprovado. O bloqueante da rodada 1 (nenhum código nem teste) foi tratado: os passos 1 a 7 do plano estão na branch, com testes.

## O que foi conferido

- Lidos por inteiro: `source.ts`, `module.ts` e `service.ts` do núcleo, a nota de implementação, a especificação e o plano. O resto do diff foi visto só pelo resumo do app; arquivos de tela, catálogos e documentação não foram relidos linha a linha (não verificado em detalhe).
- Rodado nesta etapa: os sete arquivos de teste ligados ao recurso (fontes, permissões, serviço, módulo, tela, migração de configuração, tabela da porta da persona, política do celular): 191 testes passaram.
- Não rodados nesta etapa: `tsc`, suíte completa, theme-audit, i18n:lint, public-audit, build. Os resultados vêm da nota de implementação (não verificado aqui). A nota registra 2 testes que estouraram 5 s com a máquina carregada e passaram sozinhos.
- Não verificado: nada contra o Claude Code real; a tela não foi aberta num app em execução.

## Contra a especificação

- Desligado por padrão e só na janela: `claudeSessions.enabled`, canais recusam desligado ou fora da janela. O desvio (canais sempre registrados, recusando) atende a regra 1 sem exigir reinício; aceito.
- Leitura de disco: `guardedRead` só aceita `<dígitos>.json` direto na pasta, como arquivo regular, recusa `.key` e credenciais e devolve só os campos permitidos. Leitura do código confere.
- Eventos só pela janela (`emitWindow`), sem `emit`; três camadas contra celular e persona (prefixo negado, `EXCLUDED`, checagem de porta).
- `test:true` recusa `send` e `start` antes de criar o `query`; listar e ler seguem.
- Redação aplicada a transcrições, títulos, pastas, entrada da permissão e erros do SDK.
- Auditoria `claude-session` com sessão citada e só o tamanho do texto.

## Achados

### Bloqueantes

Nenhum.

### Sugestões

1. `service.ts` (`send`, `start`, `stop`): a linha de auditoria só é gravada depois do sucesso. Se o texto já foi entregue ao SDK e falha, ou `interrupt` lança, não há linha. Já registrado como lacuna conhecida; considerar gravar a tentativa com resultado de falha.
2. `service.ts` (`follow`): o intervalo de 2 s só para por `follow(null)`; depende de a tela chamá-lo ao fechar. Conferir na QA que sair da tela encerra o acompanhamento.
3. `module.ts` (`sdkQuery`): `settingSources` inclui `user`, `project` e `local`; isso é coerente com usar o `claude` da pessoa, mas vale uma linha de documentação dizendo que as configurações dela se aplicam.

## Segurança, regras do repositório e repositório público

Nada bloqueante na leitura: fixtures sintéticas segundo a nota, nenhum caminho de escrita fora da porta no código lido. O repositório público foi conferido pela nota (public-audit), não por esta etapa.
