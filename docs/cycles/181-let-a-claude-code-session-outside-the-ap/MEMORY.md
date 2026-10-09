# Memória do ciclo

## Decisões

- Classificada como pedido de funcionalidade (enhancement), não bug nem duplicada; entendível como escrita, nada só o autor pode dizer.
- Sugestões (não decidem): priority:medium; squad Plataforma (o trabalho é do lado do runtime, com só um toggle de opt-in na Settings).

## Restrições

- Somente leitura nesta fase inicial; escritas ficam para issue separada, cada uma atrás da aprovação que o app já usa.
- Respostas do novo servidor devem passar pelo mesmo caminho do app (redação de segredos via redact), nunca arquivos crus.
- Execução local apenas, sem listener de rede, opt-in explícito na Settings.

## Tentado e descartado

- Ler a pasta de dados diretamente: é o que existe hoje; IsBrittle, sem redação e acoplado ao formato de arquivo — a issue já descarta.
- API de web access (browser pareado): feita para pessoa no telefone, não para agente.

## Perguntas abertas

- Servidor dentro do app (precisa aberto) ou processo separado lendo pelo código do store (funciona fechado): para o refinement.
- Qual workspace o servidor atende quando há vários, e como a sessão de terminal escolhe: refinement decide.
- #179 segue em andamento; o store do procedure memory ficar acessível e moldado para leituras externas é pré-requisito.

## Onde o trabalho está

- Triagem completa (0_TRIAGE.md); conferido por leitura do código (servidores MCP in-process em src/main, atravessamento de respostas com redact; testes como test/browser-agent-screen.test.ts), nada executado nesta rodada. Próxima etapa: refinement do produto.
