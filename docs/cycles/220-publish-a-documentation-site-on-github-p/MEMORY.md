# Memória do ciclo

## Decisões

- A #220 é pedido de funcionalidade: publicar um site de documentação no GitHub Pages (landing, guia, referência, casos de uso, blog), escrito e mantido pelos agentes pelo ciclo normal.
- Squad `Plataforma`. Prioridade proposta `priority:medium` (nada quebra sem o site; documentação pública desatualizada e pedido grande), como proposta a quem decide.
- Refino fechou: gerador **VitePress** (o de toolchain); pasta **`site/`**; referência **incluída de `docs/`**, nunca copiada nem movida; **domínio próprio fora do escopo** (custa dinheiro e aceita termos, decisão à parte). A escolha exata do agente/fluxo/encaminhamento do agente de documentação fica com o plano técnico, com a recomendação na spec (agente novo da pessoa, com sandbox, encaminhado à pasta do site).

## Restrições

- O repositório é público: `scripts/public-audit.mjs` é gate de CI e vale para as fontes do site (rastreados + não ignorados; `.gitignore` não ignora pasta de site). Nada de empresa, pessoa, host, número real de issue ou segredo; placeholders neutros.
- `docs/` é lido pelos agentes do aplicativo em tempo de execução: a referência é incluída no site, não movida nem copiada.
- Nada no aplicativo escreve Pages nem configuração de repositório: ligar o Pages é ato da pessoa no host, uma vez.
- A cerca das ferramentas de arquivo de um agente que escreve é a pasta de trabalho da execução; guardar uma imagem no repositório por uma etapa precisa de um caminho que passe por essa cerca (o plano resolve). O texto de um documento do repositório não pode aparecer com outro texto no site: a página de referência é o mesmo arquivo.
- Nenhuma string de interface entra aqui; a regra de `t()` é do renderer, não do site.

## Tentado e descartado

- Varredura exaustiva de duplicatas sobre todas as issues: não é possível pela árvore, o rastreador só mantém pasta para uma parte das issues.
- `git ls-files` não está disponível nesta sandbox (o `.git` não é acessível), então a prova de "nenhum fluxo de Pages hoje" é a leitura da pasta de fluxos + o fato de o `site/` não existir na árvore, não um `git ls-files`.

## Perguntas abertas

- Do plano, não do produto: o agente exato, o fluxo e o encaminhamento à pasta do site (a spec já recomenda); a forma técnica de incluir a referência de `docs/`; como a checagem de links e de línguas entra no fluxo de verificação; se a publicação espera uma branch de versão.

## Onde o trabalho está

- Triagem em 2026-10-10 (tentativa 1): `0_TRIAGE.md`. Refino em 2026-10-10 (tentativa 1): `1_SPEC.md`, com 14 regras, 9 itens de aceitação antes da mesclagem e 5 depois da publicação ligada, fora de escopo e o que foi verificado por leitura.
- Próximo: plano técnico, que fecha as escolhas listadas acima.
- Passagem product-owner → plano: decida no plano o agente/fluxo/encaminhamento do agente de documentação, a forma de incluir a referência de `docs/` no site e onde entram a construção do site, a checagem de links e a checagem de línguas no CI; nada foi executado no refino, todo item de aceitação que depende de prévia local, de integração contínua ou de host segue não exercitado.
- Passagem support → product-owner: Refinar a #220 a partir deste documento: fechar as escolhas em aberto (gerador VitePress vs Jekyll, pasta e roteamento de squad do agente, referência incluída de docs/ vs movida, domínio próprio) e detalhar a aceitação em passos verificáveis. Fica fora desta etapa decidir prioridade e milestone. Vale confirmar no código, antes do plano, o formato exato do fluxo de Pages e a checagem de links/línguas no CI. <!-- handoff:11 -->
