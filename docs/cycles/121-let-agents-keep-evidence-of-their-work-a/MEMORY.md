# Memória do ciclo

## Decisões

- Issue classificada como pedido de funcionalidade: um agente guarda o que capturou como comprovação da etapa e marca a imagem; a pessoa vê na execução e a comprovação pode ir ao host de código.
- Refino do produto concluído: spec funcional em `1_SPEC.md`, com 27 regras em quatro blocos, o fora do escopo e 13 critérios. Prioridade proposta `priority:high`; marco proposto `0.7.0` (a lista de marcos do rastreador não foi alcançada; fica a confirmar). Portão 1 aprovado pela pessoa.
- **A base de anexos entra nesta issue** (regra 8): o armazenamento de anexos e a mensagem que carrega arquivos, mais `ViewImage` e a leitura da imagem da pasta de saída (regra 15), que a issue citava como prontas e não existem na linha principal.
- Plano técnico em `2_PLAN.md`. Decisões de desenho fixadas: comprovação em `<workspace>/evidence/<runId>/…`, id `ev-<algarismos>` estável na execução, some com a execução; a escolha `runner.evidence: 'app' | 'cycle'` (padrão `'app'`) vira esquema de config 13 com passo `v12ToV13`; a raiz de leitura é a pasta `out` do `stageDir` (o `/coxia/out` é o caminho de dentro da sandbox), resolvida no host pelo `checkPath`; tipo pelo conteúdo (PNG, JPEG, GIF, WebP, `text/plain`, PDF) e teto de tamanho como constante; `AnnotateImage` desenha no processo principal a partir de dados, sem biblioteca de imagem nas dependências (o desenho é um módulo próprio, com o decode como ponto frágil); o upload ao host é uma operação nova de `VcsWriteOp` antes da escrita do comentário, no mesmo grupo, pela porta de Ações.
- Decisões fixadas na spec: formatos aceitos e recusados; tipo pelo conteúdo; a comprovação é anexo da mensagem da conversa; as quatro travas contra dado privado (padrão só nos dados do app, borrão, revisão antes do "sim", origem restrita à pasta de saída); o que cada host suporta ao embutir imagem, com o texto "quantas comprovações existem e que estão no app" onde não der.

## Restrições

- O que existe hoje (conferido por leitura): a pasta de saída da etapa é `<stageDir>/out`, montada como `/coxia/out` dentro da sandbox, e é apagada com a etapa; a `Shell` liga nos dois motores por `sandbox/tool.ts`/`engineTool.ts`; o cenário de QA já cita comprovação por número de comando (`executed`/`read`); `Settings › Runner` existe sem nenhuma escolha de onde guardar comprovação; workspace de teste recusa escrita externa; escrita externa de agente autônomo sai auditada e a dos outros espera um "sim"; nenhuma biblioteca de imagem nas dependências e nenhum desenho de imagem no processo principal; a mensagem da conversa não tem campo de anexo; nenhum dos três provedores tem upload de imagem no `planWrite`; a configuração está no esquema v12.
- O que **não existe** na linha principal: `ViewImage`, `readOutputImage`, armazenamento de anexos, decisão de onde guardar a comprovação e qualquer imagem em cenário de QA.
- No histórico do repositório há documentos de outra issue, em outra ramificação, que descrevem onde o anexo ficaria (`workspaces/<id>/…`), o tipo pelo conteúdo e a mensagem carregando arquivos. Esse trabalho **não está na linha principal**; não verificado se essa ramificação será mesclada — se for, parte da base pode chegar de fora.
- Fora do escopo por decisão da issue: vídeo e gravação de tela; edição da comprovação à mão no app. Fora do escopo por leitura da spec: a comprovação não é artefato de etapa (não entra em `produces`/`reads`); anotar documento que não seja imagem; escolher o provedor de envio; automatizar a borra.
- Material público: a comprovação não pode levar segredo, token ou dado privado a um commit ou comentário; as travas são o padrão só nos dados do app, o borrão, a revisão antes do "sim" e a origem restrita à pasta de saída.
- Regras do squad que o plano respeita: toda escrita externa passa por Actions; mudança de config precisa do passo de migração em `STEPS` e dos três de `types.ts`, `defaults.ts` e `schema.ts`; nada de empresa, pessoa, host, número real de issue ou segredo no material.

## Tentado e descartado

- Rodar os gates do repositório: descartado, é trabalho de implementação e a etapa só lê.
- Esperar de fora a base de anexos como issue separada: descartado depois da resposta da pessoa; a base entra nesta entrega.
- Biblioteca de imagem nas dependências para desenhar: descartado (binário nativo/tamanho); o desenho é um módulo próprio a partir dos dados.
- Mudar `runner.evidence` pelo navegador pareado: descartado, o campo decide o que entra num commit; só o computador muda, como `runner.identity`.

## Perguntas abertas

- Nenhuma de quem abriu a issue. A do portão segue na spec e no plano: se a publicação da imagem de um agente autônomo sai sozinha (como as outras escritas dele) ou espera sempre o "sim", como o push e o pull request. O plano desenha as duas (o envio é uma escrita comum na porta de Ações) e não trava o trabalho.

## Onde o trabalho está

Triagem em `0_TRIAGE.md`, refino em `1_SPEC.md` e plano em `2_PLAN.md`, na pasta do ciclo, em `docs/cycles/[redacted]/`. Portão 1 aprovado. Próxima etapa: portão 2 e, depois, a implementação (a ordem do trabalho e os testes estão no plano). Nada de código foi tocado nesta etapa.
- Resposta: voce pode estar com a versã oda main desatualizada, verifique isso, se não existir deve ser criado <!-- answer:14 -->
- Passagem support → product-owner: Refinamento do produto: transformar o pedido em spec funcional (as quatro partes estão na issue, falta a ordem e em que etapa do ciclo cada uma entra) e fixar no texto o que o critério de aceite não nomeia: captura de tela e imagem da pasta de saída como formatos aceitos e o que é recusado; o que é comprovação sensível (segredo, token, dado privado) e como a marca de borrão e o padrão "só nos dados do app" mantêm isso fora de um commit e de um comentário; o formato do id de comprovação citado por um cenário de QA e pela saída de etapa (hoje o cenário só cita números de comando); e o que cada h… <!-- handoff:6 -->
- Passagem product-owner → pessoa: Levar a spec de `1_SPEC.md` ao portão 1 e, depois, ao plano técnico. A spec fixa o que o plano precisa cobrir, e agora inclui a base de anexos desta entrega (regra 8) e as duas peças de imagem que a issue citava como prontas (regra 15), porque a linha principal do repositório não as tem. O plano decide: onde a comprovação fica em `workspaces/<id>/…` e como é apagada com a execução; como o armazenamento de anexos e a mensagem que carrega arquivos entram (é o pré-requisito interno, não de fora); como a pasta de comprovações da pasta do ciclo é copiada e commitada com a etapa quando o espaço de t… <!-- handoff:60 -->
- Passagem product-owner → pessoa: Portão 1 aprovado. <!-- handoff:65 -->
