import { VcsError, serverMessage } from './errors';

// The HTTP client every API transport shares: fetch only (no SDK), a timeout on every call, pagination, and retries that are safe.
//   - A read (GET, or a POST that only reads, such as a GraphQL query) is retried on a network failure, a timeout, 502/503/504 and a
//     rate limit whose wait is short enough; a write is never retried (it could run twice).
//   - A rate limit is read from Retry-After, GitHub's x-ratelimit-reset and GitLab's RateLimit-Reset; when the wait is longer than
//     `maxWaitMs` the call fails at once with a message that says how long to wait.
//   - The credential only travels in headers of requests to the configured host: a path that names another host is refused.

export interface HttpDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface HttpClientOptions {
  /** Shown in messages ("gitlab.example.com"). */
  host: string;
  /** API root, with or without a trailing slash. */
  baseUrl: string;
  /** Headers with the credential, resolved on every call so a changed secret applies at once. May throw a VcsError. */
  headers: () => Record<string, string>;
  timeoutMs?: number;
  /** Extra attempts after the first for a read. */
  retries?: number;
  /** Longest rate-limit wait the client sits through. */
  maxWaitMs?: number;
  deps?: HttpDeps;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  /** JSON body. */
  json?: unknown;
  /** Form-encoded body. */
  form?: Record<string, string>;
  /** Raw body: the file of an upload, which is never parsed and never retried. */
  body?: BodyInit;
  headers?: Record<string, string>;
  /** Return the body as text, not parsed. */
  text?: boolean;
  /** A POST that only reads: eligible for retries. */
  idempotent?: boolean;
  /** Names what was asked for, for the "not found" message. */
  what?: string;
}

