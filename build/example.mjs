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
export function exampleFromSchema(spec, rawSchema, depth = 0, seenRefs = new Set(), mode = 'model', name = '') {
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
    for (const [propertyName, property] of Object.entries(schema.properties ?? {})) {
      if (!includedIn(spec, property, mode)) continue;
      const value = exampleFromSchema(spec, property, depth + 1, seen, mode, propertyName);
      if (value !== null || isNullable(spec, property)) result[propertyName] = value;
    }
    const extra = schema.additionalProperties;
    if (Object.keys(result).length === 0 && extra && typeof extra === 'object') {
      const value = exampleFromSchema(spec, extra, depth + 1, seen, mode);
      if (value !== null) result.key = value;
    }
    return result;
  }

  if (type === 'array') {
    const item = exampleFromSchema(spec, schema.items, depth + 1, seen, mode, singular(name));
    return item === null ? [] : [item];
  }

  if (type === 'string') {
    return (
      FORMAT_EXAMPLES[schema.format] ??
      phpDateExample(schema.format) ??
      fitString(nameExample(name, 'string'), schema) ??
      (schema.pattern ? fitString(sampleFromPattern(schema.pattern), schema) : null) ??
      'string'
    );
  }
  if (type === 'integer' || type === 'number') {
    const guess = nameExample(name, type);
    if (guess !== null && inRange(guess, schema)) return guess;
  }
  if (type === 'integer') return schema.minimum ?? (schema.exclusiveMin !== undefined ? Math.floor(schema.exclusiveMin) + 1 : 1);
  if (type === 'number') return schema.minimum ?? (schema.exclusiveMin !== undefined ? schema.exclusiveMin + 0.5 : 1.5);
  if (type === 'boolean') return true;

  return null;
}

/**
 * Plausible values by property name, for specs without examples — which is
 * every spec Scramble generates. `{"email": "string", "lat": 1.5}` reads as
 * filler; `{"email": "jane.doe@example.com", "lat": 52.52}` reads as an API.
 * Only applied when the schema gives nothing better (example, default,
 * enum, format), and only when the value satisfies its constraints.
 */
const NAME_EXAMPLES = [
  [/^e?mail$|email/, { string: 'jane.doe@example.com' }],
  [/phone|mobile|^tel$/, { string: '+1 555 0100' }],
  [/(^|_)(url|uri|link|website|homepage|href)$|_url$/, { string: 'https://example.com' }],
  [/avatar|image|photo|picture|thumbnail|logo/, { string: 'https://example.com/image.jpg' }],
  [/^slug$|_slug$/, { string: 'example-slug' }],
  [/uuid|guid/, { string: '9b2e4f6a-1c3d-4e5f-8a7b-2c1d0e9f8a7b' }],
  [/^first_?name$/, { string: 'Jane' }],
  [/^last_?name$|^surname$/, { string: 'Doe' }],
  [/^(full_?)?name$|display_?name|author/, { string: 'Jane Doe' }],
  [/user_?name|login|handle/, { string: 'janedoe' }],
  [/^title$|_title$|subject|headline/, { string: 'Example title' }],
  [/description|^body$|content|message|^text$|^bio$|summary|comment|^notes?$/, { string: 'Lorem ipsum dolor sit amet.' }],
  [/city|town/, { string: 'Berlin' }],
  [/country_?code|^country$/, { string: 'DE' }],
  [/currency/, { string: 'EUR' }],
  [/locale|language|^lang$/, { string: 'en' }],
  [/timezone|^tz$/, { string: 'Europe/Berlin' }],
  [/zip|postal|post_?code/, { string: '10115' }],
  [/street|address/, { string: '1 Main Street' }],
  [/token|secret|api_?key/, { string: 'your-api-token' }],
  [/password/, { string: '••••••••' }],
  [/colou?r/, { string: '#5b5bd6' }],
  [/^ip(_address)?$/, { string: '192.0.2.1' }],
  [/(_at|_time|timestamp)$/, { string: '2026-01-15T09:30:00+01:00' }],
  [/(_on|_date|^date|birthday|dob)$/, { string: '2026-01-15' }],
  [/^lat(itude)?$/, { number: 52.52, string: '52.52' }],
  [/^(lng|lon|long|longitude)$/, { number: 13.405, string: '13.405' }],
  [/price|amount|total|cost|fee|balance/, { number: 19.99, integer: 1999 }],
  [/^(per_page|page_size|limit|size)$/, { integer: 25 }],
  [/^page$|quantity|^qty$|count$/, { integer: 1 }],
  [/^year$/, { integer: 2026 }],
  [/^age$/, { integer: 30 }],
  [/rating|score/, { number: 4.5, integer: 4 }],
  [/percent|ratio/, { number: 50, integer: 50 }],
  [/radius|distance/, { number: 10, integer: 10 }],
];

