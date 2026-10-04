# As decisões de uma execução longa deixam de se perder entre as etapas

## O problema

Cada etapa de uma execução começa uma sessão nova: o texto que o agente recebe é montado do zero. De uma etapa para a outra só passam o conteúdo da pasta do ciclo, as últimas 40 mensagens da conversa e o último recado. Num ciclo longo isso quebra de quatro modos.

O corte da pasta cai sobre os documentos mais novos: os arquivos são lidos em ordem de nome até o orçamento acabar, então os documentos das etapas que estão rodando são os primeiros a serem cortados ou deixados de fora — e um ciclo pequeno já chega perto do limite. O que se decidiu na conversa some quando chegam 40 mensagens novas: uma decisão, uma restrição dada pela pessoa ou uma resposta de quem abriu a issue que só viveram ali deixam de existir para o próximo agente. Um documento reescrito perde a história: quando a revisão ou a QA devolvem o trabalho, a etapa escreve o documento de novo, e o porquê da primeira tentativa fica só no histórico do git, que nenhum agente recebe. E nada costura as decisões: cada agente reconstrói o estado do ciclo a partir dos documentos longos e pode contradizer uma decisão que nunca viu.

## O que esta mudança entrega

- Um registro do ciclo — a memória —, um arquivo por execução, com nome fixo na pasta do ciclo, versionado com a ramificação como os outros documentos.
- Curto e estruturado, sempre com as mesmas seções: decisões (o quê, quem, por quê), restrições, o que foi tentado e descartado, perguntas abertas e onde o trabalho está.
- Lido inteiro em toda etapa, antes de todos os outros documentos, e nunca cortado pelo orçamento da pasta; o registro tem teto próprio e a etapa é avisada quando o passa.
- Atualizado por cada etapa e por quem decide na conversa, e visível e corrigível pela pessoa.

## Regras

1. **Um arquivo, um nome.** Cada execução tem um registro do ciclo em `MEMORY.md`, na pasta do ciclo, versionado no ramo como os documentos das etapas. Não há mais de um, e ele não vive fora do repositório.
2. **Formato fixo e curto.** O registro abre com um título próprio e traz, sempre com as mesmas seções: decisões (o quê, quem, por quê), restrições, o que foi tentado e descartado, perguntas abertas e onde o trabalho está. O teto do registro é de 10.000 caracteres.
3. **Primeiro e inteiro.** Em toda etapa, o texto que o agente recebe traz o registro antes do registro da issue e dos demais documentos, completo. O orçamento da pasta do ciclo (30.000 caracteres por arquivo e 120.000 no total) nunca corta o registro.
4. **Acima do teto, a etapa sabe.** Um registro acima de 10.000 caracteres continua sendo lido inteiro, e a etapa é avisada de que passou do teto; a atualização que a etapa devolve é o que traz o registro de volta ao tamanho.
5. **Quem cria.** O registro nasce com a execução, com as seções na ordem, e uma execução já em andamento quando a mudança chega o ganha na próxima etapa que roda.
6. **Cada etapa atualiza.** Uma etapa que termina devolve a mudança do registro junto do resumo; o aplicativo é quem escreve o arquivo e o commita com os documentos da etapa. Um agente nunca edita o arquivo por conta própria. Uma devolução da revisão ou da QA registra o que foi rejeitado e por quê.
7. **A conversa alimenta o registro.** A resposta da pessoa (ou de quem abriu a issue) a uma pergunta e a passagem deixada para a próxima etapa entram no registro, e sobrevivem à janela das últimas 40 mensagens.
8. **A pessoa vê e corrige.** O registro aparece na tela da execução, ao lado dos outros documentos, e a pessoa pode editá-lo. A versão editada pela pessoa é a que a próxima etapa lê, e a edição fica registrada como da pessoa.
9. **O orçamento da pasta favorece a etapa.** O registro nunca é cortado. Quando os documentos não couberem, os que a etapa declara que lê são mantidos inteiros, e os mais antigos são cortados primeiro, cada um com a marca de que foi cortado.
10. **As mesmas regras dos outros documentos.** O que entra no registro vem de fora e vai entre marcas `<data>`; o que parece credencial é mascarado; o arquivo passa a auditoria pública.
11. **Os dois motores e o reinício.** Funciona no motor aberto e no Claude Agent SDK, e uma execução retomada depois de reiniciar o aplicativo lê o registro da mesma forma.

## Fora do escopo

- Aumentar os limites da pasta do ciclo.
- Resumir a pasta inteira com o modelo a cada etapa.
- Guardar o registro fora do repositório, ou publicá-lo no rastreador: ele viaja na ramificação e aparece no pull request, e não é um comentário.
- Um registro por time ou entre execuções; é um por execução.
- Mudar a janela das últimas 40 mensagens da conversa ou o corte de cada mensagem.
- Reescrever os documentos das etapas a partir do registro.

## Aceitação

- Toda etapa recebe o registro antes dos outros documentos e por inteiro.
- Um registro acima do teto é lido inteiro e a etapa é avisada de que o passou.
- Terminar uma etapa atualiza o registro, e o commit da etapa leva o registro junto dos documentos.
- Uma devolução da revisão ou da QA registra no registro o que foi rejeitado e por quê.
- A resposta da pessoa e a passagem para a próxima etapa aparecem no registro e continuam nele depois de chegarem 40 mensagens novas.
- O registro aparece na tela da execução; uma edição da pessoa é a versão que a etapa seguinte lê, registrada como da pessoa.
- Com os documentos acima do orçamento da pasta, as entradas declaradas da etapa ficam inteiras, os documentos mais antigos são cortados primeiro, cada corte é marcado, e o registro não é cortado.
- O comportamento é o mesmo nos dois motores e numa execução retomada depois de reiniciar o aplicativo.
- O arquivo passa a auditoria pública e não traz credencial.
