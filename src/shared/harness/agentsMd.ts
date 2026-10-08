export const AGENTS_FILE = 'AGENTS.md';
export const AGENTS_FILE_MAX = 256 * 1024;
export const DOCS_STATE_DIR = '.coxia';

export interface AgentsDocument {
  path: typeof AGENTS_FILE;
  text: string;
  size: number;
  mtimeMs: number;
}

export interface AgentsDocsState {
  repo: string;
  exists: boolean;
  document: AgentsDocument | null;
  ignored: string[];
  signature: string;
}