function nameExample(name, type) {
  const key = String(name ?? '').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  if (!key) return null;
  for (const [pattern, values] of NAME_EXAMPLES) {
    if (pattern.test(key) && values[type] !== undefined) return values[type];
  }
  return null;
}

function fitString(value, schema) {
  if (value === null) return null;
  if (schema.maxLength !== undefined && value.length > schema.maxLength) return null;
  if (schema.minLength !== undefined && value.length < schema.minLength) return null;
  if (schema.pattern) {
    try {
      if (!new RegExp(schema.pattern, 'u').test(value)) return null;
    } catch {
      return null;
    }
  }
  return value;
}

function inRange(value, schema) {
  if (schema.minimum !== undefined && value < schema.minimum) return false;
  if (schema.maximum !== undefined && value > schema.maximum) return false;
  if (schema.exclusiveMin !== undefined && value <= schema.exclusiveMin) return false;
  if (schema.exclusiveMax !== undefined && value >= schema.exclusiveMax) return false;
  if (schema.multipleOf && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-9) return false;
  return true;
}

/**
 * A string matching a simple regular expression — enough for the patterns
 * schemas actually carry (`[A-Z]{3}`, `\d{5}`, `DE\d{2}[0-9A-Z]{18}`,
 * `(EUR|USD)`): literals, escapes, character classes, groups with
 * alternatives, and quantifiers (minimum count). Anything fancier
 * (lookarounds, backreferences) gives null and the caller falls back.
 */
function sampleFromPattern(pattern) {
  const source = String(pattern).replace(/^\^/, '').replace(/\$$/, '');
  let index = 0;
  const CLASS_SAMPLES = { d: '1', w: 'a', s: ' ', D: 'a', W: '-', S: 'a' };

  function sequence() {
    let out = '';
    while (index < source.length && source[index] !== ')' && source[index] !== '|') {
      let atom;
      const ch = source[index];
      if (ch === '(') {
        index += 1;
        if (source.startsWith('?:', index)) index += 2;
        else if (source[index] === '?') return null; // lookarounds
        const options = [];
        for (;;) {
          const option = sequence();
          if (option === null) return null;
          options.push(option);
          if (source[index] === '|') index += 1;
          else break;
        }
        if (source[index] !== ')') return null;
        index += 1;
        atom = options[0];
      } else if (ch === '[') {
        const end = source.indexOf(']', index + 2);
        if (end === -1) return null;
        const body = source.slice(index + 1, end);
        index = end + 1;
        if (body.startsWith('^')) atom = 'x';
        else if (body.startsWith('\\')) atom = CLASS_SAMPLES[body[1]] ?? body[1];
        else atom = body[0];
      } else if (ch === '\\') {
        const next = source[index + 1];
        if (/[1-9bBkpP]/.test(next ?? '')) return null;
        atom = CLASS_SAMPLES[next] ?? next;
        index += 2;
      } else if (ch === '.') {
        atom = 'a';
        index += 1;
      } else if ('*+?{'.includes(ch)) {
        return null;
      } else {
        atom = ch;
        index += 1;
      }
      // Quantifier: the minimum count (at least one for "+").
      let count = 1;
      const quantifier = /^(\{(\d+)(,\d*)?\}|[*+?])\??/.exec(source.slice(index));
      if (quantifier) {
        index += quantifier[0].length;
        if (quantifier[2] !== undefined) count = Number(quantifier[2]);
        else if (quantifier[1] === '*' || quantifier[1] === '?') count = 0;
      }
      out += atom.repeat(count);
    }
    return out;
  }

  const result = sequence();
  return result !== null && index >= source.length ? result : null;
}

/** "tags" → "tag", so array items get their element's name. */
function singular(name) {
  return String(name ?? '').replace(/ies$/, 'y').replace(/(s|es)$/, '');
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
