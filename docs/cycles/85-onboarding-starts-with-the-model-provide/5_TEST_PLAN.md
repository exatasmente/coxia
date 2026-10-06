# O teste que confere se a instalação nova começa pelo modelo e diz o que falta sem ele

## O que este plano confere

A instalação nova abre no idioma e no nome; a escolha de modelo é o passo seguinte, antes de qualquer integração; esse passo pode ser pulado, continua bloqueando "Continuar" sem provedor, e mostra, nos dois idiomas, a frase de uma linha que diz que sem provedor nenhum agente roda. Nada além disso muda: nenhuma tela nova, nenhum provedor novo, nenhuma mudança no teste de conexão, e o passo de documentação dos agentes continua listando pastas de skills como hoje.

## O que foi verificado nesta etapa

### Por execução

- Testes do assistente, dos catálogos e do retrato dos catálogos da main: 3 arquivos, 22 testes, todos verdes. Travam a ordem dos passos por nome, derivam o conjunto dos passos puláveis da própria ordem e percorrem as telas do assistente procurando chave ausente em qualquer um dos idiomas.
- Ordem, contador e botões, exercitados sobre as funções reais: a sequência é `language, models, sdk, projects, integrations, docs, cycle, voice, review`; são 9 passos visíveis numa configuração neutra; o idioma é o passo 1 e o modelo o passo 2; são puláveis `models, sdk, projects, integrations, docs, cycle, voice` e não são puláveis `language` e `review`; uma instalação nova abre no passo `language`.
- Retomada: um progresso guardado no passo de modelos volta no passo de modelos; um progresso guardado num passo de outra ordem (integrações, com o SDK pulado) volta no mesmo passo, com o mesmo histórico; um passo desconhecido cai no primeiro passo.
- Bloqueio de "Continuar", exercitado sobre a função pura que o rodapé chama: com zero provedores e papéis sem modelo, o passo de modelos devolve o pedido de ao menos um provedor; com um provedor e os papéis recomendados, não devolve problema; no passo de idioma nunca devolve problema.
- Tipos, tema, textos e auditoria pública: `npx tsc --noEmit` sem saída; a auditoria de tema com 55 pares em cada tema em ou acima de 4.5:1 e nenhuma cor literal nova (as 8 de `api.ts` já existiam); o lint de textos com 4055 chaves iguais nos dois idiomas e zero literais fora de `t()` no renderer; a auditoria pública limpa em 911 arquivos.
- Suíte inteira, 222 arquivos: 219 arquivos verdes e 7 testes vermelhos em 3 arquivos que não renderizam o assistente — solução de conflitos, liberação de release e cadeia de agentes —, todos com estouro de tempo (um hook de 10 s, testes de 5 s) ou com estado assíncrono, sem relação com esta mudança. Os arquivos do assistente, dos catálogos e do retrato da main passaram dentro da rodada inteira. O mesmo trio rodando sozinho foi iniciado e as passagens individuais apareceram no log; o resumo final não chegou a ser lido antes de o tempo de comandos desta etapa acabar.
- Três frases, medidas nos próprios catálogos: a frase nova tem 94 caracteres em inglês e 104 em português; a linha de abertura do assistente tem 169 e 170. A de assinatura que já existia tem 152 e 173, e continua no lugar.

### Só por leitura

- Os botões do rodapé: "Configurar depois" é oferecido quando a execução é de instalação nova e a posição é a primeira; "Pular esta etapa" é oferecido quando o passo está no conjunto dos puláveis e não é o último. As duas condições são de posição e de identidade, então acompanham a ordem sozinhas.
- Onde a frase nova é montada: junto do aviso de assinatura, no alto do passo de modelos, com o mesmo componente de aviso e tokens de tema.
- O passo de documentação dos agentes e a lista de pastas de skills: não foram tocados.

## O que este plano não cobre

- **A tela de verdade.** Nenhuma janela do aplicativo foi aberta nesta etapa, em pasta de dados alguma. Que a instalação nova abre em "Idioma e nome" com 1 de 9, que "Continuar" cai em "Modelos" com 2 de 9 e que a frase aparece ao lado do aviso de assinatura são conclusões do comportamento das funções e dos textos, não de uma tela vista.
- **Uma linha, de fato.** Se cada frase fica em uma linha depende da largura da janela e da fonte; o que se mediu foi o comprimento do texto. Nas larguras estreitas pode quebrar.
- **A marcação da etapa pulada no trilho** e o caminho "Pular esta etapa" → passo do SDK não foram vistos; por leitura, pular não chama a rotina que fecha o assistente.
- **A conferência à mão numa pasta de dados própria**, que nenhuma etapa deste ciclo fez.
- **A documentação.** A seção do assistente do documento de configuração (linhas 138 e 286, nas duas línguas) continua contando a regra antiga, de que todos os passos menos o primeiro e o último podem ser pulados, e a linha do changelog descreve a mecânica mais do que a nota precisa. Os dois são achados de sugestão, não bloqueiam, e ficam para quem conduz a entrega.

## Como uma pessoa confere, na própria pasta de dados

Sempre numa pasta de dados própria e nunca num workspace real: apontar a pasta de dados para uma pasta vazia, abrir o aplicativo como instalação nova e seguir —

1. O assistente abre em "Idioma e nome", trilho e contador em 1 de 9, com "Configurar depois" e sem "Pular esta etapa".
2. "Continuar" vai para "Modelos", contador 2 de 9, com a frase de que sem provedor nenhum agente roda visível ao lado do aviso de assinatura, no idioma escolhido.
3. "Pular esta etapa" em "Modelos" segue para o passo do Claude Agent SDK, marca o passo como pulado no trilho e não fecha o assistente; "Continuar" sem provedor continua mostrando "Adicione ao menos um provedor de modelo".
4. "Configurar depois" no primeiro passo fecha o assistente, e nenhum outro passo o oferece.
5. Fechar o aplicativo num passo do meio e reabri-lo volta ao mesmo passo.
6. A linha de abertura do assistente diz que ele abre pelo idioma e pelo nome e que os passos depois dele, até a revisão, podem ser pulados.
