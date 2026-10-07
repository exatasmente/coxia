# Enviar arquivos na conversa e os agentes abrirem

## Que tipo de issue é

Pedido de funcionalidade (a issue traz o rótulo `enhancement`). Não relata defeito, não é pergunta e não repete outra issue: pede comportamento novo — a pessoa anexar arquivos a uma mensagem, em qualquer conversa do fórum, e os agentes chamados naquela conversa conseguirem abrir os arquivos.

## Dá para entender como está escrita

Dá. É um pedido de comportamento novo, não há defeito a reproduzir. O que a issue diz do estado atual confere com o código, conferido apenas por leitura (nada foi executado no aplicativo):

- Hoje só existe o `ArtifactRef`, um caminho relativo dentro da pasta do ciclo, e ele é montado pelo aplicativo ao publicar um comentário de etapa, nunca pela pessoa (`src/shared/forum.ts:16-20`; `src/main/runner/service.ts:464`, `post`).
- A mensagem de uma pessoa aceita só texto: `forum:post` recebe a conversa e o texto e valida o tamanho, sem campo de arquivo (`src/main/forum.ts:33-41`, `:64-67`), e o compositor é uma caixa de texto sem botão de anexo, arrastar-e-soltar ou colar de imagem (`src/renderer/src/screens/cycle/Thread.tsx:150-269`).
- Um anexo mostrado na mensagem não tem onde aparecer: o bloco de arquivos só é desenhado quando a mensagem pertence à conversa de uma execução (`m.refs.length > 0 && ctx.runId`, `Thread.tsx:103-111`).
- Os canais do fórum já são abertos à janela e ao navegador pareado, e nenhum deles é `desktop-only` nem efeito externo (`src/main/webPolicy.ts:22-26`; `test/forum-policy.test.ts:9-21`), mas a política pina apenas os quatro canais de hoje: `forum:list`, `forum:read`, `forum:post`, `forum:create` (`test/forum-policy.test.ts:6,23-27`). Um canal novo de arquivo não é coberto por esse teste e a web precisa continuar aberta e com limites.
- Nenhum canal da ponte hoje carrega bytes grandes do navegador para o aplicativo: o corpo de uma chamada RPC é JSON e o limite é de 15 MB (`src/main/web.ts:15`, `:271-299`), enquanto o limite do áudio enviado do telefone é de 16 MB (`test/web-server.test.ts:255`). Se o anexo do telefone viajar por esse mesmo caminho, um anexo perto do limite mais o JSON pode ser recusado.
- No motor aberto, `Read` recusa arquivo binário (`isBinary`, `src/main/engine/open/tools/read.ts:39-48,82`) e o resultado de ferramenta é texto (`content: string`, `src/main/engine/open/types.ts:12-19`; `render` em `tools/types.ts:25-28`).
- Mesmo quando a ferramenta aceita imagem, o resultado de ferramenta de um modelo só carrega texto. O fio do motor aberto tem o tipo de imagem (`ContentPart`, `engine/open/types.ts:4`), mas ele não é usado hoje: a mensagem de resultado é sempre `{ role: 'tool', content }` (`engine/open/loop.ts:391`, `:429-431`) e só o conteúdo do turno de usuário é escrito como texto simples (`loop.ts:327`). O próprio documento do projeto registra que entrada de imagem não é usada pelo motor aberto (`docs/llm-providers.md:103`, `:207`).
- O agente chamado por menção nunca recebe caminho no computador: ele recebe a conversa, os documentos da pasta do ciclo e, quando executa comandos, uma cópia descartável do código (`src/main/mentions/call.ts:74-101`; `src/main/mentions/answer.ts:124-146`).
- Não há onde guardar um arquivo da pessoa: hoje só há a pasta da execução e a cópia descartável; um arquivo novo da pessoa precisa de lugar e disso a issue fala em termos de comportamento (`workspaces/<id>/…`).
- Verificação: leitura da issue, do código citado e dos documentos do projeto. Nada foi executado e o comportamento pedido não foi visto funcionando; o estado atual foi conferido **apenas por leitura**.

