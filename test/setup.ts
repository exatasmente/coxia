import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test file gets its own data and specs directory: nothing a suite writes (configs, secrets, workspaces) reaches another suite
// or the real data. A file that needs a layout of its own sets the variable again before importing the modules.
process.env.CERIMONIAS_DATA_DIR = mkdtempSync(join(tmpdir(), 'cerimonias-test-data-'));
process.env.CERIMONIAS_SPECS_DIR = mkdtempSync(join(tmpdir(), 'cerimonias-test-specs-'));
