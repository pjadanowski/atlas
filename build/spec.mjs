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
  if (!schema?.allOf) return schema;
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
  return merged;
}
