import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';

import { childOf, childrenOf, parseXml, resolveQName } from './xml.mjs';
import { xmlEnvelope, xmlFaultEnvelope } from './xml-example.mjs';

/**
 * WSDL 1.1 (+ XSD) → OpenAPI fragment. SOAP operations become ordinary
 * operations carrying an `x-soap` extension, XSD types become
 * `components.schemas` with OpenAPI `xml` metadata, and examples are full
 * SOAP envelopes. Merged into the main document, they flow through the same
 * model, renderers, search, MCP and try-it as REST operations.
 *
 * Supported: document/literal and rpc/literal SOAP 1.1 and 1.2 bindings,
 * wsdl:import, xsd:import/include (local files and http(s) URLs), sequence /
 * all / choice, element refs, groups, attributes and attribute groups,
 * complexContent extension/restriction, simpleContent, simple type
 * restrictions/lists/unions, abstract types (listed with their derived
 * types, as sent via xsi:type). Not supported: WSDL 2.0, rpc/encoded,
 * WS-Policy and WS-Security headers.
 */

const NS = {
  wsdl: 'http://schemas.xmlsoap.org/wsdl/',
  soap11: 'http://schemas.xmlsoap.org/wsdl/soap/',
  soap12: 'http://schemas.xmlsoap.org/wsdl/soap12/',
  xsd: 'http://www.w3.org/2001/XMLSchema',
};

const CONTENT_TYPES = { '1.1': 'text/xml', '1.2': 'application/soap+xml' };

export async function loadWsdl(location) {
  const loader = createLoader();
  const root = await loader.load(location, null);
  if (root.element.ns === 'http://www.w3.org/ns/wsdl') {
    throw new Error(`${location}: WSDL 2.0 is not supported (WSDL 1.1 only)`);
  }
  if (root.element.local !== 'definitions' || root.element.ns !== NS.wsdl) {
    throw new Error(`${location}: not a WSDL 1.1 document (root is <${root.element.name}>)`);
  }
  const registry = await collect(loader, root);
  return toOpenApi(registry, location);
}

// ---- Loading: documents by absolute location, imports followed once ----

function createLoader() {
  const documents = new Map();
  return {
    documents,
    async load(location, base) {
      const absolute = absoluteLocation(location, base);
      if (documents.has(absolute)) return documents.get(absolute);
      const source = /^https?:/i.test(absolute) ? await fetchText(absolute) : await readFile(absolute, 'utf8');
      const document = { location: absolute, element: parseXml(source, { filename: absolute }) };
      documents.set(absolute, document);
      return document;
    },
  };
}

