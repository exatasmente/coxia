import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test file gets its own data and specs directory: nothing a suite writes (configs, secrets, workspaces) reaches another suite
// or the real data. A file that needs a layout of its own sets the variable again before importing the modules.
process.env.CERIMONIAS_DATA_DIR = mkdtempSync(join(tmpdir(), 'cerimonias-test-data-'));
process.env.CERIMONIAS_SPECS_DIR = mkdtempSync(join(tmpdir(), 'cerimonias-test-specs-'));
// The app reads the PATH of the person's login shell for the commands it runs; a test never starts that shell (the tests of that read give it a fake one).
process.env.COXIA_NO_LOGIN_SHELL = '1';
// Hermetic git for every file: the suite also runs inside the app's release step, whose environment carries git settings for its own checkout (an excludes file that
// ignores node_modules and .venv, the hooks path); inherited, they would reach the repositories the tests make. Nor may a variable point git at another repository.
for (const name of Object.keys(process.env)) {
  if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/.test(name) || /^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM)$/.test(name)) delete process.env[name];
}
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
