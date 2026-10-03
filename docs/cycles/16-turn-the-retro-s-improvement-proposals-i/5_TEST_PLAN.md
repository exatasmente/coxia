# Plano de testes: como conferir esta entrega

## 1. O que este plano cobre

A retro deixa de levantar, guardar e mostrar propostas de melhoria; cada melhoria que ela levanta na conversa vira uma proposta em Ações que, aceita, cria a issue no rastreador e inicia a execução nela. Sem rastreador, sem projeto de issues ou sem escrita de issue, a melhoria fica só na conversa, com o motivo dito. Este plano diz o que fazer, o que esperar e o que já foi conferido.

## 2. O que já foi executado nesta etapa

A suíte de testes do projeto foi executada nesta árvore e terminou com código 0. A checagem de tipos também terminou com código 0. A suíte inclui os testes novos desta mudança e a paridade dos quatro textos de ouro dos prompts.

As linhas de erro que aparecem no meio da saída da suíte não são falhas: vêm de testes que pedem a reprovação de propósito (segredo redigido na mensagem, recusa de escrita externa, lint de traduções que deve reprovar) e a suíte terminou verde.

Nenhum outro gate rodou: a auditoria de tema, o lint de traduções como comando, a auditoria pública sobre a árvore real e o build ficaram sem execução.

## 3. Como preparar para repetir

