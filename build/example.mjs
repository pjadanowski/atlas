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
export function exampleFromSchema(spec, rawSchema, depth = 0, seenRefs = new Set(), mode = 'model') {
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
    const value = exampleFromSchema(spec, branch, depth + 1, seen, mode);
    // The first variant is shown, so the discriminator must name it.
    const property = schema.discriminator?.propertyName;
    if (property && value && typeof value === 'object' && !Array.isArray(value) && value[property] === undefined) {
      const mapped = Object.entries(schema.discriminator.mapping ?? {}).find(([, ref]) => ref === branch.$ref)?.[0];
      const named = mapped ?? (branch.$ref ? branch.$ref.split('/').pop() : undefined);
      if (named !== undefined) return { [property]: named, ...value };
    }
    return value;
  }

  const type = schema.type ?? (schema.properties ? 'object' : undefined);

  if (type === 'object') {
    const result = {};
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      if (!includedIn(spec, property, mode)) continue;
      const value = exampleFromSchema(spec, property, depth + 1, seen, mode);
      if (value !== null || isNullable(spec, property)) result[name] = value;
    }
    const extra = schema.additionalProperties;
    if (Object.keys(result).length === 0 && extra && typeof extra === 'object') {
      const value = exampleFromSchema(spec, extra, depth + 1, seen, mode);
      if (value !== null) result.key = value;
    }
    return result;
  }

  if (type === 'array') {
    const item = exampleFromSchema(spec, schema.items, depth + 1, seen, mode);
    return item === null ? [] : [item];
  }

  if (type === 'string') return FORMAT_EXAMPLES[schema.format] ?? phpDateExample(schema.format) ?? 'string';
  if (type === 'integer') return schema.minimum ?? (schema.exclusiveMin !== undefined ? Math.floor(schema.exclusiveMin) + 1 : 1);
  if (type === 'number') return schema.minimum ?? (schema.exclusiveMin !== undefined ? schema.exclusiveMin + 0.5 : 1.5);
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
  return mergeAllOf(spec, node)?.nullable === true;
}

/** Requests never carry readOnly fields, responses never writeOnly ones. */
function includedIn(spec, rawSchema, mode) {
  if (mode === 'model' || !rawSchema) return true;
  const { node } = deref(spec, rawSchema);
  if (mode === 'request') return !(rawSchema.readOnly || node.readOnly);
  if (mode === 'response') return !(rawSchema.writeOnly || node.writeOnly);
  return true;
}
