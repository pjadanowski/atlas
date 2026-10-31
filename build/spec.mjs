import { readFile } from 'node:fs/promises';

export async function loadSpec(path) {
  const raw = await readFile(path, 'utf8');
  const spec = JSON.parse(raw);
  if (!spec.openapi || !spec.paths) {
    throw new Error(`${path} is not an OpenAPI 3.x document`);
  }
  return spec;
}

export function refName(ref) {
  return ref.split('/').pop();
}

export function resolveRef(spec, ref) {
  if (!ref.startsWith('#/')) {
    throw new Error(`External $ref is not supported: ${ref}`);
  }
  let node = spec;
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  if (node === undefined) {
    throw new Error(`Unresolvable $ref: ${ref}`);
  }
  return node;
}

/**
 * Follows a $ref chain to its target.
 * Returns { node, name } where name is the last component name in the chain
 * (used as the schema's display identity), or null for inline nodes.
 */
export function deref(spec, node) {
  let name = null;
  const seen = new Set();
  while (node && typeof node === 'object' && node.$ref) {
    if (seen.has(node.$ref)) break;
    seen.add(node.$ref);
    name = refName(node.$ref);
    node = resolveRef(spec, node.$ref);
  }
  return { node: node ?? {}, name };
}

/**
 * Merges allOf branches into a single schema object (shallow, build-time
 * only). The wrapper's own sibling keys win over inherited branch keys —
 * `{ allOf: [Base], description: "specific" }` must keep "specific". The
 * seen set stops self-referential allOf chains from recursing forever.
 */
export function mergeAllOf(spec, schema, seen = new Set()) {
  if (!schema?.allOf) return normalizeSchema(spec, schema);
  if (seen.has(schema)) return { ...schema, allOf: undefined };
  seen.add(schema);
  const merged = {};
  const properties = {};
  const required = new Set();
  for (const branch of schema.allOf) {
    const { node } = deref(spec, branch);
    const resolved = mergeAllOf(spec, node, seen);
    Object.assign(merged, { ...resolved, properties: undefined, required: undefined });
    Object.assign(properties, resolved.properties ?? {});
    for (const name of resolved.required ?? []) required.add(name);
  }
  Object.assign(merged, { ...schema, allOf: undefined, properties: undefined, required: undefined });
  Object.assign(properties, schema.properties ?? {});
  for (const name of schema.required ?? []) required.add(name);
  if (Object.keys(properties).length > 0) merged.properties = properties;
  else merged.properties = undefined;
  if (required.size > 0) merged.required = [...required];
  else merged.required = undefined;
  merged.allOf = undefined;
  return normalizeSchema(spec, merged);
}

const isNullSchema = (node) => node?.type === 'null' || (Array.isArray(node?.type) && node.type.length === 1 && node.type[0] === 'null');

/**
 * Folds OpenAPI 3.1 / JSON Schema idioms into the 3.0 shape the renderers
 * read, so nothing downstream has to know both dialects:
 *
 * - `type: ["string", "null"]` → `type: "string"` + `nullable`; several
 *   non-null types stay listed in `types` for the label.
 * - `anyOf|oneOf: [X, {type: "null"}]` → X + `nullable` — how Scramble
 *   writes a nullable `$ref`, which would otherwise read as a two-way union.
 * - `examples: [...]` (3.1 schema keyword) → `example` when none is set.
 * - `const` → a one-value enum, so pills and examples pick it up.
 * - numeric `exclusiveMinimum|Maximum` (3.1) vs boolean modifiers (3.0) are
 *   both exposed as `exclusiveMin|Max` bounds.
 *
 * Returns the input untouched when there is nothing to fold.
 */
export function normalizeSchema(spec, schema) {
  if (!schema || typeof schema !== 'object') return schema;
  let out = schema;
  const edit = () => {
    if (out === schema) out = { ...schema };
    return out;
  };

  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((type) => type !== 'null');
    edit();
    if (types.length !== schema.type.length) out.nullable = true;
    out.type = types.length === 1 ? types[0] : types.length === 0 ? 'null' : undefined;
    if (types.length > 1) out.types = types;
  }

  for (const key of ['anyOf', 'oneOf']) {
    const branches = schema[key];
    if (!Array.isArray(branches)) continue;
    const real = branches.filter((branch) => !isNullSchema(branch));
    if (real.length === branches.length) continue;
    if (real.length === 1) {
      const { node, name } = deref(spec, real[0]);
      const { [key]: _dropped, ...siblings } = out;
      const target = mergeAllOf(spec, node);
      out = { ...target, ...siblings, nullable: true };
      if (name && !out['x-ref-name']) out['x-ref-name'] = name;
    } else {
      edit()[key] = real;
      out.nullable = true;
    }
  }

  if (out.example === undefined && Array.isArray(out.examples) && out.examples.length > 0) {
    edit().example = out.examples[0];
  }
  if (out.const !== undefined && !out.enum) {
    edit().enum = [out.const];
  }
  if (typeof out.exclusiveMinimum === 'number') edit().exclusiveMin = out.exclusiveMinimum;
  else if (out.exclusiveMinimum === true && out.minimum !== undefined) {
    edit().exclusiveMin = out.minimum;
    out.minimum = undefined;
  }
  if (typeof out.exclusiveMaximum === 'number') edit().exclusiveMax = out.exclusiveMaximum;
  else if (out.exclusiveMaximum === true && out.maximum !== undefined) {
    edit().exclusiveMax = out.maximum;
    out.maximum = undefined;
  }
  return out;
}

/**
 * Display name of a schema reached through a nullable wrapper — the name a
 * plain `$ref` would have given it, kept by normalizeSchema.
 */
export function schemaRefName(schema, fallback = null) {
  return fallback ?? schema?.['x-ref-name'] ?? null;
}
