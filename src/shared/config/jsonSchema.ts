// A small JSON Schema validator: the subset the config schema uses, no dependency.
// Supported keywords: type (one name or a list), enum, const, properties, required, additionalProperties (false or a schema),
// items, minItems, maxItems, uniqueItems (primitives), minLength, maxLength, minimum, maximum, pattern.

export interface JsonSchema {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

export interface SchemaIssue {
  /** Dotted path of the offending value ("llm.providers[0].baseUrl"); empty for the root. */
  path: string;
  message: string;
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  if (t === 'integer') return typeof v === 'number' && Number.isInteger(v);
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
  return typeOf(v) === t;
}

const at = (path: string, key: string | number): string => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key);

export function validateSchema(value: unknown, schema: JsonSchema, path = '', out: SchemaIssue[] = []): SchemaIssue[] {
  const fail = (message: string) => out.push({ path, message });
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      fail(`expected ${types.join(' or ')}, got ${typeOf(value)}`);
      return out;
    }
  }
  if (schema.const !== undefined && value !== schema.const) fail(`must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => e === value)) fail(`must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(`must have at least ${schema.minLength} character(s)`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(`must have at most ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) fail(`does not match ${schema.pattern}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`must have at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`must have at most ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) fail('items must be unique');
    if (schema.items) value.forEach((item, i) => validateSchema(item, schema.items as JsonSchema, at(path, i), out));
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in obj)) out.push({ path: at(path, key), message: 'is required' });
    for (const [key, v] of Object.entries(obj)) {
      const child = schema.properties?.[key];
      if (child) validateSchema(v, child, at(path, key), out);
      else if (schema.additionalProperties === false) out.push({ path: at(path, key), message: 'is not a known field' });
      else if (typeof schema.additionalProperties === 'object') validateSchema(v, schema.additionalProperties, at(path, key), out);
    }
  }
  return out;
}
