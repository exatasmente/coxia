# O caminho do conflito saiu da conversa de desbloqueio

## O que foi feito

A coluna direita da conversa de desbloqueio deixou de hospedar o painel de conflito. Saiu o bloco
inteiro — a condição que o abria, o título, a nota e a chamada do botão — e a coluna passou a começar
nas saídas possíveis, como o plano previa.

Com isso, dois imports do arquivo da tela ficaram sem uso e saíram junto: o do botão de conflito e o
da função que lê os conflitos do card. Nenhum outro ponto do arquivo os usava.

A marca de lugar que separa onde o botão aparece perdeu o valor reservado a esta tela. O valor saiu do
tipo; os dois valores restantes (linha do que precisa de atenção e linha de atividade do card)
continuam os mesmos, e os dois pontos da tela de Hoje seguem montando o botão exatamente como antes.

As duas frases que só existiam nesse painel saíram dos dois catálogos de texto e das cópias que os
testes usam, na mesma passada, nas quatro partes.

Todo o resto ficou intocado: a detecção de qual requisição está em conflito, a linha do bloqueio que
aponta para o botão da tela de Hoje, os dois pontos onde o botão já era oferecido, a configuração (sem
migração) e a confirmação antes de qualquer escrita para fora.

## Onde a mudança está

- `src/renderer/src/screens/Deep.tsx`: a seção do painel saiu, e com ela os dois imports que ficaram
  sem uso. A coluna direita começa na seção das saídas.
- `src/renderer/src/screens/ResolveConflict.tsx`: o tipo da marca de lugar passou a aceitar só as duas
  origens que restam. A forma da chave dos jobs não mudou; só o valor retirado deixou de existir.
- `src/shared/i18n/ui-call.en.json` e `src/shared/i18n/ui-call.pt-BR.json`: as duas chaves do painel
  saíram.
- `test/fixtures/catalogs-main/ui-call.en.json` e `.../ui-call.pt-BR.json`: as mesmas duas chaves
  saíram das cópias.

## Como foi conferido

- A verificação de tipos do projeto passou sem erro: o tipo sem o valor retirado não deixou nenhum uso
  antigo para trás.
- O levantamento do que é público passou, e o padrão literal que a memória registrava como risco
  (`deep` no arquivo do botão) não aparece mais como violação; ele ainda existe em lugares legítimos
  (o custo de uma conversa e o papel de modelo nas configurações), que não são o alvo desta retirada.
- O portão de idioma passou: os catálogos seguem com as mesmas chaves nos dois idiomas, sem as duas que
  saíram.
- O portão de tema passou: nenhuma cor literal nova, nenhum contraste abaixo do mínimo.
- A suíte de testes foi rodada. Os testes vizinhos desta mudança passaram: o do botão de resolver
  conflito (as duas origens que ficaram, a linha de Hoje e a requisição que o item nomeia), o do painel
  de Hoje, o das cópias dos catálogos e a busca que reprova cor literal fora dos tokens. Três arquivos
  da suíte falharam por motivo de ambiente — tempo limite de teste e de hook, e uma trava de passo de
  uma execução anterior —, em arquivos que não são tocados por esta retirada (resolução de conflito
  por linha de comando e execução do ciclo); a leitura dos resultados da segunda execução não chegou ao
  fim, então a repetição da suíte não foi confirmada.

## O que não foi verificado

- Nenhuma tela foi aberta. A retirada do painel e a permanência do botão nos dois pontos da tela de
  Hoje valem como leitura do código, não como observação em execução.
- A suíte completa não ficou verde nesta passada: três arquivos falharam por tempo limite e por estado
  deixado por uma execução anterior, em áreas que esta mudança não toca.
- A repetição da suíte, para mostrar que as falhas são do ambiente e não da mudança, ficou sem
  resultado final.
- O roteiro de teste de um ciclo anterior que descrevia a tela de desbloqueio mostrando o painel segue
  desatualizado nesse ponto; não foi ajustado nesta passada.
