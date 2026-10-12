# Triagem: política de autonomia configurável

## Tipo
Pedido de funcionalidade. Não é bug, pergunta nem duplicada.

## Dá para entender?
Sim. Conferido só por leitura (nada foi executado). Regras e critérios de aceite são claros: padrão tudo retido, precedência agente > squad > workspace, quatro categorias sempre retidas com aviso, texto do prompt gerado da política, vigência a partir da próxima etapa com registro, `screen_handoff` intacto, tela de configuração, `t()` nos dois catálogos e CHANGELOG.

## Esclarecido por quem abriu
- Os "tipos de passo" da política são os motivos de retenção que o app já tem, sem tipos novos: envio de formulário, nome do controle, atalho, diálogo, passo não reconhecido e confirmação pedida pelo agente. "Novos tipos de passo" fica fora do escopo.
- Pagamento, envio a pessoas, segredos e cartão continuam sempre retidos; a política não os libera. Como não são tipos separados, seguem detectados como hoje, por palavras no nome do controle. Liberação tentada é ignorada com aviso (regra 5).

## O que o código mostra hoje (lido)
- `src/main/runner/screenPrompt.ts` monta as regras `runner.rules.screen*` a partir de fatos fixos (`ScreenPrompt`); nada vem de uma política.
- Retenção de passos do navegador em `src/main/browser/classify.ts` e `src/shared/browser.ts`: classificação `free | irreversible | unclassified`; motivo (`HoldWhy`) `submit | name | shortcut | dialog | unclassified`, mais o motivo `agent` das confirmações pedidas pelo agente (`screen_confirm`).
- Catálogos `src/shared/i18n/main.en.json` e `main.pt-BR.json` citam `screen_handoff`/`runner.rules.screen`.
- Não verificado: onde ficam as configurações de agente, squad e workspace e se os três níveis já existem como camadas; se há tela de configurações onde encaixar a visão por tipo e nível.

## O que falta
Nada que dependa de quem abriu. Para o planejamento: confirmar no código as camadas de configuração e a tela de configurações.

## Relacionadas
- #268 (auditoria de passos autônomos): dependência declarada; não vai à produção sem ela. Os registros exigidos nos critérios se sobrepõem.
- #270 e #262 (sessão do Claude Code agindo pelas ferramentas da persona): relação só potencial, não verificada; mais passos autônomos ampliam a superfície que a política governa.
- Nenhuma duplicada identificada.

## Impacto em quem usa
Quem não configura nada não vê mudança (padrão retido). Quem configura passa a ter passos rodando sem pedir; risco de segurança, daí a lista fixa sempre retida e a dependência da auditoria.

## Sugestões (não decisões)
- Prioridade: priority:medium, pois é opcional para quem não configura, mas bloqueada por #268.
- Squad: plataforma (runner, prompt, config, fronteira de segurança); a tela de configurações toca a experiência, então o planejamento deve prever trabalho conjunto.
