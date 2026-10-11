# O primeiro espaço de trabalho

Um espaço de trabalho é a configuração de um projeto: em qual repositório ele trabalha, com qual
modelo os agentes falam e de onde vêm as issues. O assistente de configuração conduz você por isso
na primeira abertura.

1. **Escolha o idioma.** Português (Brasil) ou inglês; o aplicativo é escrito nos dois.
2. **Aponte para um repositório.** O assistente acha os checkouts que você já tem e lê a origem
   deles. Nada do repositório é escrito neste passo.
3. **Escolha um modelo.** Ou um modelo Claude, ou um servidor compatível com OpenAI, inclusive um
   local. O teste de conexão diz se o modelo aceita chamadas de ferramenta e respostas estruturadas.
4. **Nomeie o host de código.** Um token com os escopos que o aplicativo pede; o assistente mostra
   quais são e oferece testar o token. Ler é tudo de que o aplicativo precisa até você aprovar uma
   escrita.

Tudo isso está escrito em [Configuração](/reference/configuration.pt-br), inclusive o que mora
onde no disco e como exportar um espaço de trabalho como arquivo.

**O que você deve ver:** a tela Hoje com as atividades abertas do repositório como cartões, cada um
com a etapa em que está.

<!-- site:image-placeholder -->
> **Captura (pendente).** O passo Modelos do assistente, com o teste de conexão. Sai do aplicativo,
> de um espaço de trabalho semeado com dados fictícios, refeita a cada versão.
