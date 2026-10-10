# Revisão: segredos e pastas por portas, sem o runtime do desktop

## O que foi conferido

Leitura do diff inteiro da branch contra a spec e o plano, e execução nesta rodada dos portões leves (tipos, auditoria de tema, catálogos de idioma, auditoria de conteúdo público), dos cinco arquivos de teste das portas e — para separar o que a mudança quebra do que a pasta onde a suíte roda provoca — dos mesmos arquivos de teste num diretório neutro, com o mesmo código e as mesmas dependências.

O que a mudança entrega está correto pelo que foi lido e executado:

- Os dois módulos e tudo o que eles importam não alcançam o runtime do desktop: nenhum dos dois importa o runtime, e o teste que percorre os imports passa (verde).
- O arquivo de segredos de uma instalação que já existe abre sem migração, mantendo o formato e a permissão (verde): a leitura não o reescreve e uma gravação mantém o formato.
- A chave-mestre: ida e volta com a mesma chave, recusa com chave diferente e falha fechada quando o arquivo falta, está legível por outros, é um link, não é a chave ou está dentro da pasta de dados. Validada em cada operação, sem guardar a chave entre elas, com o modo GCM a fazer uma chave errada falhar na abertura; nenhuma mensagem carrega a chave nem o conteúdo do arquivo (verde).
- O que o desktop preenche continua a ser o que era: o cofre do sistema com as mesmas recusas de sempre, inclusive a queda do sistema para o modo inseguro contando como sem cofre, e as pastas do runtime lidas na hora do uso (verde).
- Nada visível muda na janela do desktop, então nenhum registo de versões era esperado, como o plano decidia.

## O que bloqueava

A rodada anterior reprovou a entrega por dois conjuntos de testes vermelhos, os dois fora do assunto da issue. Esta rodada isolou a causa e conclui que os dois são artefactos da pasta onde a suíte roda, não da mudança:

1. **O filtro de segredos e os três testes do fluxo de conflitos.** A causa é o nome da pasta da worktree: o nome começa com o identificador da issue, esse identificador começa pela palavra `secrets`, e a regra de nome do guarda de segredos casa com qualquer caminho que contenha `secret`/`credential`/`token` e não termine numa extensão de código. O caminho absoluto da pasta inteiro casa, e o filtro de resultados resolve cada caminho de entrada contra o diretório de trabalho antes de o julgar.
   - Os dois ficheiros de teste, sem uma linha alterada, correm verdes a partir de um diretório neutro com o mesmo código e as mesmas dependências: 2 ficheiros, 128 de 128 testes. Do diretório da worktree, os mesmos ficheiros dão 2 ficheiros com falha, 4 testes vermelhos em 128.
   - A regra de nome, copiada sem alteração do commit de partida da branch, devolve verdadeiro para um caminho absoluto sob a raiz de dados quando o diretório de trabalho é a worktree e falso para o mesmo caminho quando é neutra. Isto é: o que mudou entre as duas execuções não é a regra, é a pasta.
   - O ficheiro das regras não é tocado por esta branch: a comparação de commits não tem nenhuma linha para ele. O comportamento vem de um commit anterior da linha de lançamento que é a base desta árvore, e não da entrega.
   - A suíte inteira a partir de um diretório neutro: 420 ficheiros, 413 verdes e 7 com falha; 6934 testes, 6913 verdes. Os ficheiros que falham são os de navegador, sandbox e tela desta máquina; nem o ficheiro do filtro de segredos nem o do fluxo de conflitos está entre eles.

2. **Nada novo bloqueia.** O diff desta rodada são duas limpezas (a constante morta removida num módulo de chave-mestre e uma linha solta de teste removida) mais documentos. Nenhuma das duas introduz defeito: os tipos continuam limpos e os sete testes da chave-mestre passam.

## O que foi sugerido (não bloqueia)

- **Sem par próprio de cifrar/decifrar no porto.** O comprimento mínimo é conferido na abertura, mas o corpo `iv(12) || tag(16) || texto` pressupõe a ordem dos campos; não há teste do par no porto em si (a ida e volta pela loja cobre-o indirectamente). Se o par mudar sem o outro, o erro aparece só no uso real.
- **Recusa por caminho dentro da raiz de dados sem teste do lado positivo.** O teste confirma que um ficheiro dentro da raiz é recusado, mas nenhum verifica que um ficheiro que só partilha o prefixo textual da raiz (por exemplo `<raiz>-outro/chave.hex`) é aceite. A comparação usa a raiz mais o separador, então o caso é aceite por construção.

## O que não foi verificado

- **A abertura manual do plano** (abrir o programa sobre uma instalação que já tem segredos gravados, numa máquina com cofre do sistema disponível): não foi executada. O que passa pelo cofre de verdade segue sem verificação.
- **A contagem de 131 para 16 ficheiros que alcançam o runtime do desktop**: não foi recalculada, como a spec já dizia; nada aqui a confirma.
- **Se todas as falhas que sobram são anteriores à branch**: quatro ficheiros de navegador, sandbox e tela desta máquina falham e não foram todos comparados com o ponto de partida; os dois ficheiros que a rodada anterior apontou foram.

## Veredito

Nada bloqueia. A entrega responde à spec e ao plano, e os testes que a rodada anterior apontou como vermelhos passam quando a suíte corre fora da pasta cujo nome carrega `secret`.