## O que falta

Nada que a triagem precise ouvir de quem abriu para seguir. A issue já traz o comportamento esperado nas três partes (anexar, mostrar, os agentes lerem), os limites que são configuráveis com padrões, onde o arquivo é guardado e o que é aceito, o que sai do computador e o aceite em cinco itens.

O que sobra são decisões do refino e do plano, não da triagem: os padrões numéricos de tamanho por arquivo e por mensagem; como um anexo toca a cota de leitura da pasta do ciclo; como um anexo de imagem entra no modelo de cada motor; e se um anexo de mensagem que espera uma resposta é entregue no prompt da etapa.

## O que parece duplicada ou relacionada

Nenhuma issue parece duplicar esta. As relacionadas:

- **Chamar um agente com `@` onde a pessoa escreve (#53).** Esta issue se apoia nela: um agente chamado na conversa responde somente leitura, e é essa a regra que a issue dos anexos pressupõe. Não é duplicata.
- **Mostrar que um agente chamado está trabalhando (#29).** Fala do aviso enquanto o agente chamado trabalha; sem relação com anexos. Não é duplicata.
- **Memória do ciclo (#52).** Trata do registro que atravessa as etapas de uma execução; sem relação com anexos. Não é duplicata.
- **Recusa por orçamento da chave ser reportada como "terminou com sucesso" (#58).** Recém-resolvida por este mesmo ciclo; toca no que acontece quando a chamada de um agente falha, mas não no que a pessoa anexa. Relacionada só por vizinhança de código no caminho da menção. Não é duplicata.

## Squad proposto

`experiencia`.

Motivo: o comportamento pedido começa e termina naquilo que a pessoa vê e toca — o compositor da conversa (botão, arrastar-e-soltar, colar, o celular), a miniatura, o chip e o download — e as telas e os textos vivem nas pastas `src/renderer` e `src/shared/i18n`. A leitura dos arquivos pelos agentes é a continuação desse mesmo comportamento, com o mesmo limite que já vale para uma menção (nunca um caminho no computador), e não um trabalho do runtime ou do sandbox.

## Prioridade sugerida

`priority:high`.

Motivo: resolver agora a descrição em palavras de um defeito, um registro ou uma referência de desenho é o que dá base para a evidência de QA e para o trabalho que a issue diz ser a continuação dela. Fica abaixo de uma perda de dado ou de um risco de segurança, e não é um ajuste pequeno ou isolado.

## Custo e alcance, por leitura

Nenhuma decisão de solução; só o que a triagem viu para quem for refinar:

- **Assinatura da mensagem.** Um anexo precisa de campo próprio no `ArtifactRef` ou de lista nova na mensagem, com o esquema do arquivo do fórum acompanhando; a linha do fórum não é reescrita, então remover um anexo antes de enviar não deixa rastro.
- **Limites por conteúdo.** Reconhecer o tipo pelo conteúdo (e não pelo nome) exige um passo próprio do aplicativo antes de aceitar o arquivo; hoje não há esse passo em nenhum lugar do fórum.
- **Canais e política web.** O caminho do anexo precisa entrar na mesma lista aberta ao navegador pareado, com o mesmo cuidado de limite, e o teste de política do fórum precisa cobri-lo.
- **Os dois motores.** No motor aberto o resultado de ferramenta de um modelo é texto hoje, então uma imagem só chega ao modelo se o resultado de uma ferramenta deixar de ser texto (o tipo de imagem existe no fio, mas não é usado) ou se o anexo entrar pelo turno do usuário, que hoje também é texto.
- **Limpeza.** Excluir uma mensagem precisa apagar os arquivos dela; o trabalho de retenção hoje só varre o que ele conhece, então uma pasta nova de anexos fica fora dele até ser incluída.
- **Cota da pasta do ciclo.** Um anexo que entra no texto do prompt da etapa divide o mesmo orçamento da pasta, e nada do que já existe reserva espaço para ele.
