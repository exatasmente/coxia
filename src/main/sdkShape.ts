import type { ZodType } from 'zod';

type Zod = (typeof import('zod'))['z'];

/**
 * The zod shape the Claude SDK's `tool()` takes for an app tool whose JSON Schema the open engine uses. Every property is loose (`z.unknown()`), so the app and not the SDK
 * answers a wrong value, in its own words; it carries its description, which the model reads; and it is optional unless the schema lists it in `required`. In zod 4 a bare
 * `z.unknown()` key is required, both when the SDK parses a call and in the JSON Schema the model is shown: without the `.optional()` the model is made to send every field
 * of the tool, and the app then refuses the ones the operation does not take.
 */
export function looseShape(z: Zod, schema: unknown): Record<string, ZodType> {
  const { properties = {}, required = [] } = (schema ?? {}) as { properties?: Record<string, { description?: string } | undefined>; required?: readonly string[] };
  return Object.fromEntries(
    Object.entries(properties).map(([name, p]) => {
      const field = required.includes(name) ? z.unknown() : z.unknown().optional();
      return [name, p?.description ? field.describe(p.description) : field];
    }),
  );
}
