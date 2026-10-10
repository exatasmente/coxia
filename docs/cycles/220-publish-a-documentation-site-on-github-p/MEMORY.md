# Memória do ciclo

## Decisões

- A #220 é pedido de funcionalidade, não bug, pergunta nem duplicata: pede publicar um site de documentação no GitHub Pages (landing, guia, referência, casos de uso, blog) escrito e mantido pelos agentes pelo ciclo normal.
- Dá para entender como está escrita: comportamento e aceitação têm condição verificável. Nada foi executado; a conferência foi só de leitura contra a árvore.
- Squad proposto: `Plataforma` (workflow novo, pasta de site no git, agente com sandbox por squad, auditoria, checagem de CI). Prioridade sugerida: `priority:medium` — documentação pública desatualizada e grande porte, mas nada quebrado. Decisão de quem tem autonomia.

## Restrições

- O repositório é público: `scripts/public-audit.mjs` é gate de CI e vale para as fontes do site (rastreados + não ignorados; `.gitignore` não ignora `site/`). Nada de empresa, pessoa, host, número real de issue ou segredo; placeholders neutros.
- `docs/` é lido pelos agentes do aplicativo em tempo de execução: a referência deve ser incluída no site, não movida nem copiada.
- Nada no aplicativo escreve Pages nem configuração de repositório: ligar o Pages é ato da pessoa no host, uma vez.
- Nenhuma string de interface entra aqui; a regra de `t()` é do renderer, não do site.

## Tentado e descartado

- Varredura exaustiva de duplicatas sobre todas as issues: não é possível pela árvore, o rastreador só mantém pasta para uma parte das issues. Ficou o que existe nas pastas presentes.

## Perguntas abertas

- Do refino, não da triagem: VitePress vs Jekyll; nome da pasta e roteamento de squad do agente de documentação; referência incluída de `docs/` vs movida; domínio próprio agora (efeito externo, decisão à parte); o que o site mostra enquanto as imagens não existem.

## Onde o trabalho está

- Triagem concluída em 2026-10-10 (tentativa 1). Entrega: `0_TRIAGE.md`. Próximo: refino do produto fecha as escolhas em aberto e detalha a aceitação; depois plano técnico.
