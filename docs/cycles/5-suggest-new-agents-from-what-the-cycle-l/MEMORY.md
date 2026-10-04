# Memória do ciclo

## Decisões

- Tipo: pedido de funcionalidade (`enhancement`). Nada é aplicado em silêncio: aceitar cria um agente comum e editável depois.
- A resposta de quem abriu fechou as quatro decisões de produto (fonte, registro, onde aparece, quando é oferecida) e o refino fechou o resto na spec funcional `1_SPEC.md`:
  - **Fonte:** só o histórico já gravado — execuções, comandos permitidos e decisões/atas das cerimônias —, sem gravar nada novo na v1; a transcrição completa fica para depois. Sem evidência, não há sugestão; abaixo do limiar, nada é oferecido.
  - **Registro:** nos dados do workspace, nunca no repositório, por sugestão, sem prazo, com proposta + evidência + decisão + quem + quando. A recusa guarda a impressão (papel + etapa + tipo de evidência); a mesma impressão só volta com evidência nova, e o cartão diz que foi recusada antes, quando e o que mudou.
  - **Onde aparece:** proposta em Ações, com nome, papel, etapa, rascunho de prompt, permissões no mínimo (somente leitura, sem comandos) e evidência com links. Aceitar cria agente comum; editar abre o editor de agente em Configurações › Time já preenchido; recusar pede motivo opcional.
  - **Quando:** a pedido (botão "Sugerir agentes" em Configurações › Time) e, por conta própria, só no fim da retro, no máximo duas, só acima do limiar e sem bater com recusa. Nunca no meio de execução ou cerimônia.
- Proposta de prioridade e marco (ver resumo e comentário): prioridade **normal** (segunda de três) e marco **próximo ciclo de aprendizado**, se existir; a pessoa decide. Justificativa: funcionalidade de produto nova, sem bloquear outras, dependente do runner já entregue.
- Resposta: ### Resposta **1. De onde a sugestão nasce.** Do histórico que o app já grava, sem gravar nada novo na primeira versão: - das **execuções**: perguntas que chegam à pessoa (`needs-person`) sobre o mesmo tema em execuções diferentes, devoluções repetidas para a mesma etapa pelo mesmo motivo, rodadas de revisão e cenários de QA que voltam com o mesmo tipo de achado, e etapas que a pessoa assume à mão (pula, refaz ou responde no lugar do agente); - dos **comandos permitidos**: o mesmo comando que a pessoa permite de novo e de novo é um passo manual repetido; - das **cerimônias**: as decisões e ata… <!-- answer:24 -->

## Restrições

- Repositório público: nada de nome de empresa, pessoa, host ou número de issue real em código, teste, fixture ou doc. O registro da decisão e a evidência vivem nos dados do workspace, nunca no repositório.
- Sugestão nasce somente leitura e sem comandos; nada acima do mínimo, e nunca aplicada sem o "sim".
- A v1 não pode depender de gravar história nova nem da transcrição das cerimônias.
- Não misturar com a #16 (melhorias da retro viram tarefa) nem com a #8 (os três trabalhos das cerimônias): da #16 herdar só a forma "proposta em Ações" e o gancho do fim da retro.
- Cada string de interface passa por `t()` nos dois catálogos; tema por tokens.

## Tentado e descartado

- Descartado tratar "duração de etapa" como fonte (a resposta trocou por "etapas que a pessoa assume à mão" e pelo histórico por execução).
- Descartado voltar a perguntar a quem abriu: nenhuma questão de produto ficou aberta.
- Descartado na spec: criar/alterar etapas do fluxo a partir da sugestão (a sugestão aponta etapa existente); sugerir permissões acima do mínimo; oferecer sugestão no meio de execução/cerimônia.

## Perguntas abertas

- Nenhuma de produto. O plano técnico precisa fechar duas de desenho: (1) onde encaixa a etapa que o agente novo cobriria — o ciclo é dado do workspace (`devCycle.stages`/`flows`), e hoje só existe `runs:migrateFlow`, que mexe no fluxo de uma execução, não no do workspace; (2) por onde se lê a evidência de "comando permitido de novo e de novo" — o pedido de comando só vive enquanto a etapa vive, e o que sobra é a linha de auditoria (`src/main/runner/service.ts:271-309`, `:771-779`). Ambas são recorte técnico, não pergunta à pessoa.

## Onde o trabalho está

- `docs/cycles/[redacted]/` com `0_ISSUE.md`, `0_TRIAGE.md` e `1_SPEC.md` (esta etapa). Nada foi implementado, executado ou commitado.
- Refino concluído: spec funcional pronta. A próxima etapa é o plano técnico (fechar os dois pontos de desenho), depois implementação, revisão e teste.
- Passagem support → product-owner: Refinar a sugestão de agentes novos a partir da resposta de quem abriu: a spec funcional e o plano técnico precisam fechar (1) de que histórico a sugestão é derivada, com as fontes apontadas — perguntas `needs-person` do mesmo tema entre execuções, devoluções repetidas para a mesma etapa pelo mesmo motivo, rodadas de revisão e cenários de QA que repetem o tipo de achado, etapas que a pessoa assume à mão, o mesmo comando aprovado repetidas vezes e as decisões/atas das cerimônias —, lendo só o que o app já grava (run JSON, `historico/`, atas) e sem gravar nada novo na v1; (2) como a sugestão cit… <!-- handoff:27 -->
