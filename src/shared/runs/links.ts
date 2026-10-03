// What the runner reads of the host's answer to the creation of an issue: its number (GitHub says `number`, GitLab `iid`, Bitbucket `id`) and where to read it.

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function createdIssueOf(response: unknown): { iid: number; url: string | null } | null {
  const r = rec(response);
  const n = r.number ?? r.iid ?? r.id;
  const iid = typeof n === 'number' ? n : typeof n === 'string' && /^\d+$/.test(n) ? Number(n) : null;
  if (iid === null || !Number.isSafeInteger(iid) || iid <= 0) return null;
  const html = rec(rec(r.links).html);
  const url = [r.html_url, r.web_url, html.href].find((u): u is string => typeof u === 'string' && !!u) ?? null;
  return { iid, url };
}
