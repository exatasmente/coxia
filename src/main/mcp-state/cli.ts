import { serve } from './server';
import { stateTools } from './tools';
import { actTools } from './actTools';

// The local state server of the app, over standard input and output: a terminal session's MCP entry spawns this file with plain node.
// No Electron, no network listener, nothing on the terminal besides the JSON-RPC answers (spec rule 5). The npm package is not touched: the
// server needs none of the SDK. With the workspace's second switch on, the persona's tools are listed after the reads; they run in the open app.
serve(process.stdin, process.stdout, process.env, (env) => [...stateTools(env), ...actTools(env)])
  // The session closed its end and every answer is out: the connection to the app would otherwise keep this process alive.
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    // Stdio us broken (the session left): nothing to word it to; the app's own answers never depend on this process.
    process.exitCode = 1;
    void e;
  });
