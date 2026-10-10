# Revisão: segredos e pastas por portas, sem o runtime do desktop

## O que foi conferido

Leitura do diff inteiro da branch contra a spec e o plano, arquivo por arquivo, e execução dos portões desta máquina: tipos, auditoria de tema, catálogos de idioma e auditoria de conteúdo público. Também rodados os oito arquivos de teste novos ou ajustados, a suíte inteira, e — para separar o que a mudança quebra do que a máquina não tem — os mesmos arquivos de teste num ponto de partida da branch, em cópia descartável.

O que a mudança entrega está correto pelo que foi lido e executado:

- Os dois módulos e tudo o que eles importam não alcançam o runtime do desktop. Conferido por leitura e pelo teste que percorre os imports (verde), e o tipo de criptografia da loja passou a aceitar um motivo próprio de recusa, que o host sem interface usa para falar do seu arquivo de chave.
- O arquivo de segredos de uma instalação que já existe abre sem migração, com o formato e a permissão de hoje; as leituras não o reescrevem (teste verde).
- A chave-mestre: ida e volta com a mesma chave, recusa com chave diferente, e recusa fechada quando o arquivo falta, está legível por outros, é um link, não é a chave, ou está dentro da pasta de dados. Validado a cada operação, sem guardar a chave entre elas, com o modo GCM autenticando; nenhuma mensagem carrega a chave nem o conteúdo do arquivo (teste verde).
- O que o desktop preenche continua sendo o que era: o cofre do sistema com as mesmas recusas de sempre, inclusive a queda do sistema para o modo inseguro contando como sem cofre, e as pastas do runtime lidas na hora do uso.
- Nada visível muda na janela do desktop, então nenhum registro de versões era esperado, como o plano decidia.

## O que bloqueia

Duas coisas fora do assunto da issue, que a branch trouxe consigo. Nenhuma das duas tem a ver com as portas de segredos e caminhos; as duas fazem testes que passam no ponto de partida da branch falharem nesta árvore.

1. **O filtro de segredos passa a segurar um arquivo de código cujo nome começa com "a".** O teste que garante isso falha: espera a linha do arquivo `a-1-b.php` e recebe vazio. O filtro tenta os pedaços do nome que os dois-pontos delimitam e, para o pedaço curto, a regra de nome da branch considera segredo uma pasta de dados do próprio app — a mesma regra que, em versões anteriores, considerava código. O efeito é guardar do modelo arquivos que não escondem segredo nenhum.
2. **Três testes do fluxo de propostas de conflito falham** — um hunk por arquivo deixa de ser enviado ao modelo, e o teste do arquivo removido aparece com um hunk só. Este código não foi tocado pela branch e a regra que decide se um arquivo do conflito é delicado vem do mesmo filtro de segredos. A causa exata não foi isolada; o que foi verificado é que o mesmo arquivo de teste passa inteiro no ponto de partida da branch e que o código do fluxo é idêntico entre os dois pontos.

Enquanto os dois arquivos de teste não passarem, as mudanças não estão prontas.

## O que não foi verificado

- **O passo manual do plano** (abrir o app sobre uma instalação que já tem segredos gravados, numa máquina com cofre do sistema disponível): não foi executado. O que passa pelo cofre de verdade segue sem verificação.
- **A contagem de 131 para 16 arquivos que alcançam o runtime do desktop**: não foi recalculada, como a spec já dizia; nada aqui a confirma.
- **Quatro falhas da suíte que esta máquina explica**: os arquivos de teste do navegador e das pastas de navegador dependem do pacote do servidor de navegador embutido e de uma área de sandbox que não estão ligados nesta árvore; eles falham igual no ponto de partida da branch, então não entram no veredito.
- **A origem das três falhas do fluxo de conflito**: verificada só até onde o teste mostra (os testes passam fora da branch, o código do fluxo é o mesmo); a causa dentro do filtro não foi isolada por experimento.
