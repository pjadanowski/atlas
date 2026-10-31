import { deref, mergeAllOf } from './spec.mjs';

const FORMAT_EXAMPLES = {
  'date-time': '2026-01-15T09:30:00+01:00',
  date: '2026-01-15',
  email: 'jane.doe@example.com',
  uuid: '9b2e4f6a-1c3d-4e5f-8a7b-2c1d0e9f8a7b',
  uri: 'https://example.com',
  binary: '(binary)',
  password: '••••••••',
};

const MAX_DEPTH = 7;

/**
 * Builds a representative example value for a schema.
 * Prefers explicit example/default/enum values, falls back to type-based
 * placeholders. Cycle-safe: recursive $refs collapse to null.
 */
export function exampleFromSchema(spec, rawSchema, depth = 0, seenRefs = new Set()) {
  if (!rawSchema || depth > MAX_DEPTH) return null;

  const refPath = rawSchema.$ref;
  if (refPath && seenRefs.has(refPath)) return null;
  const seen = refPath ? new Set([...seenRefs, refPath]) : seenRefs;

  const { node } = deref(spec, rawSchema);
  const schema = mergeAllOf(spec, node);

  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];

  if (schema.oneOf?.length || schema.anyOf?.length) {
    const branch = (schema.oneOf ?? schema.anyOf)[0];
    return exampleFromSchema(spec, branch, depth + 1, seen);
  }

  const type = schema.type ?? (schema.properties ? 'object' : undefined);

  if (type === 'object') {
    const result = {};
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      const value = exampleFromSchema(spec, property, depth + 1, seen);
      if (value !== null || isNullable(spec, property)) result[name] = value;
    }
    return result;
  }

  if (type === 'array') {
    const item = exampleFromSchema(spec, schema.items, depth + 1, seen);
    return item === null ? [] : [item];
  }

  if (type === 'string') return FORMAT_EXAMPLES[schema.format] ?? phpDateExample(schema.format) ?? 'string';
  if (type === 'integer') return schema.minimum ?? 1;
  if (type === 'number') return schema.minimum ?? 1.5;
  if (type === 'boolean') return true;

  return null;
}

/**
 * Laravel specs declare date fields with PHP date-format strings
 * ("Y-m-d", "Y-m-d H:i:s") instead of OpenAPI's `date` format. Render a
 * concrete date for those so examples and the try-it filler are usable.
 */
function phpDateExample(format) {
  if (!format || !/^[YymdnjHGisvP\-.:/ ]+$/.test(format) || !/Y/.test(format)) return null;
  const tokens = { Y: '2026', y: '26', m: '01', n: '1', d: '15', j: '15', H: '09', G: '9', i: '30', s: '00', v: '000', P: '+01:00' };
  return format.replace(/[YymdnjHGisvP]/g, (ch) => tokens[ch]);
}

function isNullable(spec, rawSchema) {
  if (!rawSchema) return false;
  const { node } = deref(spec, rawSchema);
  return node.nullable === true;
}
