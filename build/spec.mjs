import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { parseYaml } from './yaml.mjs';

/** Where bundled external documents live inside the root spec. */
const EXTERNAL = 'x-atlas-external';
const REMOTE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Loads an OpenAPI 3.x document (JSON or YAML) and bundles every $ref that
 * points into another local file, so the rest of the build only ever sees
 * internal `#/...` pointers.
 */
export async function loadSpec(path) {
  const file = resolve(path);
  const spec = await parseFile(file);
  if (spec?.swagger) {
    throw new Error(`${path}: Swagger ${spec.swagger} is not supported, convert it to OpenAPI 3 first`);
  }
  // 3.1 lets a document hold only webhooks or components; 3.0 requires paths.
  if (!spec?.openapi || !(spec.paths || spec.webhooks || spec.components)) {
    throw new Error(`${path} is not an OpenAPI 3.x document`);
  }
  await bundleExternalRefs(spec, file);
  inlineStructuralRefs(spec);
  spec.paths ??= {};
  return spec;
}

const OPERATIONS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/**
 * OpenAPI allows no $ref for the paths object, components or a single
 * operation, but hand-split specs use them (`paths: { $ref: paths.yaml }`,
 * `get: { $ref: list.yml }`) and bundlers accept them; inline those.
 */
function inlineStructuralRefs(spec) {
  for (const key of ['paths', 'components', 'webhooks']) {
    if (typeof spec[key]?.$ref === 'string') spec[key] = deref(spec, spec[key]).node;
  }
  for (const item of [...Object.values(spec.paths ?? {}), ...Object.values(spec.webhooks ?? {})]) {
    if (REMOTE.test(item?.$ref ?? '')) continue;
    const { node } = deref(spec, item);
    for (const method of OPERATIONS) {
      const ref = node[method]?.$ref;
      if (typeof ref === 'string' && !REMOTE.test(ref)) node[method] = deref(spec, node[method]).node;
    }
  }
}

/** Parses a JSON or YAML file; text starting with `{` or `[` takes the faster JSON path first. */
async function parseFile(file) {
  const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  if (/^\s*[{[]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch (error) {
      // YAML flow syntax also starts with `{`; only .yaml files get that second chance.
      if (!/\.ya?ml$/i.test(file)) throw new Error(`${shown(file)}: invalid JSON: ${error.message}`);
    }
  }
  return parseYaml(text, { filename: shown(file) });
}

/** File name for messages: relative to the working directory. */
const shown = (file) => relative(process.cwd(), file);

/**
 * Rewrites $refs into other local files as internal pointers. Each file is
 * parsed once (cached by absolute path) and stored at
 *
 *   spec['x-atlas-external'][<path relative to the root>][<file stem>]
 *
 * so `components.yaml#/components/schemas/Pet` becomes
 * `#/x-atlas-external/components.yaml/components/components/schemas/Pet`
 * and the whole-file ref `schemas/Pet.yaml` becomes
 * `#/x-atlas-external/schemas~1Pet.yaml/Pet` — the last segment, which
 * refName() shows as the schema name, stays natural. Refs inside an
 * external file resolve against that file (its `#/...` refs point into
 * it); a ref back to the root file becomes a plain `#/...` pointer. Every
 * file is walked once, so cycles between files terminate. Remote (http:)
 * refs are left as they are; resolveRef reports them.
 */
async function bundleExternalRefs(spec, rootFile) {
  const rootDir = dirname(rootFile);
  const files = new Map([[rootFile, { pointer: '#', doc: spec }]]);
  const segment = (text) => text.replaceAll('~', '~0').replaceAll('/', '~1');

  const rewrite = (fromFile, ref) => {
    const hash = ref.indexOf('#');
    const target = hash < 0 ? ref : ref.slice(0, hash);
    const fragment = hash < 0 ? '' : ref.slice(hash + 1);
    if (REMOTE.test(target)) return ref;
    if (fragment && !fragment.startsWith('/')) {
      throw new Error(`${shown(fromFile)}: $ref "${ref}" has an unsupported fragment (expected a JSON pointer)`);
    }
    const file = target ? resolve(dirname(fromFile), decodeURI(target)) : fromFile;
    if (!files.has(file)) {
      const key = relative(rootDir, file).split(sep).join('/');
      const stem = basename(file, extname(file));
      files.set(file, { pointer: `#/${EXTERNAL}/${segment(key)}/${segment(stem)}`, key, stem, from: fromFile, ref });
    }
    return files.get(file).pointer + fragment;
  };

  const walk = (file, node, seen) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const local = (ref) => typeof ref === 'string' && !(file === rootFile && ref.startsWith('#'));
    if (local(node.$ref)) node.$ref = rewrite(file, node.$ref);
    // Discriminator mappings name their targets by $ref too; keep them matching.
    const mapping = node.discriminator?.mapping;
    if (mapping && typeof mapping === 'object') {
      for (const [value, ref] of Object.entries(mapping)) {
        if (local(ref) && /[#/]|\.(ya?ml|json)$/i.test(ref)) mapping[value] = rewrite(file, ref);
      }
    }
    for (const child of Array.isArray(node) ? node : Object.values(node)) walk(file, child, seen);
  };

  const external = {};
  for (const [file, entry] of files) { // Map iteration also visits files added meanwhile
    if (file !== rootFile) {
      try {
        entry.doc = await parseFile(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        throw new Error(`${shown(entry.from)}: $ref "${entry.ref}" points to a missing file (${shown(file)})`);
      }
      external[entry.key] = { [entry.stem]: entry.doc };
    }
    walk(file, entry.doc, new Set());
  }
  if (Object.keys(external).length > 0) spec[EXTERNAL] = external;
}

export function refName(ref) {
  return ref.split('/').pop();
}

export function resolveRef(spec, ref) {
  if (!ref.startsWith('#/')) {
    if (REMOTE.test(ref)) throw new Error(`Remote $ref is not supported: ${ref} (only local files are bundled)`);
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
    for (const name of Array.isArray(resolved.required) ? resolved.required : []) required.add(name);
  }
  Object.assign(merged, { ...schema, allOf: undefined, properties: undefined, required: undefined });
  Object.assign(properties, schema.properties ?? {});
  for (const name of Array.isArray(schema.required) ? schema.required : []) required.add(name);
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

  // Swagger 2 habit: `required: true` on the property itself. Lift those
  // into the object's list, and drop a non-array `required` either way.
  if (out.required !== undefined && !Array.isArray(out.required)) edit().required = undefined;
  if (out.properties && typeof out.properties === 'object') {
    const flagged = Object.entries(out.properties)
      .filter(([, property]) => property && property.required === true)
      .map(([name]) => name);
    if (flagged.length) edit().required = [...new Set([...(out.required ?? []), ...flagged])];
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
