# Plano técnico para abrir discussões de MR por projeto e número

## Mudanças por arquivo

1. **src/renderer/src/App.tsx**
   - Alterar o roteamento da tela `discussions` para aceitar `project` e `number` além de `ref`.
   - Quando `project` e `number` estiverem presentes, usar esses valores para buscar a MR; caso contrário, usar o comportamento atual baseado em `ref`.

2. **src/renderer/src/screens/Discussions.tsx**
   - Modificar o hook que carrega a lista de MRs para aceitar `project` e `number` como parâmetros.
   - Adicionar chamada ao novo seletor `getMergeRequestByProjectAndNumber` (criado em `src/main/feedback.ts`).
   - Garantir que a lista seja recarregada a cada abertura quando vier de projeto + número (regra 7 da spec).
   - Manter o comportamento atual quando vier de `ref` (card do dia).

3. **src/main/feedback.ts**
   - Criar função `getMergeRequestByProjectAndNumber(project: string, number: number)` que:
     * Valida o projeto contra a lista de projetos permitidos do workspace (mesma lógica de `readTool.ts`).
     * Chama o provedor VCS para obter a MR por projeto e número.
     * Retorna a MR ou lança erro com motivo.
   - Atualizar `listDiscussions` para usar essa nova função quando receber `project` e `number`.
   - Atualizar `explainDiscussion` para funcionar sem o card inteiro: quando o card não estiver disponível, usar apenas a MR e o thread para gerar o prompt (perdendo a linha de especificação).
   - Mantém o comportamento atual quando o card estiver presente (regras 8 e 12).
   - As regras de proposta e resolução continuam exigindo o card (regra 13).

4. **src/shared/push.ts**
   - Adicionar campo `number` ao tipo `PushTarget` (ou reutilizar `id` se decidir pela alternativa técnica; a decisão técnica Q1 será registrada no plano).
   - Atualizar a lógica de envio de notificação para incluir o número da MR quando disponível.
   - Garantir que a notificação de discussões leve projeto e número (regra 19).

5. **src/renderer/src/pushTarget.ts**
   - Atualizar a tradução de `PushTarget` para tela: se houver `project` e `number`, usar esses valores; caso contrário, usar `ref` como hoje.
   - Mantém a validação de referência existente para compatibilidade com cards do dia.

6. **src/main/persona/openScreen.ts**
   - Modificar a função `openScreen` para aceitar `project` e `number` como parâmetros alternativos a `ref`.
   - Quando `project` e `number` estiverem presentes, abrir a tela de discussões com esses valores.
   - Mantém o comportamento atual quando apenas `ref` estiver presente.
   - Atualiza a lógica de geração do rótulo do botão para usar `<group/repo>!<n>` quando for MR (regra 10).

7. **src/main/mentions/answer.ts**
   - Adicionar nova ferramenta de ação `openDiscussion` que:
     * Recebe `project` e `number` da MR.
     * Valida o projeto contra o escopo do pedido (regras 3, 4 e 5).
     * Retorna o alvo (projeto + número) para que a pessoa confirme a abertura (regra 15).
     * Não abre a tela sozinha (regra 15 e 17).
   - Integrar ao fluxo de respostas de agentes em conversa.

8. **src/shared/i18n/ui-persona.en.json** e **ui-persona.pt-BR.json**
   - Adicionar nova chave para o rótulo do botão de discussões quando for MR: "Open the discussions for {project}!{number}" e equivalente em português.

## Ordem das mudanças

1. Atualizar tipos e seletores em `src/main/feedback.ts` (função `getMergeRequestByProjectAndNumber`).
2. Modificar o roteamento em `App.tsx`.
3. Atualizar `Discussions.tsx` para usar o novo seletor.
4. Atualizar `explainDiscussion` em `feedback.ts` para funcionar sem card.
5. Atualizar `push.ts` e `pushTarget.ts` para incluir o número da MR.
6. Modificar `openScreen.ts` na persona.
7. Adicionar ferramenta de ação em `mentions/answer.ts`.
8. Adicionar novas strings de internacionalização.

## Testes por comportamento

- **test/discussions.router.test.ts**: Verificar que rotas com project/number levam à tela de discussões e que rotas com ref continuam funcionando.
- **test/discussions.screen.test.ts**:
  * Testar carregamento de lista quando vier de project/number (com validação de projeto permitido).
  * Testar que a lista é recarregada a cada abertura (sem usar memória do card).
  * Testar comportamento quando vier de ref (card do dia) - deve usar memória existente.
- **test/feedback.merge-request.test.ts**:
  * Testar `getMergeRequestByProjectAndNumber` com projetos permitidos e não permitidos.
  * Testar `listDiscussions` com project/number.
  * Testar `explainDiscussion` sem card (verificar que não quebra e perde a linha de especificação).
  * Testar que proposta e resolução continuam indisponíveis sem card.
- **test/push-target.test.ts**: Verificar traduções corretas para project/number e ref.
- **test/persona.open-screen.test.ts**: Verificar abertura com project/number e ref.
- **test/mentions.answer.tool.test.ts**: Verificar nova ferramenta de ação e sua validação de escopo.
- **test/i18n.test.ts**: Verificar que novas strings estão presentes nos dois catálogos.

## Riscos e mitigação

- **Risco**: Quebrar compatibilidade com cards do dia.
  * Mitigação: Todos os caminhos que usam `ref` mantêm o comportamento atual; testes específicos para cards do dia.

- **Risco**: Permitir leitura de projetos fora do workspace.
  * Mitigação: Reutilizar a mesma validação de projeto permitido de `readTool.ts` na nova função; testes de recusa para projetos não permitidos.

- **Risco**: Explicação sem card ficar confusa devido à perda de contexto.
  * Mitigação: Seguir a decisão da spec (perder a linha de especificação); testes verificam que a explicação não quebra.

- **Risco**: Esquecer de atualizar algum destino que exige referência (notificação, persona, etc).
  * Mitigação: Lista explícita de três lugares na spec; revisão cruzada durante implementação.

- **Risco**: Botão da persona exceder limite de quatro por resposta.
  * Mitigação: Manter a mesma lógica de limite e não repetição; testes de UI.

- **Risco**: Agente abrir tela sem confirmação da pessoa.
  * Mitigação: A ferramenta de ação apenas retorna o alvo; a abertura só ocorre com ato da pessoa (testes de interação).

## Decisões técnicas

- **Q1 (campo do número no destino)**: Optamos por adicionar um novo campo `number` ao `PushTarget` para evitar sobrecarregar `id` ou `mr`. Isso mantém a semântica clara e evita conflitos com uso existente desses campos.

- **Q2 (agente não persona pode abrir tela)**: Sim, conforme spec. A ferramenta de ação retorna o alvo e nunca abre sozinha; a pessoa deve tocar para abrir.

- **Q4 (explicação sem card)**: A explicação continua e perde a linha do card (alternativa a), conforme especificado na spec.

Outras decisões (Q3, Q5, Q6, Q7) são deixadas para o aceite ou serão definidas pelo product owner conforme a spec.

## Observações

- O rigor de projeto no caminho da tela é alcançado reutilizando a validação de `readTool.ts`.
- A leitura da lista é recarregada a cada abertura para MRs fora do dia (regra 7).
- Nada é escrito no host por esta mudança (regra 14).
- O agente que não é a persona ganha exatamente uma nova ferramenta de ação (regra 15).
