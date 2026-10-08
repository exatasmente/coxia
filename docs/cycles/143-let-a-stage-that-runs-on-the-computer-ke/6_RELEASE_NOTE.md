# A etapa que roda no computador agora guarda o que produziu

Antes, uma etapa cujo agente roda comandos no computador terminava sem nenhuma
comprovação: o que o agente produziu para testar uma interface (capturas de tela,
trços de execução, relatórios) ficava numa pasta temporária que o app apagava ao
encerrar a etapa, e as ferramentas para guardar esses arquivos nem eram oferecidas
a ele. A execução ficava com "No evidence in this stage", os cenários de QA que
dependiam da comprovação voltavam como só leitura, e nada chegava ao host de código.

Agora, quando essa etapa testa uma interface:

- o agente recebe as mesmas duas ferramentas de comprovação que uma etapa com sandbox:
  guardar um arquivo e marcar uma imagem;
- o que ele guardar aparece na execução, numerado, e um cenário de QA pode citar esse
  número;
- o que ele abriu e não guardou é guardado como comprovação da etapa antes de a pasta
  temporária desaparecer;
- um caminho fora da pasta de saída da etapa é recusado, com o mesmo motivo que uma
  etapa com sandbox usa.

Como usar: nada muda na configuração. Para que uma etapa que roda no computador tenha
comprovação, ligue uma das duas chaves que já ligam o teste de interface hoje — a pasta
de navegadores disponível para a etapa, ou a tela virtual pedida para a etapa de QA.
Isso é o que faz a pasta de saída existir; sem nenhuma das duas, a etapa continua
exatamente como era: sem pasta, sem ferramentas de comprovação, sem texto novo.

O que vale saber: o que o agente quiser guardar precisa estar dentro da pasta de saída
que a etapa recebe; um arquivo produzido fora dela segue sem poder ser guardado pela
ferramenta — a própria etapa pode movê-lo para lá antes. A etapa com sandbox não
muda de comportamento. Não verificado nesta entrega: o modo host numa execução real
com tela (tudo o que foi conferido veio de testes automatizados com sessão falsa e de
leitura dos arquivos); uma etapa de host que roda de novo sobre uma comprovação já
guardada; e os argumentos da ferramenta de guardar na forma do motor aberto.
