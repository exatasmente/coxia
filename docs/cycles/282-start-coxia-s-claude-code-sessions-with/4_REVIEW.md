# Revisão: a entrega ainda é só sondagem e o plano precisa ser refeito

## Veredito

**Mudanças.** Não há código, teste, configuração, migração nem texto de interface para revisar; a branch só tem documentos do ciclo (informação do app, não conferida por comando nesta etapa). Nenhum critério de aceite está atendido. A implementação parou na etapa 0 por decisão consciente e devolveu o plano para revisão, o que está correto pela regra 12 da spec.

## O que foi lido

1_SPEC.md, 2_PLAN.md, 3_IMPLEMENTATION.md, a memória do ciclo e o resumo do que a branch alterou. Não foram rodados portões (`tsc`, `vitest`, `theme-audit`, `i18n:lint`, `public-audit`): sem código alterado, não há o que medir. Os resultados da sondagem (ev-6, ev-7, ev-8) não foram reexecutados nem reabertos aqui; são tomados como relato da implementação, **não verificados** por esta etapa.

## Achados

### Bloqueantes

1. **Plano desatualizado (2_PLAN.md, passo 3 e passo 4).** O plano liga a ponte por uma opção em `sdkOptions`, e a sondagem mostrou que isso não abre a ponte. O caminho é a API `./bridge` (alpha) acionada pelo processo principal do Coxia: criar sessão, emitir credencial, ligar, repassar cada mensagem, fechar. A auditoria passa a usar o id devolvido pela criação da sessão. Seguir o plano atual produziria código que não cumpre o critério 1.
2. **Decisões de segurança sem dono.** Cinco pontos abertos precisam ser fixados no plano antes de codar, porque mudam a fronteira de segurança:
   - origem do token OAuth (ler a credencial que o Claude Code guarda, ou login próprio): ler a credencial de outro programa é uma escolha sensível; precisa de aviso, nunca log do token e recusa clara quando faltar;
   - no modo `control`, a entrada remota chega ao processo do Coxia, que decide o que fazer. A regra mais segura é passá-la pelas aprovações do Coxia; se não passar, o aviso da regra 8 precisa dizer isso;
   - no `mirror`, a página aceita a mensagem e fica em "executando", sem recusa visível (critério 3 não satisfeito como escrito). Precisa de uma mensagem fixa de somente leitura ou de reescrever o critério;
   - `untrusted_device`, `session_stale_relogin` e `oauth_rejected`: proposta é rodar a etapa sem ponte e registrar o motivo, sem falhar a execução;
   - arquivar ou não as sessões ao fim (sessões de teste continuam na conta da pessoa).
3. **Tudo o mais continua por fazer** (política pura, configuração com migração, `webPolicy`, interface com aviso, auditoria, testes, CHANGELOG). Os passos 1, 2, 5, 6 e 8 do plano seguem válidos.

### Sugestões para o plano revisado

- Tratar a API `./bridge` como instável: isolá-la atrás de um módulo único e de uma interface mínima, para trocar sem tocar o resto, e testar com um fake dela.
- Tudo que o `query()` emite é repassado a claude.ai; o plano deve dizer se há filtro (segredos em saída de ferramenta) ou aceitar o risco no aviso.
- Credencial do worker dura 46800 s por informação da sondagem; definir o que fazer em etapa mais longa (renovar com `reconnectTransport` ou encerrar a ponte).
- A auditoria da #268 ainda não foi verificada como mecanismo reutilizável para um evento que não é escrita no host de código; confirmar antes de prometer.
- Critérios 1, 3 e 9 continuam sem teste automatizado possível (conta real e dependência da issue de sessões); manter no plano de QA manual.

## Não verificado

- Resultados da sondagem (sessão aparece, espelho sem entrada, controle com entrada), exceto como relatados.
- Aparição no app do celular.
- Duração da credencial e renovação.
- Se outras contas exigem token de dispositivo confiável.
- Portões do repositório.

## Próximo passo

Devolver a tl-plataforma para revisar 2_PLAN.md com as cinco decisões acima. A decisão sobre a origem do token e sobre a entrada remota no modo `control` é de produto/segurança e pode precisar da pessoa.
