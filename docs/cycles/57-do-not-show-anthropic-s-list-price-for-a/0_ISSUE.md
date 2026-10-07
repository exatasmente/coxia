# 57 Do not show Anthropic's list price for an SDK call that went to another provider

- Endereço: https://github.com/exatasmente/coxia/issues/57
- Estado: open
- Rótulos: bug, coxia, priority:high
- Autor: exatasmente

## Descrição

## Scope (updated 2026-10-06)

Do not show Anthropic's list price for a call that went to another provider through the SDK, and carry "estimated" to the screen.

- When the provider of the role is not Anthropic's own API, the SDK's `total_cost_usd` does not become the stage's cost: it is left unknown, or marked as an estimate.
- The `estimated` flag the open engine already reports reaches `StageUsage` and the run timeline.
- The token counts already recorded stay as they are.

The single total of ceremonies and runs is #104.

---

## The problem

On the Claude Agent SDK path, a call reports its usage as zero tokens plus the SDK's `total_cost_usd` (`src/main/agents.ts`, where the result message is read: `promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: m.total_cost_usd`). The SDK prices the call as if it were a Claude model at Anthropic's list price. When the provider is a gateway serving another model (a non-Anthropic `baseUrl`, `legacyCustomEndpoint`), that number has nothing to do with what was charged.

Measured on one workspace: a run showed **US$ 51.55** in the app, while the tokens in its own SDK transcripts, priced at what the gateway charged for the same model, come to about **US$ 1.5**. That is about 30 times too high. The run screen, the stage usage and anything that sums them are wrong by that much. Since the tokens are recorded as zero, nothing can recompute the cost later.

Ceremony calls are counted separately (the cost file of the workspace, which reads the gateway's real cost per generation). So the app has no single place where the real spend of a run and of the ceremonies add up.

## What you would like to happen

- **Record the tokens on the SDK path.** Input, output and cache read come from the result message's `usage`, so they are kept even when the cost is unknown.
- **Do not show Anthropic's price for a call that did not go to Anthropic.** On a non-Anthropic `baseUrl`, the cost is either the provider's own figure, when it gives one (the gateway's cost per generation, as the ceremonies already read), or it is marked as an estimate or as unknown. It is never shown as a plain dollar amount.
- **One total.** The run screen and the cost view add up the runner's stages and mentions together with the ceremonies, so the person sees what the key actually spent.

## Notes

- The open engine already reports tokens and marks an estimated cost (`estimated`). The SDK path should follow the same contract.

## Comentários

### exatasmente, 2026-10-06T19:02:21Z

Escopo reduzido: os tokens de uma chamada do SDK já são contados por resposta (`src/main/agents.ts`). Fica aqui só não mostrar o preço de lista da Anthropic fora da Anthropic e levar a marca de estimativa até a tela. O total único de cerimônias e execuções foi para #104. Prioridade alta mantida.

### exatasmente, 2026-10-06T02:20:45Z

**Prioridade: high (proposta do product owner)**

Sugiro manter `priority:high`. Motivo, nas palavras do produto: o custo mostrado hoje engana quem usa o app — uma execução apareceu como US$ 51,55 quando o gateway cobrou cerca de US$ 1,5, ~30× a mais, e como os tokens ficam zerados nada permite recalcular o valor depois. Um número de custo em que não se pode confiar contamina toda decisão de gasto, e é isso que a issue pede para consertar: guardar os tokens mesmo quando o preço é desconhecido, não mostrar preço da Anthropic numa chamada que não foi para lá, e ter um total único que some execução e cerimônias.

Não é decisão minha: é proposta, e o rótulo final é seu.
