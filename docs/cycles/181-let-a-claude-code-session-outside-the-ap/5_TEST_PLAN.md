# Plan de pruebas: QA del servidor de estado local de solo lectura

## Qué cubre este plan

Cada criterio de aceptación de la especificación se convierte en un escenario numerado: qué hacer, qué esperar, cómo se verificó en este ciclo, y la comprobación que lo mantiene (el id `ev-N`). Los escenarios se ejecutaron controlando el programa del servidor construido (`out/main/mcp-state.js`, producido por una ejecución de build exitosa en esta ronda) como un proceso real generado sobre sus streams estándar en una carpeta de datos desechable, o a través de los propios suites de pruebas del ciclo. Nada toca un modelo real, un host de código o la red.

## Escenarios

**1. Toggle y entrada copiable en Configuraciones (criterio 1).**
Encender el opt-in del espacio de trabajo en Configuraciones: una entrada `{"mcpServers": {"coxia-state": {type: stdio, command: node, args: [...], env: {CERIMONIAS_MCP_WORKSPACE: <workspace-id>}}}}` se muestra copible, con una escritura de fusión confirmada en el `.mcp.json` de la carpeta del proyecto; con el opt-in apagado, ni una cosa ni la otra se muestra. Ejecutado: los suites de configuración y entrada pasan (ev-5) — off no muestra entrada ni ofrece escritura; on renderiza la entrada con el id del espacio de trabajo, y la escrita ofrecida se fusiona en un `.mcp.json` existente sin arruinar un servidor ajeno, rechaza una entrada de mismo nombre corriendo un programa distinto, y nunca toca el archivo en opt-out.
Verificación visual en pantalla: **no ejecutada** — la ventana de la aplicación no puede iniciar en este entorno (el ayudante de sandbox de Electron no puede configurarse, y el optimizador de dependencias del servidor de desarrollo del renderizador no puede escribir su caché); comportamiento verificado a través de los suites, no en pantalla.

**2. Una sesión externa lista las herramientas de lectura (criterio 2).**
Una sesión de Claude Code iniciada en la carpeta del proyecto del espacio de trabajo después de que exista la entrada lista las seis herramientas `coxia_state_*`; sin la entrada o con el opt-in apagado, ninguna. **No ejecutada**: lo que una sesión externa real recoge no puede verificarse aquí; queda para la verificación de la persona, según el plan. Prueba interna parcial ejecutada: `tools/list` sobre pipes reales del programa construido responde exactamente las seis herramientas de lectura (ev-6).

**3. La lectura de ciclos refleja el tablero del espacio de trabajo, y nada de otro espacio de trabajo (criterio 3).**
Ejecutada: un espacio de trabajo desechable con una tarjeta y un segundo espacio de trabajo con su propia tarjeta — la respuesta nombra solo la tarjeta del espacio de trabajo servido y nunca la del otro (ev-5 a través de los suites de aislamiento, ev-6 a través de la ejecución de extremo a extremo).

**4. La lectura de ejecución responde la etapa, el estado y la pregunta pendiente exacta; el segredo plantado nunca cruza (criterio 4, con la revisión de командa del plan).**
Ejecutada: una ejecución en estado de pregunta responde su etapa, estado, la pregunta pendiente exacta con la sustancia de la respuesta intacta y una forma de segredo plantado enmascarada; una ejecución en estado de puerta responde `"question": null` y `"pendingCommand": null` con la nota de que un comando esperando aprobación nunca es visible (no se guarda con la ejecución) (ev-5, y la ejecución de extremo a extremo ev-6 hizo la pregunta exacta a la ejecución).

**5. La lectura de conversación responde el hilo sin líneas de sistema, enmascarado (criterio 5).**
Ejecutada: un hilo sembrado (agente, sistema, persona) se responde en orden — la línea de sistema ausente, un token de autorización plantado enmascarado, la prosa citada legible. También cubierto por las formas de secretos plantadas del propio suite de enmascaramiento (ev-5, ev-6).

**6. La lectura de evidencia responde las grabaciones que la etapa guardó, con el path almacenado (criterio 6).**
Ejecutada: el registro sembrado vuelve con nombres, tipo, título y path almacenado; el archivo de evidencia en disco existe (ev-6; la igualdad de forma con los registros de la ejecución también a través de los suites, ev-5).

**7. La lectura de actividades responde los registros de actividad del espacio de trabajo (criterio 7).**
Ejecutada: la memoria de actividad sembrada se responde nombrando el issue de la ejecución; un espacio de trabajo vacío responde el mensaje vacío, nunca estado inventado (ev-5, ev-6).