function absoluteLocation(location, base) {
  if (/^https?:/i.test(location)) return location;
  if (base && /^https?:/i.test(base)) return new URL(location, base).href;
  return resolvePath(base ? dirname(base) : process.cwd(), location);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

// ---- Collecting WSDL and XSD components into one registry ----

const key = (ns, local) => `{${ns}}${local}`;

async function collect(loader, root) {
  const registry = {
    messages: new Map(),
    portTypes: new Map(),
    bindings: new Map(),
    services: [],
    elements: new Map(),
    types: new Map(), // complex and simple types
    groups: new Map(),
    attributeGroups: new Map(),
    attributes: new Map(),
    prefixes: new Map(), // namespace → preferred prefix, from the documents' own declarations
    documentation: '',
    targetNamespace: root.element.attrs.targetNamespace ?? '',
  };
  registry.documentation = documentationOf(root.element);
  const seenSchemas = new Set();

  const visitDefinitions = async (document) => {
    rememberPrefixes(registry, document.element);
    const definitions = document.element;
    const targetNamespace = definitions.attrs.targetNamespace ?? '';
    for (const imported of childrenOf(definitions, NS.wsdl, 'import')) {
      if (!imported.attrs.location) continue;
      const next = await loader.load(imported.attrs.location, document.location);
      if (next.element.ns === NS.xsd) await visitSchema(next.element, next.location, null);
      else await visitDefinitions(next);
    }
    for (const types of childrenOf(definitions, NS.wsdl, 'types')) {
      for (const schema of childrenOf(types, NS.xsd, 'schema')) await visitSchema(schema, document.location, null);
    }
    for (const message of childrenOf(definitions, NS.wsdl, 'message')) {
      registry.messages.set(key(targetNamespace, message.attrs.name), message);
    }
    for (const portType of childrenOf(definitions, NS.wsdl, 'portType')) {
      registry.portTypes.set(key(targetNamespace, portType.attrs.name), portType);
    }
    for (const binding of childrenOf(definitions, NS.wsdl, 'binding')) {
      registry.bindings.set(key(targetNamespace, binding.attrs.name), binding);
    }
    for (const service of childrenOf(definitions, NS.wsdl, 'service')) registry.services.push(service);
  };

  const visitSchema = async (schema, location, chameleonNamespace) => {
    const identity = `${location}#${schema.line}`;
    if (seenSchemas.has(identity)) return;
    seenSchemas.add(identity);
    rememberPrefixes(registry, schema);
    const targetNamespace = schema.attrs.targetNamespace ?? chameleonNamespace ?? '';
    const context = {
      targetNamespace,
      elementQualified: schema.attrs.elementFormDefault === 'qualified',
      attributeQualified: schema.attrs.attributeFormDefault === 'qualified',
    };
    for (const child of schema.children) {
      if (child.ns !== NS.xsd) continue;
      const name = child.attrs.name;
      const entry = { node: child, context };
      if (child.local === 'element' && name) registry.elements.set(key(targetNamespace, name), entry);
      else if ((child.local === 'complexType' || child.local === 'simpleType') && name) registry.types.set(key(targetNamespace, name), entry);
      else if (child.local === 'group' && name) registry.groups.set(key(targetNamespace, name), entry);
      else if (child.local === 'attributeGroup' && name) registry.attributeGroups.set(key(targetNamespace, name), entry);
      else if (child.local === 'attribute' && name) registry.attributes.set(key(targetNamespace, name), entry);
      else if ((child.local === 'import' || child.local === 'include' || child.local === 'redefine') && child.attrs.schemaLocation) {
        const next = await loader.load(child.attrs.schemaLocation, location);
        const nextSchema = next.element.ns === NS.xsd && next.element.local === 'schema' ? next.element : null;
        if (!nextSchema) throw new Error(`${next.location}: expected an <xsd:schema>`);
        // An include without its own targetNamespace takes the includer's.
        await visitSchema(nextSchema, next.location, child.local === 'import' ? null : targetNamespace);
      }
    }
  };

  await visitDefinitions(root);
  return registry;
}

function rememberPrefixes(registry, element) {
  for (const [prefix, namespace] of element.scope) {
    if (prefix && prefix !== 'xml' && !registry.prefixes.has(namespace)) registry.prefixes.set(namespace, prefix);
  }
}

function documentationOf(element) {
  const direct = element ? childOf(element, NS.wsdl, 'documentation') : null;
  if (direct) return direct.text.trim();
  const annotation = element ? childOf(element, NS.xsd, 'annotation') : null;
  const docs = annotation ? childrenOf(annotation, NS.xsd, 'documentation') : [];
  return docs.map((doc) => doc.text.trim()).filter(Boolean).join('\n\n');
}

// ---- XSD → JSON Schema (with OpenAPI xml metadata) ----

const BUILTINS = {
  string: { type: 'string' },
  normalizedString: { type: 'string' },
  token: { type: 'string' },
  language: { type: 'string' },
  Name: { type: 'string' },
  NCName: { type: 'string' },
  ID: { type: 'string' },
  IDREF: { type: 'string' },
  QName: { type: 'string' },
  anyURI: { type: 'string', format: 'uri' },
  boolean: { type: 'boolean' },
  decimal: { type: 'number' },
  float: { type: 'number', format: 'float' },
  double: { type: 'number', format: 'double' },
  integer: { type: 'integer' },
  int: { type: 'integer', format: 'int32' },
  long: { type: 'integer', format: 'int64' },
  short: { type: 'integer', minimum: -32768, maximum: 32767 },
  byte: { type: 'integer', minimum: -128, maximum: 127 },
  nonNegativeInteger: { type: 'integer', minimum: 0 },
  positiveInteger: { type: 'integer', minimum: 1 },
  nonPositiveInteger: { type: 'integer', maximum: 0 },
  negativeInteger: { type: 'integer', maximum: -1 },
  unsignedLong: { type: 'integer', minimum: 0, format: 'int64' },
  unsignedInt: { type: 'integer', minimum: 0, format: 'int32' },
  unsignedShort: { type: 'integer', minimum: 0, maximum: 65535 },
  unsignedByte: { type: 'integer', minimum: 0, maximum: 255 },
  date: { type: 'string', format: 'date' },
  dateTime: { type: 'string', format: 'date-time' },
  time: { type: 'string', format: 'time' },
  duration: { type: 'string', format: 'duration' },
  gYear: { type: 'string', format: 'gYear', example: '2026' },
  gYearMonth: { type: 'string', format: 'gYearMonth', example: '2026-01' },
  gMonth: { type: 'string', format: 'gMonth' },
  gDay: { type: 'string', format: 'gDay' },
  gMonthDay: { type: 'string', format: 'gMonthDay' },
  base64Binary: { type: 'string', format: 'byte' },
  hexBinary: { type: 'string', format: 'hex' },
  anyType: {},
  anySimpleType: { type: 'string' },
};

function createConverter(registry) {
  const schemas = {}; // component name → JSON schema
  const names = new Map(); // type key → component name
  const derived = new Map(); // base type key → [derived type keys]

  for (const [typeKey, { node }] of registry.types) {
    const content = childOf(node, NS.xsd, 'complexContent') ?? childOf(node, NS.xsd, 'simpleContent');
    const derivation = content && (childOf(content, NS.xsd, 'extension') ?? childOf(content, NS.xsd, 'restriction'));
    const base = derivation && resolveQName(derivation, derivation.attrs.base);
    if (base) {
      const baseKey = key(base.ns, base.local);
      if (!derived.has(baseKey)) derived.set(baseKey, []);
      derived.get(baseKey).push(typeKey);
    }
  }

  const prefixOf = (namespace) => registry.prefixes.get(namespace) ?? '';

  /** Unique, readable component name for a named type ("CT_Vertrag", "Order_ns2" on clashes). */
  function componentName(typeKey) {
    if (names.has(typeKey)) return names.get(typeKey);
    const local = typeKey.slice(typeKey.indexOf('}') + 1);
    const namespace = typeKey.slice(1, typeKey.indexOf('}'));
    const taken = new Set(names.values());
    let name = local;
    if (taken.has(name)) name = `${local}_${prefixOf(namespace) || 'ns'}`;
    let counter = 2;
    while (taken.has(name)) name = `${local}_${counter++}`;
    names.set(typeKey, name);
    return name;
  }

  /** Schema reference for a type QName: built-in inline, named types as components. */
  function typeRef(ns, local) {
    if (ns === NS.xsd) return { ...(BUILTINS[local] ?? { type: 'string' }) };
    const typeKey = key(ns, local);
    const entry = registry.types.get(typeKey);
    if (!entry) return { description: `Unresolved type ${local}` };
    const name = componentName(typeKey);
    if (!(name in schemas)) {
      schemas[name] = {}; // placeholder: breaks recursion
      const converted = entry.node.local === 'simpleType' ? simpleType(entry.node, entry.context) : complexType(entry.node, entry.context);
      const description = documentationOf(entry.node);
      Object.assign(schemas[name], { title: name, ...converted }, description ? { description } : {});
      // xsi:type values are QNames; examples need the type's namespace.
      schemas[name]['x-xsd-qname'] = { ns: typeKey.slice(1, typeKey.indexOf('}')), local: typeKey.slice(typeKey.indexOf('}') + 1) };
      // Set on every type, not only abstract ones: mergeAllOf lets a type's
      // own keys win over its base's, so an explicit false/[] stops a
      // derived type from inheriting "abstract" from the type it extends.
      schemas[name]['x-xsd-abstract'] = entry.node.attrs.abstract === 'true';
      schemas[name]['x-xsd-derived'] = [];
      if (schemas[name]['x-xsd-abstract']) {
        const subtypes = (derived.get(typeKey) ?? []).filter((sub) => registry.types.get(sub)?.node.attrs.abstract !== 'true');
        schemas[name]['x-xsd-derived'] = subtypes.map((sub) => {
          const reference = typeRef(sub.slice(1, sub.indexOf('}')), sub.slice(sub.indexOf('}') + 1));
          return reference.$ref.split('/').pop();
        });
      }
    }
    return { $ref: `#/components/schemas/${name}` };
  }

  function typeOf(element, attribute) {
    const qname = resolveQName(element, element.attrs[attribute]);
    return qname ? typeRef(qname.ns, qname.local) : null;
  }

  function simpleType(node, context) {
    const restriction = childOf(node, NS.xsd, 'restriction');
    if (restriction) {
      const base = restriction.attrs.base
        ? typeOf(restriction, 'base')
        : simpleType(childOf(restriction, NS.xsd, 'simpleType') ?? { children: [] }, context);
      return applyFacets(inlineBase(base), restriction);
    }
    const list = childOf(node, NS.xsd, 'list');
    if (list) {
      const item = list.attrs.itemType ? typeOf(list, 'itemType') : simpleType(childOf(list, NS.xsd, 'simpleType'), context);
      return { type: 'array', items: item, xml: { 'x-list': true }, description: 'Whitespace-separated list' };
    }
    const union = childOf(node, NS.xsd, 'union');
    if (union) {
      const members = (union.attrs.memberTypes ?? '').split(/\s+/).filter(Boolean).map((qname) => {
        const resolved = resolveQName(union, qname);
        return typeRef(resolved.ns, resolved.local);
      });
      members.push(...childrenOf(union, NS.xsd, 'simpleType').map((member) => simpleType(member, context)));
      return members.length === 1 ? members[0] : { anyOf: members };
    }
    return { type: 'string' };
  }

  /** Facets apply to a primitive; a named simple base is copied in so they can. */
  function inlineBase(base) {
    if (!base?.$ref) return base ?? { type: 'string' };
    const name = base.$ref.split('/').pop();
    const target = schemas[name];
    if (!target || target.type === 'object' || target.properties) return base;
    const { title: _title, description: _description, 'x-xsd-derived': _derived, ...rest } = target;
    return { ...rest, 'x-xsd-base': name };
  }

  function applyFacets(base, restriction) {
    const out = { ...base };
    const enums = [];
    for (const facet of restriction.children) {
      if (facet.ns !== NS.xsd) continue;
      const value = facet.attrs.value;
      const numeric = out.type === 'integer' || out.type === 'number' ? Number(value) : value;
      switch (facet.local) {
        case 'enumeration': {
          enums.push(out.type === 'integer' || out.type === 'number' ? Number(value) : value);
          const doc = documentationOf(facet);
          if (doc) (out['x-enum-descriptions'] ??= {})[value] = doc;
          break;
        }
        case 'pattern': out.pattern = out.pattern ? `(?=${out.pattern})${value}` : value; break;
        case 'length': out.minLength = Number(value); out.maxLength = Number(value); break;
        case 'minLength': out.minLength = Number(value); break;
        case 'maxLength': out.maxLength = Number(value); break;
        case 'minInclusive': out.minimum = numeric; break;
        case 'maxInclusive': out.maximum = numeric; break;
        case 'minExclusive': out.exclusiveMinimum = numeric; break;
        case 'maxExclusive': out.exclusiveMaximum = numeric; break;
        case 'totalDigits': out['x-total-digits'] = Number(value); break;
        case 'fractionDigits': out['x-fraction-digits'] = Number(value); break;
        default: break;
      }
    }
    if (enums.length) out.enum = enums;
    return out;
  }

  /** A complex type's content: properties (elements and attributes), allOf for extensions. */
  function complexType(node, context) {
    const simpleContent = childOf(node, NS.xsd, 'simpleContent');
    if (simpleContent) {
      const derivation = childOf(simpleContent, NS.xsd, 'extension') ?? childOf(simpleContent, NS.xsd, 'restriction');
      const base = derivation?.attrs.base ? typeOf(derivation, 'base') : { type: 'string' };
      const value = derivation?.local === 'restriction' ? applyFacets(inlineBase(base), derivation) : base;
      const object = { type: 'object', properties: {}, required: [] };
      // The element's text content, next to its attributes.
      object.properties.value = { ...value, description: 'Text content of the element', xml: { 'x-text': true } };
      object.required.push('value');
      addAttributes(object, derivation ?? node, context);
      return finish(object);
    }
    const complexContent = childOf(node, NS.xsd, 'complexContent');
    if (complexContent) {
      const extension = childOf(complexContent, NS.xsd, 'extension');
      const restriction = childOf(complexContent, NS.xsd, 'restriction');
      const derivation = extension ?? restriction;
      const own = { type: 'object', properties: {}, required: [] };
      addParticles(own, derivation, context);
      addAttributes(own, derivation, context);
      if (extension) {
        const base = typeOf(extension, 'base');
        const hasOwn = Object.keys(own.properties).length || own.oneOf;
        return hasOwn ? { allOf: [base, finish(own)] } : { allOf: [base] };
      }
      return finish(own); // restriction restates the content it keeps
    }
    const object = { type: 'object', properties: {}, required: [] };
    addParticles(object, node, context);
    addAttributes(object, node, context);
    return finish(object);
  }

  function finish(object) {
    if (!object.required.length) delete object.required;
    if (!Object.keys(object.properties).length && !object.oneOf) delete object.properties;
    return object;
  }

  function addParticles(object, parent, context) {
    for (const particle of parent.children) {
      if (particle.ns !== NS.xsd) continue;
      if (particle.local === 'sequence' || particle.local === 'all') {
        const optional = particle.attrs.minOccurs === '0';
        const repeated = particle.attrs.maxOccurs && particle.attrs.maxOccurs !== '1';
        const before = new Set(Object.keys(object.properties));
        addParticles(object, particle, context);
        if (optional || repeated) {
          // An optional/repeated group makes its members optional as a whole.
          object.required = object.required.filter((name) => before.has(name));
        }
      } else if (particle.local === 'choice') {
        const branches = particle.children
          .filter((branch) => branch.ns === NS.xsd && branch.local !== 'annotation')
          .map((branch) => {
            const variant = { type: 'object', properties: {}, required: [] };
            addParticles(variant, { children: [branch] }, context);
            const names = Object.keys(variant.properties);
            return { ...finish(variant), title: names.join(' + ') || 'Empty' };
          });
        if (branches.length) {
          if (object.oneOf) object.allOf = [...(object.allOf ?? []), { oneOf: branches }];
          else object.oneOf = branches;
          if (particle.attrs.minOccurs === '0') object['x-choice-optional'] = true;
        }
      } else if (particle.local === 'group' && particle.attrs.ref) {
        const qname = resolveQName(particle, particle.attrs.ref);
        const group = registry.groups.get(key(qname.ns, qname.local));
        if (group) addParticles(object, group.node, group.context);
      } else if (particle.local === 'element') {
        const [name, schema, required] = elementProperty(particle, context);
        if (name) {
          object.properties[name] = schema;
          if (required) object.required.push(name);
        }
      } else if (particle.local === 'any') {
        object.additionalProperties = true;
        object['x-xsd-any'] = true;
      }
    }
  }

  /** A local or referenced element → [property name, schema, required]. */
  function elementProperty(node, context) {
    let source = node;
    let sourceContext = context;
    let namespace = context.elementQualified || node.attrs.form === 'qualified' ? context.targetNamespace : '';
    if (node.attrs.ref) {
      const qname = resolveQName(node, node.attrs.ref);
      const global = registry.elements.get(key(qname.ns, qname.local));
      if (!global) return [qname.local, { description: `Unresolved element ${qname.local}` }, false];
      source = global.node;
      sourceContext = global.context;
      namespace = global.context.targetNamespace; // global elements are always qualified
    }
    const name = source.attrs.name;
    let schema = elementSchema(source, sourceContext);
    const description = documentationOf(node) || documentationOf(source);
    schema = { ...schema, ...(description ? { description } : {}), xml: { name, ...(namespace ? { namespace, prefix: prefixOf(namespace) } : {}) } };
    if (source.attrs.nillable === 'true') schema.nullable = true;
    if (source.attrs.default !== undefined) schema.default = source.attrs.default;
    if (source.attrs.fixed !== undefined) schema.const = source.attrs.fixed;

    const min = node.attrs.minOccurs ?? '1';
    const max = node.attrs.maxOccurs ?? '1';
    if (max !== '1' && max !== '0') {
      const { xml, description: itemDescription, ...item } = schema;
      schema = {
        type: 'array',
        items: { ...item, xml },
        xml: { ...xml, 'x-repeated': true },
        ...(itemDescription ? { description: itemDescription } : {}),
        ...(Number(min) > 0 ? { minItems: Number(min) } : {}),
        ...(max !== 'unbounded' ? { maxItems: Number(max) } : {}),
      };
    }
    return [name, schema, min !== '0'];
  }

  function elementSchema(element, context) {
    if (element.attrs.type) return typeOf(element, 'type');
    const complex = childOf(element, NS.xsd, 'complexType');
    if (complex) return complexType(complex, context);
    const simple = childOf(element, NS.xsd, 'simpleType');
    if (simple) return simpleType(simple, context);
    return {};
  }

  function addAttributes(object, parent, context) {
    for (const child of parent.children) {
      if (child.ns !== NS.xsd) continue;
      if (child.local === 'attributeGroup' && child.attrs.ref) {
        const qname = resolveQName(child, child.attrs.ref);
        const group = registry.attributeGroups.get(key(qname.ns, qname.local));
        if (group) addAttributes(object, group.node, group.context);
      } else if (child.local === 'attribute') {
        let source = child;
        let qualified = context.attributeQualified || child.attrs.form === 'qualified';
        let namespace = context.targetNamespace;
        if (child.attrs.ref) {
          const qname = resolveQName(child, child.attrs.ref);
          const global = registry.attributes.get(key(qname.ns, qname.local));
          source = global?.node ?? { attrs: { name: qname.local }, children: [] };
          qualified = true;
          namespace = qname.ns;
        }
        if (child.attrs.use === 'prohibited') continue;
        const name = source.attrs.name;
        let schema = source.attrs.type ? typeOf(source, 'type') : simpleType(childOf(source, NS.xsd, 'simpleType') ?? { children: [] }, context);
        const description = documentationOf(child) || documentationOf(source);
        schema = {
          ...schema,
          ...(description ? { description } : {}),
          xml: { name, attribute: true, ...(qualified && namespace ? { namespace, prefix: prefixOf(namespace) } : {}) },
        };
        if (child.attrs.default !== undefined) schema.default = child.attrs.default;
        if (child.attrs.fixed !== undefined) schema.const = child.attrs.fixed;
        object.properties[name] = schema;
        if (child.attrs.use === 'required') object.required.push(name);
      } else if (child.local === 'anyAttribute') {
        object['x-xsd-any-attribute'] = true;
      }
    }
  }

  /** A global element (message part) as a body schema, with its own xml name. */
  function globalElement(ns, local) {
    const entry = registry.elements.get(key(ns, local));
    if (!entry) throw new Error(`WSDL refers to an undefined element {${ns}}${local}`);
    const schema = elementSchema(entry.node, entry.context);
    const description = documentationOf(entry.node);
    return {
      ...schema,
      ...(description ? { description } : {}),
      xml: { name: local, namespace: ns, prefix: prefixOf(ns) },
    };
  }

  return { schemas, typeRef, globalElement, prefixOf };
}

// ---- WSDL services → OpenAPI operations ----

function toOpenApi(registry, location) {
  const converter = createConverter(registry);
  const paths = {};
  const tags = [];
  const operationIds = new Set();

  for (const service of registry.services) {
    const serviceName = service.attrs.name;
    const ports = childrenOf(service, NS.wsdl, 'port')
      .map((port) => soapPort(registry, port))
      .filter(Boolean);
    if (ports.length === 0) continue;

    // One page per operation, even when SOAP 1.1 and 1.2 ports expose the
    // same portType: the 1.1 port leads (widest client support), the others
    // are listed as alternatives.
    ports.sort((a, b) => a.version.localeCompare(b.version));
    const byOperation = new Map();
    for (const port of ports) {
      for (const operation of port.operations) {
        if (!byOperation.has(operation.name)) byOperation.set(operation.name, []);
        byOperation.get(operation.name).push({ port, operation });
      }
    }

    const tagName = `SOAP · ${serviceName}`;
    tags.push({
      name: tagName,
      'x-displayName': serviceName,
      description: serviceDescription(registry, service, ports),
    });

    for (const [operationName, variants] of byOperation) {
      const { port, operation } = variants[0];
      let operationId = `${serviceName}.${operationName}`;
      while (operationIds.has(operationId)) operationId += '_';
      operationIds.add(operationId);

      const contentType = CONTENT_TYPES[port.version];
      const input = bodySchema(registry, converter, operation, 'input', port);
      const output = bodySchema(registry, converter, operation, 'output', port);
      const exampleSpec = { components: { schemas: converter.schemas } };
      const requestExample = xmlEnvelope(exampleSpec, input, port.version, converter.prefixOf, 'request');
      const responseExample = output ? xmlEnvelope(exampleSpec, output, port.version, converter.prefixOf, 'response') : null;
      const faults = operation.faults.map((fault) => ({ name: fault.name, schema: faultSchema(registry, converter, fault) }));

      const responses = {
        200: {
          description: output ? `\`${output.xml?.name ?? operationName}\` response` : 'Empty response (one-way operation)',
          ...(output
            ? { content: { [contentType]: { schema: output, example: responseExample } } }
            : {}),
        },
        500: {
          description: faults.length
            ? `SOAP Fault — ${faults.map((fault) => `\`${fault.name}\``).join(', ')}`
            : 'SOAP Fault',
          content: {
            [contentType]: {
              schema: { title: 'Fault', type: 'object', description: 'Standard SOAP Fault envelope; service-specific details travel in `detail`.' },
              examples: Object.fromEntries(
                (faults.length ? faults : [{ name: 'Server', schema: null }]).map((fault) => [
                  fault.name,
                  { summary: fault.name, value: xmlFaultEnvelope(exampleSpec, fault.schema, port.version, converter.prefixOf) },
                ]),
              ),
            },
          },
        },
      };

      const soap = {
        service: serviceName,
        port: port.name,
        binding: port.bindingName,
        operation: operationName,
        version: port.version,
        style: operation.style,
        action: operation.action,
        address: port.address,
        targetNamespace: registry.targetNamespace,
        alternatives: variants.slice(1).map((variant) => ({
          port: variant.port.name,
          version: variant.port.version,
          address: variant.port.address,
          action: variant.operation.action,
        })),
      };

      paths[`/soap/${serviceName}/${operationName}`] = {
        post: {
          operationId,
          summary: operationName,
          description: operation.documentation,
          tags: [tagName],
          security: [],
          servers: port.address ? [{ url: port.address, description: `${port.name} (SOAP ${port.version})` }] : undefined,
          'x-soap': soap,
          'x-keywords': [operationName, serviceName, port.name, input.xml?.name, output?.xml?.name, 'soap', 'wsdl'].filter(Boolean),
          parameters:
            port.version === '1.1'
              ? [
                  {
                    name: 'SOAPAction',
                    in: 'header',
                    required: true,
                    description: 'Identifies the operation to SOAP 1.1 servers. (SOAP 1.2 carries it as the `action` parameter of `Content-Type`.)',
                    schema: { type: 'string', default: `"${operation.action ?? ''}"` },
                  },
                ]
              : [],
          requestBody: {
            required: true,
            description: `SOAP ${port.version} envelope, \`${operation.style}/literal\`.`,
            content: { [contentType]: { schema: input, example: requestExample } },
          },
          responses,
        },
      };
    }
  }

  if (Object.keys(paths).length === 0) {
    throw new Error(`${location}: no SOAP 1.1/1.2 bindings found (HTTP bindings are not documented)`);
  }

  return {
    title: registry.services[0]?.attrs.name ?? 'SOAP API',
    description: registry.documentation,
    paths,
    tags,
    schemas: converter.schemas,
  };
}

