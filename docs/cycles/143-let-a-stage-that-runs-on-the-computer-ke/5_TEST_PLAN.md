# A QA da etapa de computador: o que foi conferido para a comprovação não se perder

## O que este plano confere

Cada critério de aceite do refino virou um cenário numerado (o que fazer, o que esperar),
seguido de um cenário de guarda (auditoria pública) e um de aplicação real, que não pôde ser
exercitado. Os cenários 1 a 9 foram executados nesta etapa por comandos reais; o 10 ficou
registrado como não executado, com o motivo.

## Cenários executados nesta etapa

### 1. Uma etapa de host que testa interface guarda comprovação e o id aparece (ev-4, ev-3)

O json de QA com `shell: host` e sessão falsa que declara a pasta dos disparos, exercitando
os casos do arquivo de execução ponta a ponta (`runner-evidence-run`) e das ferramentas
(`runner-evidence`): o agente guarda um arquivo da pasta de saída pela ferramenta, o id
guardado aparece, um cenário de QA o cita e ele chega ao host de código como numa etapa de
sandbox. Passou: a rodada de critérios tem 115 testes em 7 arquivos, todos verdes, e a suíte
inteira (ev-3) confirma.

### 2. Caminho fora da pasta de saída do host é recusado (ev-4)

Caminho absoluto de fora, `..` e link, sobre uma raiz que é a pasta do host (`evidence-path`,
`runner-evidence`): a recusa sai com as palavras de sempre e nada é guardado. Passou.

### 3. O que foi visto e não guardado fica, antes de a pasta sumir (ev-4)

O QA de host abre uma imagem da pasta de saída e não a guarda (`runner-qa-repair`): ao fim da
etapa o id já está na execução no instante do fecho, e o caminho fica dito na conversa quando
não pôde ser guardado. A ordem guarda-antes-de-fechar está coberta pelo teste que lê o estado
da execução dentro do fecho. Passou.

### 4. Etapa de host sem teste de interface continua como hoje (ev-4)

Sessão de host sem pasta de saída (`host-gui`): nenhuma pasta declarada, nenhuma ferramenta,
o campo de comprovação não entra no que o agente responde e o texto não menciona comprovação
(caso do executor sem `gui`). Passou.

### 5. O texto que a etapa lê nomeia a pasta real (ev-4)

O `system` da chamada de QA de host traz `SaveEvidence` e o caminho real da pasta, não traz
`/coxia/out` e não traz a chave crua (`runner-evidence-run`); a variante `.host` e a escolha
da chave estão cobertas em `cycle-prompts`. Passou.

### 6. A etapa com sandbox não muda (ev-3, ev-4)

A suíte de sandbox e de comprovação da sandbox passou sem mudança de expectativa, na suíte
inteira e na rodada de critérios. O único ajuste aceito era o da raiz no teste do resolvedor,
já feito por quem implementou. Passou.

### 7. Os dois catálogos dizem o mesmo (ev-5)

`npm run i18n:lint`: 4622 chaves nos dois idiomas, saída limpa. Passou.

### 8. A mudança é contada a quem usa (ev-8)

Lido no arquivo na pasta, o registro de mudanças tem, sob `## [Unreleased]`, a linha do que
muda para o usuário, sem número de questão, nome de arquivo ou função. Passou (leitura).

### 9. A conferência pública fica limpa (ev-6, ev-7)

`node scripts/public-audit.mjs` — 1215 arquivos, nada que pertença a uma empresa ou a uma
pessoa; `node scripts/theme-audit.mjs` — sem cor literal nova. `npx tsc --noEmit` sem saída.
Passou.

## Cenário não executado

### 10. Modo host real, com sessão real e disparos de verdade (não executado)

Uma etapa de host real numa execução real, guardando a comprovação com o app de janela. Não
executado: o ambiente desta etapa só comporta navegador sem janela, e não houve sessão real de
host aberta por etapas deste ciclo — nenhum cenário da especificação exige tela: todos os
critérios de aceite 1 a 8 estão cobertos por testes automatizados. Fica como não verificado
junto com o que a revisão já registrou (etapa de host que roda de novo sobre comprovação
guardada; semântica dos argumentos da ferramenta de comprovação na forma do motor aberto).

## Portões e o que não coube a esta mudança

