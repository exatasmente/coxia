import { beforeEach, describe, expect, it, vi } from 'vitest';

const askAgent = vi.fn();
vi.mock('../src/main/agents', () => ({ askAgent: (...args: unknown[]) => askAgent(...args), obj: (p: unknown) => p, str: { type: 'string' } }));

const { MAX_CODE, clearFixes, fixDiagram } = await import('../src/main/diagramFix');

beforeEach(() => {
  askAgent.mockReset();
  clearFixes();
});

describe('fixDiagram', () => {
  it('asks once for the same broken code and reuses the fix', async () => {
    askAgent.mockResolvedValue({ data: { code: 'flowchart TD\n  A["a (b)"] --> B' } });
    const broken = 'flowchart TD\n  A[a (b)] --> B';
    expect(await fixDiagram(broken, 'Parse error')).toBe('flowchart TD\n  A["a (b)"] --> B');
    expect(await fixDiagram(`\`\`\`mermaid\n${broken}\n\`\`\``, 'other message')).toBe('flowchart TD\n  A["a (b)"] --> B');
    expect(askAgent).toHaveBeenCalledTimes(1);
    expect(askAgent.mock.calls[0][3]).toMatchObject({ maxTurns: 1, tools: [] });
  });

  it('shares one call between concurrent requests', async () => {
    askAgent.mockResolvedValue({ data: { code: 'graph TD\nA-->B' } });
    await Promise.all([fixDiagram('graph TD\nA->>B', 'e'), fixDiagram('graph TD\nA->>B', 'e')]);
    expect(askAgent).toHaveBeenCalledTimes(1);
  });

  it('strips a fence the model adds and rejects an unchanged answer, without resending', async () => {
    askAgent.mockResolvedValueOnce({ data: { code: '```mermaid\ngraph TD\nA-->B\n```' } });
    expect(await fixDiagram('graph TD\nA->>B', 'e')).toBe('graph TD\nA-->B');
    askAgent.mockResolvedValueOnce({ data: { code: 'graph TD\nX--B' } });
    await expect(fixDiagram('graph TD\nX--B', 'e')).rejects.toThrow('no fix');
    await expect(fixDiagram('graph TD\nX--B', 'e')).rejects.toThrow('no fix');
    expect(askAgent).toHaveBeenCalledTimes(2);
  });

  it('retries after a failed call', async () => {
    askAgent.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ data: { code: 'graph TD\nA-->B' } });
    await expect(fixDiagram('graph TD\nA->>B', 'e')).rejects.toThrow('network');
    await Promise.resolve();
    expect(await fixDiagram('graph TD\nA->>B', 'e')).toBe('graph TD\nA-->B');
  });

  it('never sends empty or oversized code', async () => {
    await expect(fixDiagram('  ', 'e')).rejects.toThrow();
    await expect(fixDiagram('a'.repeat(MAX_CODE + 1), 'e')).rejects.toThrow();
    expect(askAgent).not.toHaveBeenCalled();
  });
});
