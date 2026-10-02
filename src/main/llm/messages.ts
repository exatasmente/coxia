// User-facing texts of the LLM transport layer. pt-BR is what the app shows today; the en table is for the later i18n.
export type Lang = 'pt-BR' | 'en';
export type Params = Record<string, string | number>;

const ptBR = {
  connRefused: (p: Params) =>
    `Não foi possível conectar a ${p.host}: o servidor local não está rodando (conexão recusada). Inicie o Ollama, o LM Studio ou o servidor configurado e confira a URL.`,
  hostNotFound: (p: Params) => `O endereço ${p.host} não existe (DNS). Confira a URL base do provedor.`,
  timeout: (p: Params) => `${p.host} não respondeu a tempo. O servidor pode estar carregando o modelo; tente de novo.`,
  connReset: (p: Params) => `A conexão com ${p.host} foi interrompida. ${p.detail}`,
  upstreamUnreachable: (p: Params) => `Falha ao falar com ${p.host}: ${p.detail}`,
  auth: (p: Params) => `O provedor recusou a chave de API (HTTP ${p.status}). Confira a chave configurada. ${p.detail}`,
  forbidden: (p: Params) => `O provedor negou o acesso (HTTP ${p.status}). A chave não tem permissão para este modelo ou recurso. ${p.detail}`,
  modelNotFound: (p: Params) => `Modelo "${p.model}" não encontrado no provedor. Confira o nome${p.hint ? ` (${p.hint})` : ''}. ${p.detail}`,
  rateLimit: (p: Params) => `Limite de requisições do provedor atingido. Aguarde um pouco e tente de novo. ${p.detail}`,
  quota: (p: Params) => `A cota ou o saldo do provedor acabou. ${p.detail}`,
  contextTooLong: (p: Params) =>
    `prompt is too long: ${p.actual} tokens > ${p.limit} maximum. A conversa passou da janela de contexto do modelo: aumente o contexto no servidor (num_ctx no Ollama) ou use um modelo maior. ${p.detail}`,
  noTools: (p: Params) =>
    `O modelo "${p.model}" não suporta chamada de ferramentas, e a cerimônia precisa dela para ler arquivos e devolver respostas estruturadas. Escolha outro modelo. ${p.detail}`,
  badRequest: (p: Params) => `O provedor recusou a requisição (HTTP ${p.status}): ${p.detail}`,
  serverError: (p: Params) => `O provedor falhou (HTTP ${p.status}): ${p.detail}`,
  overloaded: (p: Params) => `O provedor está sobrecarregado (HTTP ${p.status}). ${p.detail}`,
  contentFilter: () => 'O provedor bloqueou a resposta pelo filtro de conteúdo.',
  streamBroken: (p: Params) => `A resposta do provedor foi interrompida no meio: ${p.detail}`,
  invalidUpstream: (p: Params) => `Resposta inválida do provedor: ${p.detail}`,
  unauthorizedProxy: () => 'Token do adaptador local inválido.',
  notFoundRoute: (p: Params) => `Rota desconhecida no adaptador local: ${p.path}`,
  unknownUpstream: () => 'Provedor não registrado no adaptador local.',
  invalidJson: () => 'Corpo da requisição não é um JSON válido.',
  badMethod: () => 'Método não suportado.',
  tooLarge: () => 'Requisição grande demais para o adaptador local.',
  probeUnreachable: (p: Params) => `Servidor inacessível em ${p.url}: ${p.detail}`,
  probeModelsOk: (p: Params) => `${p.count} modelo(s) listado(s).`,
  probeModelsFail: (p: Params) => `Não foi possível listar os modelos (${p.detail}). Alguns servidores não expõem essa rota; o teste continua.`,
  probeModelMissing: (p: Params) => `O modelo "${p.model}" não aparece na lista do servidor${p.hint ? ` (ex.: ${p.hint})` : ''}.`,
  probePlainOk: (p: Params) => `Resposta simples ok em ${p.ms} ms.`,
  probePlainFail: (p: Params) => `Falha na resposta simples: ${p.detail}`,
  probeToolsOk: (p: Params) => `Chamada de ferramenta ok em ${p.ms} ms.`,
  probeToolsNoCall: () => 'O modelo respondeu, mas não chamou a ferramenta pedida. Modelos pequenos costumam falhar nisso; a cerimônia precisa de ferramentas.',
  probeToolsFail: (p: Params) => `Falha na chamada de ferramenta: ${p.detail}`,
  probeToolsBadArgs: () => 'O modelo chamou a ferramenta com argumentos que não são JSON válido.',
  probeSlow: (p: Params) => `A resposta levou ${p.ms} ms: um modelo local lento deixa as cerimônias longas.`,
  probeReasoning: () => 'O modelo devolve o raciocínio em um campo próprio (reasoning); o adaptador o esconde da resposta.',
  probeContext: (p: Params) => `Janela de contexto informada pelo servidor: ${p.tokens} tokens.`,
  probeSmallContext: (p: Params) => `Janela de contexto de ${p.tokens} tokens é pequena: o prompt do agente sozinho passa de 10 mil tokens.`,
};