function soapPort(registry, port) {
  const address = childOf(port, NS.soap11, 'address') ?? childOf(port, NS.soap12, 'address');
  if (!address) return null; // HTTP GET/POST bindings
  const bindingQName = resolveQName(port, port.attrs.binding);
  const binding = registry.bindings.get(key(bindingQName.ns, bindingQName.local));
  if (!binding) throw new Error(`Port ${port.attrs.name} refers to an undefined binding ${port.attrs.binding}`);
  const soapNs = childOf(binding, NS.soap12, 'binding') ? NS.soap12 : NS.soap11;
  const soapBinding = childOf(binding, soapNs, 'binding');
  if (!soapBinding) return null;
  const portTypeQName = resolveQName(binding, binding.attrs.type);
  const portType = registry.portTypes.get(key(portTypeQName.ns, portTypeQName.local));
  if (!portType) throw new Error(`Binding ${binding.attrs.name} refers to an undefined portType ${binding.attrs.type}`);
  const defaultStyle = soapBinding.attrs.style ?? 'document';

  const operations = childrenOf(portType, NS.wsdl, 'operation').map((abstract) => {
    const bound = childrenOf(binding, NS.wsdl, 'operation').find((candidate) => candidate.attrs.name === abstract.attrs.name);
    const soapOperation = bound ? childOf(bound, soapNs, 'operation') : null;
    const messageOf = (direction) => {
      const element = childOf(abstract, NS.wsdl, direction);
      if (!element) return null;
      const qname = resolveQName(element, element.attrs.message);
      return registry.messages.get(key(qname.ns, qname.local)) ?? null;
    };
    const bodyUse = bound ? childOf(childOf(bound, NS.wsdl, 'input') ?? { children: [] }, soapNs, 'body') : null;
    if (bodyUse?.attrs.use === 'encoded') {
      throw new Error(`Operation ${abstract.attrs.name}: rpc/encoded SOAP is not supported (literal only)`);
    }
    return {
      name: abstract.attrs.name,
      documentation: documentationOf(abstract),
      action: soapOperation?.attrs.soapAction ?? '',
      style: soapOperation?.attrs.style ?? defaultStyle,
      bodyNamespace: bodyUse?.attrs.namespace ?? registry.targetNamespace,
      input: messageOf('input'),
      output: messageOf('output'),
      faults: childrenOf(abstract, NS.wsdl, 'fault').map((fault) => {
        const qname = resolveQName(fault, fault.attrs.message);
        return { name: fault.attrs.name, message: registry.messages.get(key(qname.ns, qname.local)) ?? null };
      }),
    };
  });

  return {
    name: port.attrs.name,
    bindingName: binding.attrs.name,
    version: soapNs === NS.soap12 ? '1.2' : '1.1',
    address: address.attrs.location ?? '',
    operations,
  };
}