const RETRYABLE = new Set([502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_MAX_WAIT_MS = 20_000;
const BACKOFF_MS = 400;

export class HttpClient {
  readonly host: string;
  private readonly base: string;
  private readonly origin: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly maxWaitMs: number;
  private readonly headers: () => Record<string, string>;

  constructor(o: HttpClientOptions) {
    this.host = o.host;
    this.base = o.baseUrl.endsWith('/') ? o.baseUrl : `${o.baseUrl}/`;
    this.origin = new URL(this.base).origin;
    this.headers = o.headers;
    this.fetchFn = o.deps?.fetch ?? fetch;
    this.sleep = o.deps?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.deps?.now ?? Date.now;
    this.timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = o.retries ?? DEFAULT_RETRIES;
    this.maxWaitMs = o.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  }

  /** The absolute URL of a path relative to the API root. A path that carries a scheme or starts with a slash is refused. */
  url(path: string, query?: RequestOptions['query']): string {
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('/') || path.includes('\\') || /[\r\n]/.test(path) || /(^|\/)(\.|%2e){2}(\/|\?|$)/i.test(path)) throw new VcsError('invalid', { detail: path });
    const u = new URL(path, this.base);
    if (u.origin !== this.origin) throw new VcsError('invalid', { detail: path });
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }

  /** A full URL the host itself handed back (a "next" link), only when it stays on the API origin. */
  sameOrigin(absolute: string): string {
    const u = new URL(absolute);
    if (u.origin !== this.origin) throw new VcsError('invalid', { detail: u.origin });
    return u.toString();
  }

  async request(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, o: RequestOptions = {}): Promise<HttpResponse> {
    return this.send(method, this.url(path, o.query), o);
  }

  async absolute(url: string, o: RequestOptions = {}): Promise<HttpResponse> {
    return this.send(o.body !== undefined ? 'POST' : 'GET', this.sameOrigin(url), o);
  }

  private async send(method: string, url: string, o: RequestOptions): Promise<HttpResponse> {
    const reads = method === 'GET' || o.idempotent === true;
    const attempts = reads ? this.retries + 1 : 1;
    let last: VcsError | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.once(method, url, o);
      } catch (e) {
        if (!(e instanceof VcsError)) throw e;
        last = e;
        const retry = attempt < attempts && (e.code === 'network' || e.code === 'timeout' || (e.code === 'server' && RETRYABLE.has(e.status ?? 0)) || (e.code === 'rate_limited' && e.retryAfterMs !== null && e.retryAfterMs <= this.maxWaitMs));
        if (!retry) throw e;
        await this.sleep(e.retryAfterMs ?? BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
    throw last as VcsError;
  }

  private async once(method: string, url: string, o: RequestOptions): Promise<HttpResponse> {
    const headers: Record<string, string> = { ...this.headers(), ...o.headers };
    let body: BodyInit | undefined;
    if (o.body !== undefined) {
      body = o.body;
    } else if (o.json !== undefined) {
      body = JSON.stringify(o.json);
      headers['Content-Type'] = 'application/json';
    } else if (o.form) {
      body = new URLSearchParams(o.form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    let res: Response;
    try {
      res = await this.fetchFn(url, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs), redirect: 'follow' });
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'TimeoutError' || name === 'AbortError') throw new VcsError('timeout', { host: this.host, seconds: Math.round(this.timeoutMs / 1000) });
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      throw new VcsError('network', { host: this.host, detail: cause?.code ?? cause?.message ?? (e as Error).message });
    }
    const type = res.headers.get('content-type') ?? '';
    const parsed: unknown = o.text ? await res.text() : type.includes('json') ? await res.json().catch(() => null) : await res.text();
    if (res.status >= 200 && res.status < 300) return { status: res.status, headers: res.headers, body: parsed };
    throw this.failure(res, parsed, o);
  }

  private failure(res: Response, body: unknown, o: RequestOptions): VcsError {
    const status = res.status;
    const detail = serverMessage(body);
    const limited = this.limitWait(res);
    if (status === 429 || (status === 403 && limited !== null)) {
      return new VcsError('rate_limited', { host: this.host, seconds: Math.ceil((limited ?? 60_000) / 1000) }, { status, retryAfterMs: limited ?? 60_000 });
    }
    if (status === 401) return new VcsError('auth', { host: this.host, status }, { status });
    if (status === 403) return new VcsError('forbidden', { host: this.host, status, detail }, { status });
    if (status === 404) return new VcsError('not_found', { host: this.host, what: o.what ?? '' }, { status });
    if (status >= 500) return new VcsError('server', { host: this.host, status }, { status });
    return new VcsError('invalid', { detail: `HTTP ${status}${detail ? `: ${detail}` : ''}` }, { status });
  }

  /** Milliseconds to wait according to the rate-limit headers, or null when the response is not a rate limit. */
  private limitWait(res: Response): number | null {
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
      const at = Date.parse(retryAfter);
      if (!Number.isNaN(at)) return Math.max(0, at - this.now());
    }
    const remaining = res.headers.get('x-ratelimit-remaining') ?? res.headers.get('ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset') ?? res.headers.get('ratelimit-reset');
    if (remaining === '0' && reset) {
      const n = Number(reset);
      // GitHub sends an epoch in seconds; GitLab's RateLimit-Reset is also an epoch.
      if (Number.isFinite(n)) return Math.max(0, n * 1000 - this.now()) + 500;
    }
    return null;
  }

  async getJson<T>(path: string, query?: RequestOptions['query'], what?: string): Promise<T> {
    return (await this.request('GET', path, { query, what })).body as T;
  }

  /** Page/per_page pagination (GitLab, GitHub). `pick` unwraps responses that nest the rows (GitHub search). */
  async pages<T>(path: string, o: { query?: Record<string, string | number | undefined>; perPage?: number; maxPages?: number; pick?: (body: unknown) => T[]; what?: string } = {}): Promise<T[]> {
    const perPage = o.perPage ?? 100;
    const out: T[] = [];
    for (let page = 1; page <= (o.maxPages ?? 5); page++) {
      const body = (await this.request('GET', path, { query: { ...o.query, per_page: perPage, page }, what: o.what })).body;
      const rows = o.pick ? o.pick(body) : (body as T[]);
      if (!Array.isArray(rows)) break;
      out.push(...rows);
      if (rows.length < perPage) break;
    }
    return out;
  }

  /** `values` + `next` pagination (Bitbucket Cloud). */
  async values<T>(path: string, o: { query?: Record<string, string | number | undefined>; maxPages?: number; what?: string } = {}): Promise<T[]> {
    const out: T[] = [];
    let res = await this.request('GET', path, { query: { pagelen: 100, ...o.query }, what: o.what });
    for (let page = 1; ; page++) {
      const b = res.body as { values?: T[]; next?: string };
      out.push(...(b.values ?? []));
      if (!b.next || page >= (o.maxPages ?? 5)) break;
      res = await this.absolute(b.next, { what: o.what });
    }
    return out;
  }
}
