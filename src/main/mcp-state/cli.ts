import { serve } from './server';
import { stateTools } from './tools';

// The local read-only state server of the app, over standard input and output: a terminal session's MCP entry spawns this file with plain node.
// No Electron, no network listener, nothing on the terminal besides the JSON-RPC answers (spec rule 5). The npm package is not touched: the
// server needs none of the SDK.
serve(process.stdin, process.stdout, process.env, stateTools).catch((e: unknown) => {
  // Stdio us broken (the session left): nothing to word it to; the app's own answers never depend on this process.
  process.exitCode = 1;
  void e;
});