/**
 * The SOAP Body content of one direction. document/literal: the single
 * part's element. rpc/literal: a wrapper element named after the operation
 * (or its response) holding one child per part.
 */
function bodySchema(registry, converter, operation, direction, port) {
  const message = operation[direction];
  if (!message) return null;
  const parts = childrenOf(message, NS.wsdl, 'part');
  if (operation.style === 'document') {
    const part = parts.find((candidate) => candidate.attrs.element) ?? parts[0];
    if (!part) return { type: 'object', xml: { name: operation.name } };
    if (part.attrs.element) {
      const qname = resolveQName(part, part.attrs.element);
      return converter.globalElement(qname.ns, qname.local);
    }
    const qname = resolveQName(part, part.attrs.type);
    return { ...converter.typeRef(qname.ns, qname.local), xml: { name: part.attrs.name } };
  }
  const wrapper = direction === 'input' ? operation.name : `${operation.name}Response`;
  const properties = {};
  for (const part of parts) {
    const qname = resolveQName(part, part.attrs.element ?? part.attrs.type);
    properties[part.attrs.name] = part.attrs.element
      ? converter.globalElement(qname.ns, qname.local)
      : { ...converter.typeRef(qname.ns, qname.local), xml: { name: part.attrs.name } };
  }
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    xml: { name: wrapper, namespace: operation.bodyNamespace, prefix: converter.prefixOf(operation.bodyNamespace) || 'ns' },
    'x-port': port.name,
  };
}

