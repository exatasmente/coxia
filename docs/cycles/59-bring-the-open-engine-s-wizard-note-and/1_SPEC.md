# O que a tela e a documentação dizem sobre o motor aberto volta a ser verdade

## Em uma frase

Três textos que descrevem o motor aberto ficaram para trás do que o app faz: a nota que o assistente mostra ao cadastrar um provedor, a parte que explica como o motor é escolhido e a tabela que conta o que já rodou de verdade. O trabalho os alinha ao comportamento atual, sem mudar comportamento nenhum.

## O que muda para quem usa

**A nota do assistente.** Hoje, quem escolhe um provedor que não é Claude — um servidor local (Ollama, LM Studio, llama.cpp, vLLM) ou um serviço compatível com OpenAI — lê, ao lado do formulário, que esse provedor roda no motor aberto com "ferramentas só de leitura". Isso dá a entender que um agente que trabalha no runner e tem permissão de escrita não pode usar esse provedor para escrever. Não é o que acontece. Depois da mudança, a nota diz o que o motor aberto é e o que ele faz: é o loop de agente do próprio app, que lê, escreve dentro do worktree do run e executa comandos sob a mesma política de segurança do caminho Claude, e que a qualidade do resultado depende do modelo escolhido. A nota continua aparecendo no mesmo lugar, para os mesmos provedores, e continua curta.

**A escolha do motor na página de provedores.** Hoje a página diz que a escolha do motor é, "por enquanto", um conjunto de variáveis de ambiente e que "a camada de configuração vai trocar" esse gancho. Quem lê conclui que configurar um provedor e apontar um papel para ele ainda não decide o motor. Já decide. Depois da mudança, a página descreve a escolha como ela é: cada provedor cadastrado carrega o motor com que roda e cada papel do time aponta o provedor e o modelo que usa; as variáveis de ambiente ficam apresentadas apenas como um recurso de teste, sem valor para quem usa o app.

**A tabela de cobertura.** Hoje ela diz que só um servidor falso foi testado, o que contradiz o que o próprio repositório registra. Depois da mudança, a tabela e o texto ao redor dela contam o que de fato rodou: um modelo real, pelo OpenRouter, no motor aberto, no runner, em quatro execuções (duas grandes e duas menores), contra um host de código falso; e continuam dizendo, com clareza, o que **não** rodou — nenhum outro modelo, nenhum provedor local, nenhuma cerimônia. Nada de novo será apresentado como testado sem ter sido.

**As notas honestas do README.** As duas línguas do README repetem a mesma frase velha de que o motor aberto "só foi testado contra um servidor falso roteirizado", contrariando o mesmo registro. Elas acompanham a tabela e passam a dizer o mesmo que ela.

O que **não** muda para quem usa: nenhuma tela nova, nenhum botão novo, nenhum comportamento novo; as mesmas configurações, os mesmos comandos e o mesmo resultado dos testes.

## As regras

1. A nota do assistente aparece para os mesmos provedores de hoje e no mesmo lugar, e continua cabendo em uma linha ou duas.
2. A nota afirma três coisas, e só elas: o motor aberto é o loop de agente do próprio app; ele lê, escreve dentro do worktree do run e executa comandos sob a mesma política de segurança do Claude Agent SDK; a qualidade depende do modelo.
3. A nota existe nas duas línguas, com o mesmo sentido, e não cita nome de ferramenta, de arquivo nem de função. A segunda frase da nota de hoje — a que fala da qualidade depender do modelo — continua verdadeira e permanece.
4. A página de provedores, nas duas línguas, apresenta a escolha do motor como resultado da configuração: o provedor cadastrado tem um motor, e o papel aponta provedor e modelo. Nenhuma frase apresenta isso como algo que ainda vai existir.
5. O gancho de variáveis de ambiente só aparece como recurso de teste, se continuar existindo; nenhum texto sugere que ele seja a forma de escolher o motor.
6. A tabela de cobertura e o texto ao redor dela contam apenas execuções registradas: um modelo real, OpenRouter, no motor aberto, apenas no runner, contra um host falso — quatro execuções, duas grandes e duas menores. A linha do provedor diz isso; a linha do servidor falso diz que ele é o dos testes.
7. O que não rodou continua dito como não rodado, com o mesmo cuidado de hoje: nenhum outro modelo ou provedor, nenhum modelo local, nenhuma cerimônia, nenhum host de código real, nenhum repositório grande.
8. A explicação de escolha que hoje deriva do gancho (o que o motor aberto precisa receber para alcançar o provedor, o que acontece quando um servidor recusa um parâmetro, o padrão das fontes de documentação em teste) passa a ser atribuída ao app que roda de verdade, e não a uma camada futura.
9. Nenhum texto deste trabalho cita número de issue, nome de pessoa, host ou segredo; as notas de lançamento dizem o que mudou sem referência interna.
10. Nada de comportamento muda: nenhuma chave de configuração, nenhum padrão, nenhuma ferramenta oferecida ao modelo, nenhum texto enviado a um modelo.

