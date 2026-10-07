# O que os textos mudados dizem sobre o motor aberto, conferido

## O que foi verificado e como

A entrega desta rodada é texto: a nota que o assistente mostra ao cadastrar um provedor, a página de provedores nas duas línguas, as notas do README e uma linha do CHANGELOG. Não há tela nova nem comportamento novo, então a verificação tem duas partes: os portões que o repositório exige e uma comparação, frase por frase, entre o que os textos passaram a dizer e o que o motor faz.

Os comandos foram rodados nesta máquina, nesta etapa, e os resultados abaixo são deles.

| Comando | Resultado |
|---|---|
| `npx tsc --noEmit` | passou, exit 0, sem saída |
| `npm run i18n:lint` | passou, exit 0: 4054 chaves nas duas línguas, 0 literais |
| `node scripts/theme-audit.mjs` | passou, exit 0: 55 pares de contraste no claro e no escuro; 8 cores literais em `api.ts`, o número de antes |
| `node scripts/public-audit.mjs` | passou, exit 0: 911 arquivos, nada de empresa ou pessoa |
| `npx vitest run test/gitlab-catalogs-unchanged.test.ts test/i18n.test.ts test/main-catalogs.test.ts test/wizard-i18n.test.ts` | passou, exit 0: 4 arquivos, 23 testes |
| `npx vitest run --maxWorkers=2` (suíte inteira) | 222 arquivos: 221 passaram, 1 falhou; 3663 testes passaram, 1 vermelho (ver "Ruído de carga") |
| `npx vitest run test/voice-setup.test.ts` | passou, exit 0: 21 testes, em menos de 1 s |

## Critério por critério

**1. A nota do assistente.** O valor da chave `wizard.models.openEngineNote` nos dois catálogos não contém mais "ferramentas só de leitura" nem "read-only tools" e afirma as três coisas: o motor aberto é o loop de agente do app, ele lê, escreve dentro do worktree da execução e roda comandos sob a mesma política de segurança do Claude Agent SDK, e a qualidade depende do modelo escolhido. As duas línguas dizem o mesmo, com a mesma chave e sem parâmetro.

**2. A nota continua no mesmo lugar.** A chave é usada em um único ponto do assistente, para todo tipo de provedor que não é Claude (`ModelsStep.tsx`); o diff não tem nenhuma linha nesse componente. O teste do assistente confere que a chave existe nas duas línguas e que os marcadores são os mesmos — passou.

**3. A escolha do motor.** A página de provedores, nas duas línguas, não contém mais a frase de que "a camada de configuração vai trocar" nem "por enquanto a seleção"/"For now selection". No lugar há uma passagem dizendo que a escolha é configuração e que nada no ambiente é preciso para escolher o motor; o bloco de variáveis de ambiente continua, apresentado **só** como recurso de teste, com a frase que o diz nas duas línguas.

**4. Provedor e papel.** A mesma passagem explica, nas duas línguas, que cada provedor cadastrado em `llm.providers` carrega o seu motor e cada papel aponta provedor e modelo.

**5. A tabela de cobertura.** A página não afirma mais que só o servidor falso foi testado: o texto conta o modelo real pelo OpenRouter, no motor aberto, apenas no runner, contra um host falso, em quatro execuções. O diff não alterou **nenhuma** linha da tabela nem do texto ao redor.

**6. O que não rodou.** A mesma página continua listando o que não foi exercitado (nenhum outro modelo, nenhum provedor local, nenhuma cerimônia, nenhum host de código real, nenhum repositório grande), como antes.

**7. As duas línguas.** As correções valem nas duas línguas, com o mesmo sentido; o comparador de catálogos e o lint de chaves passaram.

**8. O README.** As duas notas honestas deixaram de dizer que o motor aberto só foi testado contra um servidor falso e contam o mesmo que a tabela: um modelo de verdade em quatro execuções, no runner e contra um host de código falso, e nenhum provedor local testado ainda.

**9. Sem segredo nem referência interna.** Nenhum dos textos novos cita número de issue, nome de pessoa, host ou segredo; a auditoria pública passou. Nenhuma chave ficou sem par: o comparador de chaves e o lint passaram.

**10. Nada de comportamento mudou.** O diff são sete arquivos de texto, documento e livro de testes, nenhum arquivo de comportamento. Os testes que exercem catálogo e texto passaram; a suíte inteira tem um teste vermelho por estouro de tempo, em arquivo de instalação de voz, que passa quando rodado sozinho.

**11. O que os textos dizem bate com o motor.** As afirmações novas foram conferidas contra o código: as ferramentas de leitura, a escrita só com raiz de escrita e o `Bash`/MCP da lista (`loop.ts`), a seleção e o motor vindo da configuração do provedor e do papel (`engineFor`, `openSelection`), os limites já declarados na própria página e a nota do README contra a tabela.

## Ruído de carga

A suíte inteira rodada de uma vez deu um teste vermelho, em `voice-setup` ("reports a failed install to the error log…"), por estouro do tempo de 5 segundos. O mesmo arquivo, rodado sozinho, passa (21 testes, exit 0). O diff não toca nada que esse teste exercite, e a leitura é sobrecarga da máquina ao rodar 222 arquivos. **Não verificado** se o estouro também acontece nesta máquina com o repositório sem esta mudança.

## O que ficou de fora

- Nenhuma tela foi aberta: a nota do assistente foi conferida no catálogo e no ponto em que é mostrada, não renderizada.
- Nenhuma execução com modelo real: as afirmações sobre o motor aberto saem do código e dos documentos, não de uma execução.
- A fixture congelada foi conferida por leitura e pelo teste de catálogos, que passou; não foi comparada byte a byte contra o `main` nesta etapa.
