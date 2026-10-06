# Revisão: arquivos na conversa e os agentes abrindo o que foi enviado

## Veredito

**Mudanças pedidas.** O essencial está construído e verde nos portões do projeto (typecheck, i18n:lint, theme-audit, public-audit) e nos testes novos e tocados. Decidido que a entrega deve trazer a funcionalidade, ela volta ao desenvolvimento com um ponto bloqueante e dois pontos menores:

1. **Excluir uma mensagem não apaga os arquivos dela** (bloqueante). O critério de aceite "Deleting the message deletes its files from disk" e as regras 9 e 20 da spec não se cumprem. Nenhuma mensagem do fórum pode ser excluída hoje: não há canal de exclusão no armazenamento nem na tela, e o armazenamento dos anexos não tem nenhuma função que apague a pasta de uma mensagem. Os arquivos de uma mensagem apagada só sairiam do disco pela varredura de retenção, por idade, o que não é o mesmo comportamento. O `removeMessage(thread, seq)` do plano não foi implementado em lugar nenhum.
2. **A mensagem que responde à execução perde os anexos** (sugestão, mas fecha duas linhas do aceite). Quando a mensagem com arquivos é a resposta que a execução espera, o texto vai pela mensagem `answer` que o runner grava, e essa mensagem não carrega os refs dos anexos; os arquivos ficam só na pasta da conversa. Consequências: a miniatura e o cartão não aparecem nessa mensagem (parte do critério 1, para esse caminho), a varredura de retenção não vê uma mensagem viva a referenciá-los e o agente da etapa só os alcança quando a execução volta a rodar, pela seção do pedido. A correção é pequena e localizada: levar os refs até o `answer` do runner (o `answerPost`/`answer()` hoje recebem só o texto) e gravá-los na mensagem de resposta.
3. **No motor aberto, o anexo entregue numa rodada de ferramentas vira duas mensagens por arquivo** (sugestão). Cada imagem confirmada como descoberta num turno de ferramentas vira uma mensagem de usuário própria, numa ordem que não depende do chamador. Numa mensagem com vários arquivos, o provedor recebe uma sequência fixa de mensagens de usuário, e o modelo pode perder a noção de qual texto de resultado pertence a qual imagem. Uma mensagem de usuário por rodada, com todos os pedaços de imagem juntos, é mais fiel ao pedido e mais barata.

## O que foi verificado nesta revisão

- **Typecheck** (`npx tsc --noEmit`): limpo.
- **i18n:lint** (`npm run i18n:lint`): limpo, 4118 chaves nos dois idiomas.
- **theme-audit** (`node scripts/theme-audit.mjs`): limpo, 55 pares de contraste acima de 4.5:1, sem cor literal nova além das 8 já existentes em `api.ts`.
- **public-audit** (`node scripts/public-audit.mjs`): limpo, 923 arquivos.
- **Testes novos**: `attachments-kind` (13), `attachments-store` (13), `forum-attachments` (7), `attachments-view` (9), `attachments-tool` (7), `engine-open-attachments` (4), `mentions-attachments` (4), `attachments-retention` (5) — 62 testes, todos verdes.
- **Testes tocados no caminho**: `forum-policy`, `forum-store`, `forum-view`, `web-outbox`, `web-server`, `config-schema`, `config-validate`, `cycle-prompts`, `main-catalogs`, `ui-i18n` — 142 testes, todos verdes.

Não foi verificado nesta revisão, e não pode ser dado como feito: a tela rodando (miniatura, cartão, arrastar-e-soltar, colar, seletor do telefone); o envio de um arquivo perto do limite pelo corpo de 15 MB do RPC, com um aparelho pareado real; um provedor compatível real aceitando o pedaço de imagem no histórico do motor aberto; a leitura da imagem pelos dois motores produzindo a resposta que o aceite descreve (o motor fechado tem só o teste de política do que a ferramenta devolve).

## Leitura estrita, tipo por conteúdo, caminho nunca ao modelo

O tipo pelo conteúdo está bem coberto: um PNG chamado `.txt` é imagem, um texto chamado `.png` é texto, um ZIP é recusado, JSON e CSV são decididos pela forma do texto. A leitura estrita foi respeitada de ponta a ponta: um PDF, um JSON ou um CSV não vão ao modelo e a ferramenta responde com o motivo, em palavras. Nenhum caminho no computador chega ao modelo — a ferramenta resolve o `ref` no registro da conversa, o nome que a pessoa deu é dado e nunca vira caminho (um nome com `../` é limpo de caracteres de controle e cortado em 200, e um `ref` que pareça caminho não resolve). Um `id` de outra conversa não resolve, e o `forum:attachment-get` só responde quando a mensagem existe e a sua âncora é a da conversa pedida — é isso que faz "um agente chamado noutra conversa não abre esses arquivos" ser verdadeiro sem tela, e a âncora é interna.

Um ponto de comportamento que convém registrar, porque é o lado mais frágil do desenho: o registro de anexos não guarda a que mensagem um arquivo pertence, só a conversa. O alcance do agente é, portanto, a conversa inteira, e não a mensagem que o chamou — um agente chamado numa mensagem consegue abrir, pelo `id`, o arquivo de outra mensagem da mesma conversa. Isso é mais largo do que a regra 14 pede ao pé da letra, mas é a leitura que a spec faz (o assunto é a conversa) e o critério 9 fala de outra conversa. Fica como está, com a nota aqui para não se perder.

## O que ficou fora desta revisão

- A árvore completa do diff não foi lida linha a linha fora dos arquivos que o recurso toca; as telas foram conferidas por leitura e pelas asserções sobre o texto-fonte, não em execução.
- A configuração de `attachments` no navegador pareado (`config:cycle-save` e o `WEB_EDITABLE`) foi conferida pelo tipo, pelo esquema e pela validação; a gravação pelo navegador não foi exercitada.
- O `attachmentDrop` chamado pela tela: removido o arquivo antes do envio, o upload ainda não aconteceu, então o canal não tem um caminho exercitado de ponta a ponta (o teste que existe ataca o armazenamento, não a tela).
