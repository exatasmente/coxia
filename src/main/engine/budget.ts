// A provider that refuses a call because the key ran out of budget is not a failure of the stage: it is a wait.
// Both engines classify the refusal here, from the HTTP answer or from the text the SDK hands back, so the rule is one thing.

/** The words that, in a body of a 403 or a 429, say the refusal is about the key's budget rather than a plain rate limit. */
const BUDGET_WORDS = /quota|billing|credit|balance|insufficient|out of (credits|funds)|limit exceeded|monthly limit|payment required|exceeded your current quota|exhausted/i;
/** A 429 that says this clears with a retry and is not a budget refusal. */
const TRANSIENT_WORDS = /rate limit|too many requests|try again|retry after/i;

/** The status the provider's own words carry: `API Error: 403 Key limit exceeded (monthly limit)`. */
const STATUS_TEXT = /\b(402|403|429)\b/;
/** A text that asks for a fix on the key itself (a 401, "invalid api key") is never a budget refusal. */
const KEY_WORDS = /\b401\b|invalid (x-)?api[ -]?key|incorrect api key|authentication failed|unauthorized|no longer valid/i;

export interface TextRefusal {
  status: number | null;
  /** Whether the text asks for a fix on the key itself: never a budget refusal. */
  key: boolean;
}

/** The status and the shape a plain error text carries, when it carries one. */
export function readTextRefusal(text: string): TextRefusal {
  const line = text.trim();
  const status = Number(line.match(STATUS_TEXT)?.[1] ?? NaN);
  return { status: Number.isFinite(status) ? status : null, key: /authenticate/i.test(line) && !BUDGET_WORDS.test(line) ? true : KEY_WORDS.test(line) };
}

/**
 * Whether a status and body are a refusal by budget: 402 by definition; a 403 whose body speaks of quota, billing, credit or balance (never one that
 * only says "authenticate", which the SDK prefixes to the gateway's own message); a 429 whose body says the same, and not a plain rate limit.
 */
export function classifyBudget(status: number, body: string): boolean {
  const text = `${body ?? ''}`.trim();
  if (status === 402) return true;
  if (status === 403) return BUDGET_WORDS.test(text);
  if (status === 429) return BUDGET_WORDS.test(text) && !TRANSIENT_WORDS.test(text);
  return false;
}

/**
 * Whether an HTTP answer is a refusal by budget in the open engine: only 402 and the 403 with a budget body are the budget reason; a 429 that carries
 * quota wording keeps its own `quota` reason (non-retryable, the balance ran out), which the engine has always had.
 */
export function budgetRefusal(status: number, body: string): boolean {
  return status === 402 || (status === 403 && classifyBudget(status, body));
}

/** Whether a text a model or the SDK handed back is a refusal by budget. Nothing here matches only on "authenticate", which the SDK prefixes. */
export function budgetText(text: string): boolean {
  const { status, key } = readTextRefusal(text);
  if (key) return false;
  if (status !== null) return classifyBudget(status, text);
  return /402|payment required|insufficient (quota|credits|funds)|out of credits|exceeded your current quota|key limit exceeded|monthly limit|quota|billing balance/i.test(text);
}

/**
 * Whether a text the SDK handed back says the model was busy: a rate limit, an overload or a server error (the refusals that move a call to the next model of its pool).
 * Budget decides first, and a text about the key itself is never a busy model. The SDK words an API failure as `API Error: <status> <body>`; a text that carries no status
 * is read by the name the API gives the error. Anything else is not recognised, and the call fails as it always did.
 */
export function busyText(text: string): 'rate_limit' | 'overloaded' | 'server' | null {
  if (budgetText(text) || readTextRefusal(text).key) return null;
  const status = Number(text.match(/\bAPI Error:?\s*(\d{3})\b/i)?.[1] ?? NaN);
  if (status === 429) return 'rate_limit';
  if (status === 503 || status === 529) return 'overloaded';
  if (status >= 500 && status <= 599) return 'server';
  if (Number.isFinite(status)) return null;
  if (/rate_limit_error/i.test(text)) return 'rate_limit';
  if (/overloaded_error/i.test(text)) return 'overloaded';
  return null;
}

/** What a call said, for the failure message; kept short, like the rest of the outside text. */
export function clipProviderText(text: string, max = 4000): string {
  const clean = text.replace(/\r/g, '').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
