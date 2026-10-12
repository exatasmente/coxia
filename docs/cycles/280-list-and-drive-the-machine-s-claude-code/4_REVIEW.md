# Revisão: nada foi implementado ainda

## Veredito

Mudanças pedidas. Não há código de produto para aprovar.

## O que foi conferido

- Lidos: a issue, a especificação (16 regras, 12 critérios), o plano, a nota de implementação e a memória do ciclo.
- O resumo do que a branch alterou, fornecido pelo app, diz que não há alteração fora da pasta do ciclo. Não foi rodado nenhum comando próprio de diff; isto vem desse resumo.
- Nenhum portão foi rodado (tipos, testes, auditoria de tema, i18n, auditoria pública), porque não há código novo. Não verificado.

## Achados

### Bloqueante

1. **Critérios de aceite não atendidos (todos os 12).** A nota de implementação confirma que só o passo 0 (sondagem do SDK) foi feito. Faltam: chave `claudeSessions.enabled` com migração v35 e os três arquivos de configuração; prefixo negado `claudeSessions:` no `webPolicy.ts`; canais em `EXCLUDED` com motivo `machine`; emissor só da janela; núcleo (`source`, `asks`, `owned`, `service`, `module`); tipo de auditoria `claude-session`; tela; documentação e `CHANGELOG.md`.
2. **Testes que faltam** para todo comportamento novo listado na tabela do plano (módulo desligado, `guardedRead`, redação, resume/bifurcação, fila de permissões e recusa por `viaOf`, parar/encerrar, `test:true`, auditoria, celular, persona, migração, tela).

### Sugestões (para a próxima tentativa)

- A sondagem confirmou a fonte limpa das sessões em execução (`sessions/<pid>.json`, só os campos pid, sessionId, cwd, kind, status, updatedAt). Manter `guardedRead` como único ponto de disco e testá-lo com arquivos sintéticos em pasta temporária, nunca com a pasta real.
- Localizar a função de redação (pergunta aberta da memória) antes do `service.ts`.
- Entregar em ordem 1 a 7 e rodar os cinco portões ao final; reportar o que não rodar.

## Segurança, regras do repositório e repositório público

Sem código, nada a julgar. Não verificado. Os pontos de atenção do plano seguem válidos: `emit` atual faz broadcast ao celular (usar só `emitWindow`), resposta de permissão só pela janela, nenhum arquivo de credencial ou chave aberto.
