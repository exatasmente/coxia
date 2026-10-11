// A small JSON Schema validator for the answers and tool arguments of the open engine. It covers what the app's schemas use
// (type, enum, const, properties, required, additionalProperties, items, min/max, anyOf/oneOf/allOf), not the whole spec.
import type { Json } from './types';

// i18n-ignore-start: what the model reads when its own call or answer is wrong: English by design, like the tool descriptions
const MESSAGES = {
  anyOf: "{path}: matches none of the alternatives",
  const: "{path}: must be {value}",
  enum: "{path}: must be one of {values}",
  type: "{path}: expected {expected}, got {got}",
  or: " or ",
  tooShort: "{path}: text too short",
  tooLong: "{path}: text too long",
  min: "{path}: less than {value}",
  max: "{path}: greater than {value}",
  minItems: "{path}: needs at least {value} items",
  maxItems: "{path}: at most {value} items",
  required: "{path}: required field missing",
  unexpected: "{path}: unexpected field",
} as const;
// i18n-ignore-end

/** One finding of the validator, as the model reads it. */
function say(key: keyof typeof MESSAGES, params: Record<string, string | number>): string {
  return MESSAGES[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
}

export function validate(value: unknown, schema: Json | undefined, path = '$'): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const errors: string[] = [];
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
    const options = (s.anyOf ?? s.oneOf) as Json[];
    if (!options.some((o) => validate(value, o, path).length === 0)) errors.push(say('anyOf', { path }));
    return errors;
  }
  if (Array.isArray(s.allOf)) for (const sub of s.allOf as Json[]) errors.push(...validate(value, sub, path));
  if (s.const !== undefined && JSON.stringify(value) !== JSON.stringify(s.const)) errors.push(say('const', { path, value: JSON.stringify(s.const) }));
  if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(say('enum', { path, values: JSON.stringify(s.enum) }));
  }
  const types = s.type === undefined ? null : Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
  if (types && !types.some((t) => matchesType(value, t))) {
    errors.push(say('type', { path, expected: types.join(say('or', {})), got: typeOf(value) }));
    return errors;
  }
  if (typeof value === 'string') {
    if (typeof s.minLength === 'number' && value.length < s.minLength) errors.push(say('tooShort', { path }));
    if (typeof s.maxLength === 'number' && value.length > s.maxLength) errors.push(say('tooLong', { path }));
  }
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) errors.push(say('min', { path, value: s.minimum }));
    if (typeof s.maximum === 'number' && value > s.maximum) errors.push(say('max', { path, value: s.maximum }));
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) errors.push(say('minItems', { path, value: s.minItems }));
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) errors.push(say('maxItems', { path, value: s.maxItems }));
    if (s.items && typeof s.items === 'object') value.forEach((v, i) => errors.push(...validate(v, s.items as Json, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Json;
    const props = (s.properties ?? {}) as Record<string, Json>;
    for (const key of Array.isArray(s.required) ? (s.required as string[]) : []) {
      if (!(key in obj)) errors.push(say('required', { path: `${path}.${key}` }));
    }
    for (const [key, sub] of Object.entries(props)) if (key in obj) errors.push(...validate(obj[key], sub, `${path}.${key}`));
    if (s.additionalProperties === false) {
      for (const key of Object.keys(obj)) if (!(key in props)) errors.push(say('unexpected', { path: `${path}.${key}` }));
    }
  }
  return errors;
}

// Lenient repair before validation: drop fields the schema does not allow (small models add "explicacao"-style extras).
export function prune(value: unknown, schema: Json | undefined): unknown {
  if (!schema || typeof schema !== 'object') return value;
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
    const options = (s.anyOf ?? s.oneOf) as Json[];
    const fit = options.find((o) => validate(prune(value, o), o).length === 0);
    return fit ? prune(value, fit) : value;
  }
  if (Array.isArray(value) && s.items && typeof s.items === 'object') return value.map((v) => prune(v, s.items as Json));
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Json;
    const props = (s.properties ?? {}) as Record<string, Json>;
    const out: Json = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k in props) out[k] = prune(v, props[k]);
      else if (s.additionalProperties !== false) out[k] = v;
    }
    return out;
  }
  return value;
}

export function describeErrors(errors: string[]): string {
  return errors.slice(0, 8).join('; ');
}
