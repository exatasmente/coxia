# O conjunto de modelos passou na revisão sem bloqueio; os quatro pontos a corrigir foram fechados

## O que foi conferido

A revisão comparou a branch com a `release/0.9.0` da 0.9.0-beta.13 usando `git diff origin/release/0.9.0...HEAD`. A base foi `1_SPEC.md`, `2_PLAN.md`, `3_IMPLEMENTATION.md` e as regras de segurança do workspace. Ela foi feita só por leitura e por testes rodados, sem nenhuma alteração.

Rodaram:
- typecheck, public-audit, theme-audit e i18n:lint;
- 22 arquivos de teste: catálogos de i18n, esquema e migrações da config, escopo do celular, modelos de ciclo, conjunto, subagente, cliente, descanso, oferta e laço do motor aberto, runner e cerca da worktree.

## Achados

**Bloqueio: nenhum.**

**A corrigir, todos fechados:**

1. **Reserva sem chave derrubava a chamada.** O `openMember` resolvia a chave de toda reserva logo no começo e lançava erro quando um provedor do conjunto não tinha chave. A etapa falhava mesmo com o modelo principal funcionando.
   - **Correção:** a reserva sem chave sai do conjunto, e a atividade da execução diz isso uma vez (`27db2956`).
2. **O orçamento esgotado de um subagente era engolido.** Ele virava um erro de ferramenta, e a etapa não entrava na espera por orçamento.
   - **Correção:** `budget` e `auth` do subagente sobem como os do principal (`f1e0e822`).
3. **Cache de cliente sem a chave.** Dois provedores com o mesmo servidor e modelo e chaves diferentes dividiam um cliente e uma chave.
   - **Correção:** a chave do cache passa a incluir um resumo sha256 da chave (`ef13da3f`).
4. **Faltava teste do subagente sob cerca estreita e sob execução sem cerca (#230).** O código já herdava a cerca da execução.
   - **Correção:** quatro testes novos (`e0c3b353`). Uma mutação que alarga a cerca no subagente derruba dois deles.

**Detalhes corrigidos:**
- A recusa do eco só é aprendida quando o servidor nomeia `reasoning_content` (`85747fbf`).
- O guia de configuração diz esquema 26 (`e5f88b2c`).
- O subagente de um tipo não monta ferramentas MCP (`c2340a59`).

**Riscos aceitos, registrados em `3_IMPLEMENTATION.md`:**
- **Raciocínio depois de uma troca:** o modelo novo recebe os turnos do anterior sem `reasoning_content`, e um servidor que exige o campo pode recusar.
- **Autoria numa sessão retomada:** fica perdida.
- **Leitura de "ocupado" no SDK:** é feita pelo texto da resposta.
- **Cota esgotada no flex:** um 429 de cota numa chamada flex gasta uma repetição no nível normal antes de falhar.

## O que foi conferido e está certo

- **Ferramentas do subagente.** São um filtro das do principal. `Agent` e as ferramentas sem atividade ficam com o principal. Edição e shell só existem com raiz de escrita.
- **Tela.** O subagente de tela usa a mesma sessão, com a retenção e os passes da etapa.
- **Celular pareado.** Não acrescenta reserva e não muda `llm.*`, as opções do provedor, `runner.flex` nem `llm.poolMode`.
- **Modelos de ciclo.** Nunca levam conjunto.
- **Migração.** A `v25ToV26` só sobe a versão, e a `v24ToV25` do #230 ficou intacta.
- **Opções do provedor.** Cada uma só vai ao modelo cujo provedor e catálogo permitem. O `catalogUrl` tem a origem conferida ao salvar e de novo antes de a chave ir no pedido.
- **`fail_fast`.**
  - O cliente não repete um 429 de `fail_fast`.
  - O modelo que recusou descansa 60 s.
  - O último do conjunto espera na fila.
- **Retry-After.** Conta como tentativa.
- **Tempo esgotado.** Não troca de modelo.
- **Sinal de vida do flex.** Zera o vigia da etapa.
- **Custo real.** Lido de `estimated_cost`.
- **Higiene.** CHANGELOG em `[Unreleased]`, chaves nos dois catálogos, sem cor literal, sem nome real além dos ids públicos de modelo e do atalho do provedor.