1. `nvm use` para a versão de Node do `.nvmrc`.
2. `npm install` — sem as dependências nada roda.
3. Apontar os dados exploratórios para uma pasta vazia, nunca o espaço de trabalho real.
4. Rodar os gates do repositório: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`, `electron-vite build`.
5. Confirmar a paridade dos quatro textos de ouro dos prompts; se divergirem, regerar com `UPDATE_GOLDEN=1` e conferir o diff.

## 4. Cenários, passos e resultado esperado

### C1. Retro preparada não guarda melhorias e a tela não mostra a seção

- Fazer: preparar uma retro (o modelo responde com fala, números, funcionou, travou e retrabalho) e abrir a tela.
- Esperar: o arquivo gravado da retro não tem campo de melhorias; a tela não mostra a seção de melhorias propostas; relato, números, funcionou, travou, retrabalho e conversa continuam aparecendo.
- Visto: teste automatizado passou; a leitura confirma que a seção saiu da tela e dos dois catálogos.

### C2. Uma retro antiga, com melhorias gravadas, continua abrindo

- Fazer: gravar um arquivo de retro com o campo antigo de melhorias e abrir a retro.
- Esperar: a retro abre normalmente; o campo antigo é ignorado; nada quebra.
- Visto: teste automatizado passou.

### C3. Cada melhoria vira uma proposta em Ações, com o texto à vista

- Fazer: numa retro com rastreador e projeto de issues configurados, perguntar algo que faça o modelo levantar duas melhorias.
- Esperar: duas propostas na tela de Ações, uma por melhoria, na ordem em que vieram; o cartão mostra o título da melhoria e, no corpo, a dimensão, o problema de hoje, o que seria e a retro de origem; nada é escrito no rastreador nesse momento; a conversa diz que cada uma está em Ações.
- Visto: teste automatizado passou.

### C4. Aceitar a proposta cria a issue e inicia a execução

- Fazer: aceitar ("sim") a proposta.
- Esperar: a issue passa a existir no projeto de issues, com o título e o corpo montados; a criação fica registrada na trilha de auditoria; uma execução começa na issue sem um segundo "sim".
- Visto: teste automatizado passou.

### C5. A execução tem pasta de ciclo, conversa e documentos próprios

- Fazer: acompanhar a execução iniciada no C4.
- Esperar: a execução tem pasta de ciclo, conversa e documentos das etapas, seguindo até a revisão do código.
- Visto: não verificado. O teste prova que a execução começa na issue criada, não confere esses artefatos; eles vêm do caminho comum de início de tarefa.

### C6. Recusar ou pular não cria nada

- Fazer: recusar ou pular a proposta.
- Esperar: nada é criado no rastreador; nenhuma execução começa; a retro gravada continua sem melhorias.
- Visto: teste automatizado passou.

### C7. Num espaço de trabalho de teste a confirmação é recusada

- Fazer: num espaço de trabalho marcado como de testes, aceitar a proposta.
- Esperar: a proposta aparece normalmente; ao confirmar, a escrita é recusada antes de qualquer coisa sair da máquina; nada é criado, nenhuma execução começa e a proposta continua esperando.
- Visto: teste automatizado passou.

### C8. Sem rastreador, sem projeto ou sem escrita de issue, o motivo é dito

- Fazer: repetir a pergunta que levanta melhoria em quatro configurações — sem integração de rastreador, sem projeto de issues, integração que existe mas não escreve issue, e título recusado pelo host.
- Esperar: em cada caso, nenhuma proposta é criada e a conversa da retro diz o motivo; nada é escrito.
- Visto: testes automatizados passaram para os quatro casos.

### C9. Duas melhorias com títulos que colidem

- Fazer: levantar duas melhorias cujo título, depois de normalizado, coincide nos primeiros 40 caracteres.
- Esperar: uma proposta por melhoria, cada uma com a sua fala na conversa.
- Visto: teste automatizado passou. Era o achado da rodada anterior, agora coberto.

### C10. Textos de ouro e traduções sem menção a melhorias

- Fazer: rodar a suíte e o lint de traduções.
- Esperar: o prompt da retro não menciona melhorias nem carrega o parâmetro que as pedia; os prompts de retro das famílias Scrum e Kanban perdem a frase de melhorias; o prompt de pergunta da retro muda só nas chaves de resposta, com o texto igual; o lint de traduções passa.
- Visto: a suíte passou, o que inclui a paridade dos quatro textos de ouro; a leitura dos catálogos confirma a ausência da menção a melhorias.

### C11. O restante da retro continua igual

- Fazer: comparar a tela e o registro da retro com o que existia antes da mudança.
- Esperar: relato do período, números, funcionou, retrabalho, travado e conversa inalterados.
- Visto: só leitura — os campos e a tela seguem presentes; não houve comparação renderizada antes/depois.

### C12. O host não devolve o número da issue, ou a execução não começa

- Fazer: aprovar uma proposta num host que não devolve o número da issue, ou cujo início da execução falha.
- Esperar: a conversa diz o motivo (o host não devolveu o número; ou a issue foi aberta mas a tarefa não começou).
- Visto: não verificado por execução; as duas notas existem no código e no catálogo, mas nenhum teste exercita esses ramos.

### C13. O modelo levanta melhorias sem o prompt pedir

- Fazer: usar um modelo real numa retro sem menção a melhorias no prompt.
- Esperar: a retro levanta melhorias na conversa.
- Visto: não verificado — depende de execução real com um modelo.

### C14. O cartão da proposta renderiza como descrito

- Fazer: abrir a tela de Ações com uma proposta de retro.
- Esperar: sem a linha de subtítulo vazia; o texto da melhoria no corpo do cartão.
- Visto: não verificado por tela; a leitura mostra o subtítulo só quando há título de issue ou estágio.

### C15. O início num host real

- Fazer: aprovar a proposta num rastreador real.
- Esperar: a issue existe e a tarefa começa.
- Visto: não verificado; o teste usa um host falso, que prova a fiação, não o host.

## 5. O que passou, o que não passou e o que falta

- Passou por execução: C1, C2, C3, C4, C6, C7, C8, C9 e C10.
- Conferido só por leitura: C11 (estrutura da retro e da tela) e C14 (renderização do cartão pela fonte).
- Não passou: nenhum critério de aceite.
- Não verificado: C5, C12, C13, C14 (a tela rodando) e C15, além dos gates de tema, lint de traduções como comando, auditoria pública sobre a árvore real e build.
- Para uma pessoa: confirmar com modelo e rastreador reais se as melhorias são levantadas sem o prompt pedir e se a execução começa de fato depois de a issue existir; rodar os gates restantes.

## 6. Lacunas conhecidas

- A pasta de ciclo, a conversa e os documentos da execução iniciada não são conferidos por nenhum teste desta mudança; vêm do caminho comum de início de tarefa.
- Os ramos em que o host não devolve o número da issue ou em que a execução não começa existem no código, mas nenhum teste os exercita.
- A nota de lançamento ainda descreve o caso de duas melhorias com títulos coincidentes como não tratado, ao contrário do que o código e o teste mostram.