**8. Con la aplicación cerrada, siempre toda lectura responde, fresca por llamada (criterio 8).**
Ejecutada: las ejecuciones de extremo a extremo generan el servidor construido solo — ningún proceso de la aplicación existe en el entorno mientras responde (ev-6); los suites prueban que una tarjeta escrita entre dos llamadas se responde por la segunda, y una ejecución escrita por una versión más reciente se rechaza en lugar de leerse parcialmente (ev-5).

**9. Ninguna herramienta escribe (criterio 9).**
Ejecutada: después de que un servidor generado responde ciclos, ejecuciones, actividades, procedimientos y conversación, cada archivo del espacio de trabajo es byte-identico al anterior, y la pregunta esperando sigue esperando (ev-9); una herramienta con forma de escrita se rechaza como un error, y un método desconocido responde el código de método-no-encontrado (ev-6); ninguna herramienta nombrada para escritura existe en absoluto (la lista de herramientas respondida, ev-6).

**10. Resolución del espacio de trabajo: apagado, sin variable, desconocido o id inválido se rechaza en todas partes (regla de spec 7).**
Ejecutada: con el opt-in apagado, sin la variable de entorno, con un id desconocido y con un id inválido, toda llamada responde el mismo error y ningún dato (ev-6); el test de aislamiento de registry también prueba que el dato de un segundo espacio de trabajo nunca cruza (ev-5).

**11. Solo local: ningún listener de red (regla de spec 5).**
Ejecutada: un proceso de servidor generado sirviendo un espacio de trabajo no mantiene ningún socket de escucha mientras corre (ev-7).