function faultSchema(registry, converter, fault) {
  const part = fault.message ? childrenOf(fault.message, NS.wsdl, 'part')[0] : null;
  if (!part?.attrs.element) return null;
  const qname = resolveQName(part, part.attrs.element);
  return converter.globalElement(qname.ns, qname.local);
}

function serviceDescription(registry, service, ports) {
  const docs = documentationOf(service) || registry.documentation;
  const rows = ports.map((port) => `| \`${port.name}\` | SOAP ${port.version} | \`${port.address}\` |`).join('\n');
  return [
    docs,
    `SOAP service · target namespace \`${registry.targetNamespace}\``,
    `| Port | Protocol | Endpoint |\n| --- | --- | --- |\n${rows}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Merges loaded WSDL fragments into an OpenAPI document (or a skeleton when
 * the site documents SOAP only). SOAP services get their own sidebar
 * section, after the REST tags.
 */
export function mergeSoap(spec, fragments) {
  if (fragments.length === 0) return spec;
  const merged = spec ?? {
    openapi: '3.1.0',
    info: {
      title: fragments.length === 1 ? fragments[0].title : 'SOAP services',
      version: '',
      description: fragments.map((fragment) => fragment.description).filter(Boolean).join('\n\n'),
    },
    paths: {},
  };
  merged.paths ??= {};
  merged.components ??= {};
  merged.components.schemas ??= {};
  merged.tags ??= [];
  const soapTags = [];
  for (const fragment of fragments) {
    for (const [path, item] of Object.entries(fragment.paths)) {
      if (merged.paths[path]) throw new Error(`SOAP operation path ${path} collides with an existing path`);
      merged.paths[path] = item;
    }
    for (const [name, schema] of Object.entries(fragment.schemas)) {
      // REST and SOAP may both define a "Customer": keep both, SOAP renamed.
      let target = name;
      let counter = 2;
      while (merged.components.schemas[target] && merged.components.schemas[target] !== schema) target = `${name}_soap${counter > 2 ? counter : ''}`, counter += 1;
      if (target !== name) renameSchemaRefs(fragment, name, target);
      merged.components.schemas[target] = schema;
    }
    merged.tags.push(...fragment.tags);
    soapTags.push(...fragment.tags.map((tag) => tag.name));
  }
  merged['x-atlas-soap-tags'] = soapTags;
  return merged;
}

function renameSchemaRefs(fragment, from, to) {
  const oldRef = `#/components/schemas/${from}`;
  const newRef = `#/components/schemas/${to}`;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.$ref === oldRef) node.$ref = newRef;
    for (const value of Object.values(node)) visit(value);
  };
  visit(fragment.paths);
  visit(fragment.schemas);
}
