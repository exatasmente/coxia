# Plano de testes: as propostas de melhoria da retro viram tarefa

## 1. O que este plano cobre

A retro deixa de levantar, guardar e mostrar propostas de melhoria; cada melhoria que ela levanta na conversa vira uma proposta em Ações que, aceita, cria a issue no rastreador e inicia a execução nela. Sem rastreador, sem projeto de issues ou sem escrita de issue, a melhoria fica só na conversa, com o motivo dito. Este plano diz o que fazer, o que esperar e o que já foi conferido.

## 2. O que já foi executado

Neste worktree, o app rodou dois comandos:

- `npm test` → saiu com código 127 (`vitest: not found`).
- `npm run typecheck` → saiu com código 127 (`tsc: not found`).

A causa é a árvore de trabalho não ter `node_modules`. Por isso **nenhum teste automatizado rodou** e nenhum critério de aceite foi provado por execução. O que segue como "conferido" foi conferido apenas por leitura dos arquivos de código, teste, catálogo e texto de ouro.

## 3. Como preparar o ambiente para rodar

1. Instalar as dependências na árvore (`npm install`) e usar a versão de Node do `.nvmrc` (`nvm use`), pois sem os binários nada roda.
2. Apontar os dados exploratórios para uma pasta vazia (nunca o espaço de trabalho real), como manda o repositório.
3. Rodar os gates do repositório, nesta ordem: `npx tsc --noEmit`, `npx vitest run`, `node scripts/theme-audit.mjs`, `npm run i18n:lint`, `node scripts/public-audit.mjs`, `electron-vite build`.
4. Regenerar os quatro textos de ouro dos prompts com `UPDATE_GOLDEN=1` (comando que escreve no repositório) e conferir o diff contra a edição feita à mão.

## 4. Cenários, passos e resultado esperado

### C1. Retro preparada não guarda melhorias e a tela perde a seção

- Fazer: preparar uma retro (o modelo responde com fala, números, funcionou, travou e retrabalho) e abrir a tela da retro.
- Esperar: o arquivo gravado da retro não tem campo de melhorias; a tela não mostra a seção de melhorias propostas; relato, números, funcionou, travou, retrabalho e conversa continuam aparecendo.

### C2. Uma retro antiga, com melhorias gravadas, continua abrindo

- Fazer: gravar um arquivo de retro com um campo antigo de melhorias e abrir a retro no aplicativo.
- Esperar: a retro abre normalmente; o campo antigo é ignorado; nada quebra.

### C3. Cada melhoria vira uma proposta em Ações, com o texto à vista

- Fazer: numa retro com rastreador e projeto de issues configurados, perguntar algo que faça o modelo levantar duas melhorias.
- Esperar: aparecem duas propostas na tela de Ações, na ordem em que vieram, uma por melhoria; o cartão mostra o título da melhoria como cabeçalho e, no corpo, a dimensão, o problema de hoje, o que seria e a retro de origem (data e identificador); nada é escrito no rastreador nesse momento; a conversa diz que cada melhoria está em Ações.

### C4. Aceitar a proposta cria a issue e inicia a execução

- Fazer: aceitar ("sim") a proposta.
- Esperar: a issue passa a existir no projeto de issues, com o título e o corpo montados; a criação fica registrada na trilha de auditoria; uma execução começa na issue sem um segundo "sim", com pasta de ciclo, conversa e documentos próprios, seguindo até a revisão do código.

### C5. Recusar ou pular não cria nada

- Fazer: recusar ou pular a proposta.
- Esperar: nada é criado no rastreador; nenhuma execução começa; a retro gravada continua sem melhorias; a proposta fica registrada como pulada.

### C6. Num espaço de trabalho de teste a confirmação é recusada

- Fazer: num espaço de trabalho marcado como de testes, aceitar a proposta.
- Esperar: a proposta aparece normalmente; ao confirmar, a escrita é recusada antes de qualquer coisa sair da máquina; nada é criado e nenhuma execução começa; a proposta continua esperando.

### C7. Sem rastreador, sem projeto ou sem escrita de issue, a melhoria fica na conversa

- Fazer: repetir a pergunta que levanta melhoria em três configurações — sem integração de rastreador, sem projeto de issues, e num host que recusa o título (acima do limite do rastreador).
- Esperar: em cada caso, nenhuma proposta é criada e a conversa da retro diz o motivo (sem integração, sem projeto de issues ou o motivo devolvido pelo host); nada é escrito.

### C8. O restante da retro continua igual

- Fazer: comparar a tela e o registro da retro com o que existia antes da mudança.
- Esperar: relato do período, números, funcionou, retrabalho, travado e conversa inalterados.

### C9. Textos de ouro dos prompts e lint de traduções passam

- Fazer: rodar `npx vitest run` (que inclui o teste de paridade dos textos de ouro) e `npm run i18n:lint`.
- Esperar: o prompt da retro não menciona melhorias nem carrega o parâmetro que as pedia; os prompts de retro das famílias Scrum e Kanban perdem a frase de melhorias; o texto de ouro do prompt de pergunta da retro muda só nas chaves de resposta, com o texto igual; o lint de traduções passa com as chaves novas nos dois idiomas.

### C10. Duas melhorias com títulos que colidem

- Fazer: levantar duas melhorias cujos títulos, depois de normalizados e cortados nos primeiros 40 caracteres, dão o mesmo valor.
- Esperar (pela especificação): uma proposta por melhoria. Comportamento lido no código: a segunda melhoria não gera proposta nem nota na conversa — a chave de deduplicação coincide. É um caso de borda que a especificação não cobre; ver a seção 6.

## 5. O que só uma pessoa consegue verificar

- Se o modelo preenche o campo de melhorias sem que o prompt da retro peça melhorias. Depende de execução real com um modelo e não foi observado.
- Se a proposta da retro renderiza como descrito no cartão de Ações. Não há teste de tela renderizada para a retro; a prova por leitura é um substituto, não a tela rodando.
- Se a execução começa de fato logo depois de a issue existir num host real (o teste com host falso prova a fiação, não o host).
- Se o diff dos textos de ouro editados à mão corresponde ao que a regeneração produziria, e se o teste de paridade passa com eles.

## 6. Lacunas conhecidas

- A chave de deduplicação da proposta usa um resumo do título da melhoria cortado em 40 caracteres. Dois títulos que só divirjam depois disso geram a mesma chave: a segunda melhoria não vira proposta e não ganha nota na conversa. É um caso que a especificação não cobre; não bloqueia, mas deve ser decidido.
- O caminho "a integração existe, mas não escreve issue" não tem caso de teste próprio: o teste da Regra 7 cobre "sem integração", "sem projeto" e "título recusado".
- O perfil de exemplo em `docs/examples/legacy-profile.example.json` ainda guarda um override de prompt que deixou de casar com chave alguma; é inerte e nenhum teste lido depende dele, mas o exemplo passa a documentar um prompt que não existe.