**12. La lectura de memoria de procedimientos responde (criterio para el almacén de #179).**
Ejecutada: un procedimiento guardado se lista por título con id y revision y nunca sus pasos; un id nombrado que ya no está se rechaza (ev-5, ev-6).

**13. Enmascaramiento en toda la superficie.**
Ejecutada: el suite de enmascaramiento fija la división entre máscara de prosa y máscara de documento de board — un token de encabezado, un email, una cadena opaca y un path de home nunca cruzan, y una versión fijada en prosa de board no se enmascara falsamente (ev-5).

**14. Verificación de requisitos (gates).**
Ejecutada esta ronda: los diez suites tocados y nuevos pasan (10 archivos, 117 pruebas, ev-5), el typecheck devuelve 0, el lint de traducción reporta 0 hallazgos sobre 5408 claves, la auditoría de tema devuelve 0 con sus 14 hallazgos preexistentes en pantallas de ciclo que este cambio no toca, la auditoría pública está verde sobre 1530 archivos (ev-8), y el build de producción sucede, produciendo el archivo del servidor que la entrada nombra (ev-8).

## No verificado en este ciclo

- Una sesión externa real (criterio 2): verificación de la persona, con la entrada desde Configuraciones.
- El comportamiento del panel de Configuraciones en pantalla (la mitad visual del escenario 1): la ventana de la aplicación no puede iniciar en este entorno; el comportamiento se verifica a través de los suites de configuración y entrada.
- Paths de Windows e instalación empaquetada (asar): fuera del alcance de este entorno.

## Cómo se condujeron los escenarios

Los espacios de trabajo desechables se construyen a través de las superficies de almacén de la propia aplicación en carpetas temporales fuera del repositorio; el programa del servidor construido se genera una vez por sesión de escenario y se controla con líneas de solicitud JSON-RPC sobre su entrada estándar, esperando respuestas delimitadas por saltos de línea. Ningún escenario llega a un modelo real, un host de código o la red.

## Resultado dos cenários

- 01 Toggle and copyable server entry in Settings (on shows entry and write offer; off shows neither; merge does not clobber): passou (executado na sandbox) — Executado através das suites próprias do ciclo: settings-mcp-state (off oculta entrada e oferta de escrita; on renderiza a entrada com o id do workspace; a escrita mesclada preserva um servidor alheio) e mcp-state-entry (merge-not-clobber, recusa de mesmo nome-programa diferente, opt-out nunca toca no arquivo). Verificação visual na tela não possível neste ambiente: a janela de Electron não inicia (helper SUID não configurável) e o otimizador de dependências do vite não consegue escrever no node_modules somente-leitura. Não verificado visualmente.
- 02 An external Claude Code session lists the six read tools: não rodou (executado na sandbox) — O que uma sessão externa real recolhe não pode ser verificado a partir deste ambiente; conforme o plano fica para verificação da pessoa. Prova interna parcial executada: tools/list sobre pipes reais do compilado out/main/mcp-state.js responde exatamente as seis ferramentas coxia_state_*.
- 03 The cycles read answers only the served workspace's board: passou (executado na sandbox) — End-to-end contra o CLI compilado sobre pipes reais: um cartão semeado no workspace servido é respondido; um cartão em um segundo workspace nunca aparece. Também coberto pelas suites de isolamento.
- 04 The run read answers stage, status and the exact pending question; a planted secret is masked; a pending command is answered as never visible: passou (executado na sandbox) — End-to-end contra o CLI compilado: uma execução em status question responde status, a pergunta exata com a substância intacta e a forma plantada de client-secret mascarada; a resposta traz pendingCommand null e a nota de comandos. A suite também responde a question null de uma execução gate.
- 05 The conversation read answers the thread in order without system lines and masked: passou (executado na sandbox) — End-to-end contra o CLI compilado: um thread semeado (agente, sistema, pessoa) é respondido com seq 1 e 3, a linha de sistema ausente, o token Authorization plantado mascarado e a prosa da pessoa legível; a suite de mascaramento fixa as formas.
- 06 The evidence read answers the records the stage saved with the stored path: passou (executado na sandbox) — End-to-end contra o CLI compilado: o registro semeado volta com o nome ev-1.txt, o tipo, o título e o caminho guardado; o arquivo existe em disco. A suite checa igualdade de forma e o caminho encolhido (shrunk path).
- 07 The activities read answers the workspace's activity records and the empty message when there is none: passou (executado na sandbox) — End-to-end responde a memória semeada citando a referência da issue da execução; a suite prova que um workspace vazio responde a mensagem vazia, nunca um estado inventado.
- 08 With the app closed every read answers, refreshed per call: passou (executado na sandbox) — As execuções end-to-end lançam o servidor compilado sozinho, sem processo do app no ambiente enquanto responde; as suites provam que um cartão escrito entre duas chamadas é respondido pela segunda e que uma execução escrita por uma versão mais nova é recusada em vez de lida pela metade.
- 09 No tool writes anything: passou (executado na sandbox) — Depois de um servidor lançado responder ciclos, execuções, atividades, procedimentos e conversação, todos os arquivos do workspace são byte-idênticos aos anteriores e a pergunta em espera continua esperando; uma ferramenta com nome de escrita é recusada como erro e nenhuma ferramenta nomeada para escrita existe em tools/list (método desconhecido responde -32601).
- 10 Workspace resolution: off, missing, unknown or invalid id is refused on every tool: passou (executado na sandbox) — End-to-end contra o CLI compilado sobre pipes reais: com o opt-in off, sem a variável de ambiente, com um id desconhecido e com um id inválido, toda chamada responde o mesmo erro e nenhum dado; o conjunto de testes de isolamento de registry prova que os dados de um segundo workspace nunca atravessam.
- 11 The state server opens no network listener: passou (executado na sandbox) — Um processo de servidor lançado servindo um workspace foi checado com uma listagem de socket filtrada pelo pid enquanto rodava: nenhum socket de escuta pertence a ele; o único listener node na máquina pertence a outro processo.
- 12 The procedures memory read lists procedures without their steps and refuses a missing id: passou (executado na sandbox) — End-to-end: um procedimento semeado é listado por título, e a resposta nunca carrega o texto dos passos; um id gone é recusado com a mensagem correspondente.
- 13 Masking on every surface, never a raw secret: [redacted] (executado na sandbox) — O conjunto de testes de mascaramento fixa a divisão prosa/quadro: um token de cabeçalho, um email, uma string opaca e um caminho de home nunca atravessam mascarados, e uma versão pinoada na prosa do quadro não é falsamente mascarada; a execução end-to-end confirma nas ferramentas de runs e conversation.
- 14 The project gates pass (typecheck, suites, lints, audits, build): passou (executado na sandbox) — tsc --noEmit exit 0; vitest sobre as dez suites tocadas/novas: 10 arquivos, 117 testes, todos passando; i18n:lint 0 findings sobre 5408 chaves em ambos os catálogos; theme-audit exit 0 com 14 findings pré-existentes em telas de ciclo que a mudança não toca; public-audit green sobre 1530 arquivos; electron-vite build exit 0 produzindo out/main/mcp-state.js. As quatro suites de browser falham pela falta do módulo deste ambiente, sem variação.
- 15 On-screen look at the Settings panel in a running app window: não rodou (executado na sandbox) — A janela de Electron não consegue iniciar neste ambiente (helper SUID sandbox não configurável; o otimizador de dependências do vite não consegue escrever no seu node_modules read-only), então o painel foi verificado pelas suites apenas, não na tela. O comportamento de um painel está de outra forma coberto por settings-mcp-state.
- 16 Windows and packaged (asar) behavior of the server entry: não rodou (lido) — Fora do alcance deste ambiente; pelo plano, não projetado aqui e deixado para o que os testes de portabilidade de config permitam.
