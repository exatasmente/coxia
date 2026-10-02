// A small JSON Schema validator for the answers and tool arguments of the open engine. It covers what the app's schemas use
// (type, enum, const, properties, required, additionalProperties, items, min/max, anyOf/oneOf/allOf), not the whole spec.
import type { Json } from './types';

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
    if (!options.some((o) => validate(value, o, path).length === 0)) errors.push(`${path}: não corresponde a nenhuma das alternativas`);
    return errors;
  }
  if (Array.isArray(s.allOf)) for (const sub of s.allOf as Json[]) errors.push(...validate(value, sub, path));
  if (s.const !== undefined && JSON.stringify(value) !== JSON.stringify(s.const)) errors.push(`${path}: deve ser ${JSON.stringify(s.const)}`);
  if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path}: deve ser um de ${JSON.stringify(s.enum)}`);
  }
  const types = s.type === undefined ? null : Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
  if (types && !types.some((t) => matchesType(value, t))) {
    errors.push(`${path}: esperado ${types.join(' ou ')}, veio ${typeOf(value)}`);
    return errors;
  }
  if (typeof value === 'string') {
    if (typeof s.minLength === 'number' && value.length < s.minLength) errors.push(`${path}: texto curto demais`);
    if (typeof s.maxLength === 'number' && value.length > s.maxLength) errors.push(`${path}: texto longo demais`);
  }
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) errors.push(`${path}: menor que ${s.minimum}`);
    if (typeof s.maximum === 'number' && value > s.maximum) errors.push(`${path}: maior que ${s.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) errors.push(`${path}: precisa de pelo menos ${s.minItems} itens`);
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) errors.push(`${path}: no máximo ${s.maxItems} itens`);
    if (s.items && typeof s.items === 'object') value.forEach((v, i) => errors.push(...validate(v, s.items as Json, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Json;
    const props = (s.properties ?? {}) as Record<string, Json>;
    for (const key of Array.isArray(s.required) ? (s.required as string[]) : []) {
      if (!(key in obj)) errors.push(`${path}.${key}: campo obrigatório ausente`);
    }
    for (const [key, sub] of Object.entries(props)) if (key in obj) errors.push(...validate(obj[key], sub, `${path}.${key}`));
    if (s.additionalProperties === false) {
      for (const key of Object.keys(obj)) if (!(key in props)) errors.push(`${path}.${key}: campo não previsto`);
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
