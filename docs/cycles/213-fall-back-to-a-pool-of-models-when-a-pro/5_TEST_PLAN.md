# O conjunto de modelos com um provedor de verdade: o que foi exercitado e o que fica por exercitar

## O que esta etapa fez

O que foi exercitado, contra o provedor real, a API compatível com OpenAI do DeepInfra:
- o motor aberto;
- o app compilado da branch, com uma pasta de dados vazia (`CERIMONIAS_DATA_DIR`).

A chave veio do comando de chave do mantenedor, configurado como segredo do tipo "Comando"; o valor nunca passou pela sessão. O app rodou sob Xvfb e foi dirigido pelo Playwright. O motor foi chamado direto, a partir de uma cópia do código da branch, numa cópia descartável de um repositório de teste. Nenhum dado real do app foi tocado.

## Cenários

### 1. Um modelo ocupado passa a chamada ao próximo, na hora

- **Como foi conferido:** conjunto GLM-5.3-Flash → MiMo-V2.6-Flash → DeepSeek-V4.1-Flash no modo "só reserva", com `fail_fast` e `flex` ligados. A tarefa era corrigir um bug com teste falhando.
- **Resultado:** ✅
  - O GLM recusou na hora por estar ocupado.
  - A troca saiu com o motivo `overloaded`, e o MiMo terminou a tarefa.
  - O teste ficou verde, em 40 s e 6 chamadas.

### 2. O nível flex é pedido e o nível servido é registrado

- **Como foi conferido:** DeepSeek-V4.1-Flash sozinho, com `flex`, na mesma tarefa.
- **Resultado:** ✅
  - Todas as respostas vieram com `tier: flex` na sessão, e o teste ficou verde.
  - No cenário 1, o MiMo, que não tem `flex` no catálogo, foi atendido no nível normal sem erro. A sessão registrou `default`, como a spec prevê.

### 3. O custo real chega a cada chamada

- **Resultado:** ✅ As 11 chamadas dos dois cenários gravaram `costUsd` (o `estimated_cost` do servidor), o `x-request-id` e os tokens de raciocínio. O `onUsage` também levou o custo.

### 4. O teste de conexão lê o catálogo e a listagem rica

- **Primeira rodada:** ❌ O teste do provedor não lia a listagem rica:
  - nenhum `flex` por modelo;
  - nenhum aviso de aposentadoria;
  - "não verificado" em modelos que o catálogo diz terem ferramentas.

  Corrigido em `69972bb6`.
- **Segunda rodada:** ✅
  - 179 modelos listados.
  - As marcas ficaram certas por modelo: o DeepSeek com `flex` ligado, o MiMo e o GLM sem `flex`, e nenhum dos três com esforço, porque o catálogo não marca `reasoning_effort` para eles.
  - O MiMo deixou de aparecer como "não verificado".

### 5. A sugestão ordena com piso e não põe modelo minúsculo em primeiro

- **Primeira rodada:** ❌ A lista padrão saiu MiMo, `granite-4.2-3b`, `Ling-3.0-flash`… e "Usar a sugestão" faria de um modelo de 3B o modelo das cerimônias. Corrigido em `cf090e32`: nas atividades sem piso, os modelos com nota vêm antes dos sem nota. Confirmado pelo mantenedor.
- **Segunda rodada:** ✅
  - **Lista padrão:** MiMo, DeepSeek, GLM e depois os sem nota.
  - **Edição e shell:** DeepSeek primeiro; MiMo e GLM marcados "abaixo do piso" (90 e 70).
  - **Tela:** MiMo primeiro (80,8 no OSWorld-Verified).
  - "Usar a sugestão" pôs o MiMo como modelo dos papéis e as reservas na ordem. Nada foi salvo sem o salvar do assistente.

### 6. As telas novas aparecem e dizem o que fazem

- **Resultado:** ✅
  - O cartão do provedor mostra "Recursos do servidor", com as três chaves ligadas pelo atalho, o endereço da listagem rica e "Usar os da predefinição".
  - A seção "Como o conjunto é usado" traz os três modos.
  - Os pisos são editáveis.
  - As notas aparecem com a fonte, como "autodeclarada" ou "de terceiros".

## Fora desta etapa (não exercitado)

- **Execução real do runner no app,** e com ela a conversa da execução com as mensagens de troca. As mensagens têm testes de unidade.
- **Subagente de tela ao vivo,** cerimônia por voz com o conjunto, celular pareado e início de etapa no Claude SDK com limite de taxa real.
- **Fila do flex longa** contra o `stageIdleMs`. Nos testes a fila foi curta e o sinal de vida não chegou a disparar.
- **Formato de catálogo de agregador,** que não foi conferido contra o serviço, por desenho.

## Benchmark

Foi feito à parte, no mesmo dia, comparando os modos e os modelos. Não fica no repositório; o resumo está nas notas do ciclo do workspace. O resultado orientou os pisos 90/70 e a recomendação de pôr o DeepSeek-V4.1-Flash em primeiro.
