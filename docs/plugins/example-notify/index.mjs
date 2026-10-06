// The kit's example in JavaScript: when a gate is decided, it asks the app to post one line to a webhook. The destination is a neutral example
// (hooks.example.com); the key is a secret setting the app puts in the call, never seen here. The post is a write that cannot be undone, so the person
// allows it always and the app announces each one with a countdown before it goes out.

/** @param {import('../kit/coxia-plugin').PluginContext} ctx */
export default async function notify(ctx) {
  ctx.write('notify', { body: { text: `Issue #${ctx.issue}: a gate was decided at ${ctx.stage ?? 'a stage'}.` } });
  return {};
}