## Fora do escopo

- **Não há garantia de execução nova com modelo real.** Se nenhuma execução real tiver acontecido desde as quatro registradas, a tabela e as notas não recebem cobertura nova: elas passam a contar certo o que já rodou, e o documento de implementação diz que nada novo rodou. Inventar cobertura é pior do que dizer que não há.
- A mesma frase velha que ainda aparece na página de configuração nas duas línguas e num comentário do código principal. São a mesma afirmação desatualizada, mas estão fora dos três textos que a issue nomeia; corrigi-las é uma linha de trabalho própria, a decidir por quem aceitar esta especificação.
- A promessa de **testar o motor aberto contra modelos locais de verdade** e publicar quais funcionam, que o README lista como próximo passo: continua sendo trabalho futuro.
- A seção de limitações conhecidas da página de provedores, que fala de um modelo pequeno errar argumentos: não foi conferida nesta etapa e não é tocada por este trabalho.
- Nenhuma mudança de tela além do texto da nota; nenhuma mudança de código de comportamento.

## Critérios de aceite

1. Ao escolher um provedor de motor aberto no assistente, em português e em inglês, a nota não usa mais a expressão "ferramentas só de leitura" / "read-only tools" e diz que o motor lê, escreve dentro do worktree do run e executa comandos sob a mesma política de segurança do Claude, e que a qualidade depende do modelo.
2. A nota continua aparecendo exatamente para os provedores que não são Claude e no mesmo ponto do formulário; nenhuma outra parte da tela mudou.
3. A página de provedores, nas duas línguas, não contém mais a frase de que "a camada de configuração vai trocar" a seleção nem apresenta o gancho de ambiente como o modo de escolher o motor.
4. A mesma página explica, em uma passagem, que o provedor cadastrado define o motor e que o papel do time aponta provedor e modelo.
5. A página de provedores não afirma mais que só o servidor falso foi testado; a tabela registra o modelo real pelo OpenRouter, no motor aberto, apenas no runner, contra um host falso, em quatro execuções.
6. O que não foi exercitado continua marcado como não exercitado, sem afirmar que algum outro modelo, provedor ou cerimônia rodou.
7. As mesmas correções de texto valem nas duas línguas, com o mesmo sentido em cada uma.
8. As notas de quem lê o projeto — as do README, nas duas línguas — deixam de dizer que o motor aberto só foi testado contra um servidor falso e contam o que a tabela conta.
9. Nenhuma chave de texto ficou sem par na outra língua e nenhum texto novo citou número de issue, nome de pessoa, host ou segredo.
10. Nada de comportamento mudou: a suíte de testes passa como passava, e nenhum teste ficou vermelho por causa deste trabalho. *(O trabalho de implementação confirma; nesta etapa nada foi rodado.)*
11. Quem lê os textos encontra cada afirmação sobre o motor aberto igual ao que o app faz, sem promessa de algo que ainda vai existir.

## Perguntas em aberto

- A pergunta que ficou para a pessoa: o alcance da tabela de cobertura. A issue pede "atualizar a tabela para o que rodou desde então"; quem escreveu sabe se houve, depois das quatro execuções registradas, alguma execução com modelo real (OpenRouter ou DeepSeek) que a página ainda não conte. Se houve, ela entra na tabela; se não, a tabela passa a contar certo as quatro e nada mais é acrescentado. Nenhum registro disso foi encontrado no changelog nem na página do runner.
- Se a frase velha sobre a camada de configuração que ainda existe na página de configuração e num comentário do código entra no mesmo trabalho.
