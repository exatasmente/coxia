# Memória do ciclo

## Decisões

- O workspace fictício da semeadura fica **fora do repositório**, descartável; o repositório versiona só o script de semeadura e os de captura. A aceitação "a auditoria pública passa na pasta que ele escreveu" se confere apontando a auditoria para a pasta com `--root <dir>` (já existe, documentado como uso de teste em `scripts/public-audit.mjs:6`; uso em `:184-185`). Não deve ficar na árvore nem ignorada: `--exclude-standard` esconderia uma pasta ignorada. <!-- answer:99 -->

## Restrições

- Repositório público: nada de nome de empresa, pessoa, host, número real de issue ou segredo em script de semeadura, fixture, imagem, doc ou commit. Placeholders neutros (`example.com`, `group/project`, `#123`).
- Nenhum teste pode alcançar modelo real, host real ou a rede; as fakes ficam em `test/helpers/`.
- A tela virtual é Linux, o app nunca usa a tela da pessoa, e `display` é hoje campo de `runner.sandbox` (esquema 26), não do stage.
- **D18:** `beta` e `stable` sempre esperam o "sim" da pessoa em Ações, mesmo com o Release manager autônomo (`docs/runner.md:220`; `RELEASING.md`, etapa 3; `docs/runner.md:228`).
- A auditoria pública confere um arquivo binário só pelo caminho, nunca pelo conteúdo (`scripts/public-audit.mjs:109-131`).

## Tentado e descartado

- Nada foi executado nesta etapa; toda a conferência foi de leitura.

## Perguntas abertas

- **Onde a regeneração entra no fluxo de release.** O ponto que a issue pede ("depois do incremento e antes das notas") não existe: o corte é um passo único (`scripts/release.sh:355-390`) que sempre espera o "sim" e recusa árvore suja (`:361`); antes do corte a recusa por árvore suja pega a regeneração, depois do corte já há tag. Saídas possíveis: regenerar depois do corte, num step novo antes do push, ou as imagens entrarem pela rota do pull request. Decisão do refino.
- Flag de tela no stage do fluxo ou no agente: a issue pede o stage; o agente já carrega `screen`, `allowedHosts` e `browserProfile`, e `StageDef` (`src/shared/config/types.ts:302-337`) não tem campo de tela.
- As dúvidas do refino que a própria issue lista: primeira lista de funcionalidades, relógio fixo, se a semeadura serve também aos testes, um ou dois temas.
- Duas que a triagem achou: a captura da tela do celular (o navegador do app de um agente com tela não é a mesma coisa que um launcher de Electron no app empacotado), a plataforma em que a captura roda (a tela virtual é Linux) e em que job de CI entra a checagem do que é referenciado contra o que existe.

## Onde o trabalho está

- Triagem feita em 2026-10-10 (`0_TRIAGE.md`), sem pendência de resposta: quem abriu já respondeu a dúvida da pasta semeada. O caminho para #220 (site de documentação) depende desta: a pasta `docs/images/` só tem o README e os dois READMEs marcam a tabela como pendente.
- Verificado por leitura nesta cópia: `src/main/runner/executor.ts:440`, `src/shared/config/types.ts:302-337,902-903`, `src/shared/config/schema.ts:568`, `src/shared/config/defaults.ts:26`, `src/main/sandbox/display.ts:21`, `src/shared/cycles/templates/releaseFlow.ts:15-33`, `src/shared/cycles/templates/docsFlow.ts:18-26`, `scripts/release.sh:355-390,407-417`, `scripts/public-audit.mjs:6,109-131,148-190`, `.github/workflows/ci.yml:17-52`, `docs/images/README.md`, `README.md:9-17`, `README.pt-BR.md:9-17`, `docs/README.md:35`. Não verificado: abrir o workspace semeado, a igualdade byte a byte das capturas e a comprovação vinda de uma etapa com tela.