type Table = typeof ptBR;
export type MsgKey = keyof Table;

const en: Table = {
  connRefused: (p) =>
    `Could not connect to ${p.host}: the local server is not running (connection refused). Start Ollama, LM Studio or the configured server and check the URL.`,
  hostNotFound: (p) => `The address ${p.host} does not exist (DNS). Check the provider base URL.`,
  timeout: (p) => `${p.host} did not answer in time. The server may be loading the model; try again.`,
  connReset: (p) => `The connection to ${p.host} was interrupted. ${p.detail}`,
  upstreamUnreachable: (p) => `Failed to reach ${p.host}: ${p.detail}`,
  auth: (p) => `The provider rejected the API key (HTTP ${p.status}). Check the configured key. ${p.detail}`,
  forbidden: (p) => `The provider denied access (HTTP ${p.status}). The key has no permission for this model or feature. ${p.detail}`,
  modelNotFound: (p) => `Model "${p.model}" not found on the provider. Check the name${p.hint ? ` (${p.hint})` : ''}. ${p.detail}`,
  rateLimit: (p) => `Provider rate limit reached. Wait a moment and try again. ${p.detail}`,
  quota: (p) => `The provider quota or balance is exhausted. ${p.detail}`,
  contextTooLong: (p) =>
    `prompt is too long: ${p.actual} tokens > ${p.limit} maximum. The conversation exceeded the model context window: raise the context on the server (num_ctx in Ollama) or use a larger model. ${p.detail}`,
  noTools: (p) =>
    `Model "${p.model}" does not support tool calls, and the ceremony needs them to read files and return structured answers. Pick another model. ${p.detail}`,
  badRequest: (p) => `The provider rejected the request (HTTP ${p.status}): ${p.detail}`,
  serverError: (p) => `The provider failed (HTTP ${p.status}): ${p.detail}`,
  overloaded: (p) => `The provider is overloaded (HTTP ${p.status}). ${p.detail}`,
  contentFilter: () => 'The provider blocked the response with its content filter.',
  streamBroken: (p) => `The provider response was cut off midway: ${p.detail}`,
  invalidUpstream: (p) => `Invalid provider response: ${p.detail}`,
  unauthorizedProxy: () => 'Invalid local adapter token.',
  notFoundRoute: (p) => `Unknown route on the local adapter: ${p.path}`,
  unknownUpstream: () => 'Provider not registered on the local adapter.',
  invalidJson: () => 'Request body is not valid JSON.',
  badMethod: () => 'Unsupported method.',
  tooLarge: () => 'Request too large for the local adapter.',
  probeUnreachable: (p) => `Server unreachable at ${p.url}: ${p.detail}`,
  probeModelsOk: (p) => `${p.count} model(s) listed.`,
  probeModelsFail: (p) => `Could not list models (${p.detail}). Some servers do not expose this route; the test goes on.`,
  probeModelMissing: (p) => `Model "${p.model}" is not in the server list${p.hint ? ` (e.g. ${p.hint})` : ''}.`,
  probePlainOk: (p) => `Plain completion ok in ${p.ms} ms.`,
  probePlainFail: (p) => `Plain completion failed: ${p.detail}`,
  probeToolsOk: (p) => `Tool call ok in ${p.ms} ms.`,
  probeToolsNoCall: () => 'The model answered but did not call the requested tool. Small models often fail at this; the ceremony needs tools.',
  probeToolsFail: (p) => `Tool call failed: ${p.detail}`,
  probeToolsBadArgs: () => 'The model called the tool with arguments that are not valid JSON.',
  probeSlow: (p) => `The answer took ${p.ms} ms: a slow local model makes ceremonies long.`,
  probeReasoning: () => 'The model returns its reasoning in a separate field (reasoning); the adapter hides it from the answer.',
  probeContext: (p) => `Context window reported by the server: ${p.tokens} tokens.`,
  probeSmallContext: (p) => `A context window of ${p.tokens} tokens is small: the agent prompt alone is over 10k tokens.`,
};

export const MESSAGES: Record<Lang, Table> = { 'pt-BR': ptBR, en };

export function msg(lang: Lang, key: MsgKey, params: Params = {}): string {
  return (MESSAGES[lang] ?? MESSAGES['pt-BR'])[key](params);
}