A suíte inteira rodou com 2 falhas, nos dois casos do verificador de instalação de voz
(`canInstall` e o aviso `disk-low`): a pasta temporária do ambiente tem 512 MB e a verificação
do disco reporta espaço baixo, enquanto o teste espera que instalar seja possível. São os
mesmos 2 falhas que a tentativa anterior desta etapa registrou, de limite de disco do
ambiente, fora do fluxo de integração contínua e sem relação com esta mudança. O full log está
guardado (ev-3).

## Comprovações citadas

- ev-3: log da suíte inteira (4337 testes passando, 2 falhas de disco de voz).
- ev-4: rodada dos 7 arquivos de critérios, 115 testes, saída 0.
- ev-5: lint de textos, 4622 chaves nos dois idiomas.
- ev-6: auditoria de tema, saída 0.
- ev-7: auditoria pública, 1215 arquivos.
- ev-8: trecho do registro de mudanças sob `## [Unreleased]`.
- ev-2: resumo de todos os portões com os códigos de saída.

## Como uma pessoa confere-fora deste ambiente

Numa pasta de dados própria (nunca num workspace real): rodar uma execução cuja etapa de QA
esteja em `shell: host` com a pasta de navegadores ligada (ou a tela virtual do QA ligada),
pedir à etapa que tire uma captura e a guarde; conferir que a execução mostra a comprovação
com id e que o comentário da etapa no host de código a cita. E conferir que uma etapa de QA em
`shell: host` sem navegadores nem tela segue sem ferramenta de comprovação, como hoje.

## O que este plano não cobre

- O modo host numa execução real (cenário 10, acima).
- O comportamento de uma etapa de host que roda de novo sobre uma comprovação já guardada —
  nenhum teste o exercita e esta etapa também não o fez.
- A semântica dos argumentos de `SaveEvidence` na forma do motor aberto: os nomes só têm
  teste numa das formas de motor.
- A tela do aplicativo: nenhuma janela foi aberta, e as provas desta etapa são de comandos e
  leitura.

## Resultado dos cenários

- 1. Uma etapa de host que testa interface guarda comprovação e o id aparece na execução: passou (executado na sandbox) — Rodada do executor ponta a ponta com sessão de host falsa que declara a pasta de saída (runner-evidence-run) e das ferramentas (runner-evidence): o id guardado aparece na execução e o cenário o cita; 115 testes em 7 arquivos, saída 0.
- 2. Caminho fora da pasta de saída do host é recusado: passou (executado na sandbox) — Caminho absoluto de fora, .. e link, contra a raiz da pasta do host (evidence-path, runner-evidence): recusa com as palavras de sempre, nada guardado.
- 3. O que foi visto e não guardado fica antes de a pasta sumir: passou (executado na sandbox) — Caso de runner-qa-repair: imagem aberta e não guardada aparece na execução no instante do fecho, com o motivo na conversa quando não cabe; ordem guarda antes de fechar coberta pelo teste.
- 4. Etapa de host sem teste de interface continua como hoje: passou (executado na sandbox) — host-gui sem pasta declarada e o caso do executor sem gui: nenhuma pasta, nenhuma ferramenta, campo de comprovação ausente, texto sem menção a comprovação.
- 5. O texto que a etapa lê nomeia a pasta real: passou (executado na sandbox) — O system da chamada de QA de host traz SaveEvidence e o caminho real, não traz /coxia/out nem a chave crua (runner-evidence-run), com a variante .host coberta em cycle-prompts.
- 6. A etapa com sandbox não muda: passou (executado na sandbox) — Suíte de sandbox e de comprovação da sandbox passou sem mudança de expectativa, na suíte inteira e na rodada de critérios.
- 7. Os dois catálogos dizem o mesmo: passou (executado na sandbox) — npm run i18n:lint: 4622 chaves nos dois idiomas, saída 0.
- 8. A mudança é contada a quem usa: passou (executado na sandbox) — Lido no arquivo: linha sob ## [Unreleased] descrevendo o que muda para o usuário, sem número de questão, arquivo ou função.
- 9. A conferência pública e os portões de tipagem e tema ficam limpos: passou (executado na sandbox) — npx tsc --noEmit sem saída; theme-audit saída 0; public-audit 1215 arquivos, nada que pertença a uma empresa ou a uma pessoa.
- 10. Modo host real com sessão real e tela: não rodou (lido) — Não executado: o ambiente só comporta navegador sem janela e nenhuma tela com janela está disponível nesta etapa; nenhum critério de aceite o exige (todos os 8 estão cobertos por testes automatizados). Sem comprovação por isso.
