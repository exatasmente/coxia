// Wire types of the OpenAI Chat Completions API, as far as the open engine uses them.
export type Json = Record<string, unknown>;

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  // Some reasoning models (DeepSeek, vLLM) want their own reasoning back on assistant turns that carry tool calls.
  reasoning_content?: string;
}

export interface ToolDef {
  type: 'function';
  function: { name: string; description?: string; parameters: Json };
}

export type ToolChoice = 'auto' | 'required' | 'none' | { type: 'function'; function: { name: string } };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  tools?: ToolDef[];
  tool_choice?: ToolChoice;
  parallel_tool_calls?: boolean;
  response_format?: Json;
  [key: string]: unknown;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  // `cache_write_tokens` is null on servers that do not bill cache writes.
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number | null };
  completion_tokens_details?: { reasoning_tokens?: number | null };
  prompt_cache_hit_tokens?: number;
  // What the provider says the call cost, in US dollars (OpenRouter sends `cost`, other servers `estimated_cost`).
  cost?: number;
  estimated_cost?: number;
}

export interface ChatChunk {
  choices?: {
    index?: number;
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      refusal?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: Usage | null;
  // The tier that served the call (a server with tiers says so on every answer).
  service_tier?: string | null;
  error?: unknown;
}

export interface ChatResponse {
  choices?: {
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      refusal?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: Usage | null;
  service_tier?: string | null;
  error?: unknown;
}

// What one model call returned, after the stream (or the JSON body) is folded.
export interface Completion {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number; costUsd?: number; cacheWriteTokens?: number; reasoningTokens?: number } | null;
  // The upstream field the reasoning came in, when any.
  reasoningField: 'reasoning_content' | 'reasoning' | null;
  // What the server said about the call besides its content: the id it logs the request under and the tier that served it.
  meta?: { requestId?: string; tier?: string };
}
