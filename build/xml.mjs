/**
 * Minimal namespace-aware XML parser for WSDL and XSD documents — the
 * generator reads them at build time only, so this favors clear errors over
 * leniency. Produces a tree of elements:
 *
 *   { name, prefix, local, ns, attrs: { qname: value }, children: [element],
 *     text, line, scope: Map(prefix → namespace URI) }
 *
 * `text` is the element's own concatenated character data (CDATA included,
 * entities decoded). Comments, processing instructions and the DOCTYPE are
 * skipped; DTD entity declarations are not supported.
 */

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export function parseXml(source, { filename = 'document.xml' } = {}) {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  let index = 0;
  const fail = (reason) => {
    throw new Error(`${filename}:${lineAt(index)}: ${reason}`);
  };
  // Offsets of line starts; elements get their line by binary search.
  const lineStarts = [0];
  for (let cursor = text.indexOf('\n'); cursor !== -1; cursor = text.indexOf('\n', cursor + 1)) lineStarts.push(cursor + 1);
  const lineAt = (position) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle] <= position) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };

  const rootScope = new Map([['xml', XML_NS]]);
  const stack = [];
  let root = null;

  while (index < text.length) {
    const open = text.indexOf('<', index);
    if (open === -1) {
      if (stack.length) appendText(stack.at(-1), text.slice(index));
      break;
    }
    if (open > index && stack.length) appendText(stack.at(-1), text.slice(index, open));
    index = open;

    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4);
      if (end === -1) fail('unterminated comment');
      index = end + 3;
    } else if (text.startsWith('<![CDATA[', index)) {
      const end = text.indexOf(']]>', index + 9);
      if (end === -1) fail('unterminated CDATA section');
      if (stack.length) stack.at(-1).text += text.slice(index + 9, end);
      index = end + 3;
    } else if (text.startsWith('<?', index)) {
      const end = text.indexOf('?>', index + 2);
      if (end === -1) fail('unterminated processing instruction');
      index = end + 2;
    } else if (text.startsWith('<!DOCTYPE', index)) {
      // Skip the DOCTYPE, including an internal subset in brackets.
      const bracket = text.indexOf('[', index);
      const close = text.indexOf('>', index);
      index = bracket !== -1 && bracket < close ? text.indexOf(']>', bracket) + 2 : close + 1;
      if (index <= 0) fail('unterminated DOCTYPE');
    } else if (text.startsWith('</', index)) {
      const end = text.indexOf('>', index);
      if (end === -1) fail('unterminated end tag');
      const name = text.slice(index + 2, end).trim();
      const element = stack.pop();
      if (!element || element.name !== name) fail(`unexpected </${name}>${element ? `, expected </${element.name}>` : ''}`);
      index = end + 1;
    } else {
      const element = readStartTag();
      if (stack.length) stack.at(-1).children.push(element);
      else if (root) fail('more than one root element');
      else root = element;
      if (!element.selfClosing) stack.push(element);
      delete element.selfClosing;
    }
  }
  if (stack.length) fail(`unclosed <${stack.at(-1).name}>`);
  if (!root) fail('no root element');
  return root;

  function readStartTag() {
    const start = index;
    index += 1;
    const name = readName();
    const attrs = {};
    for (;;) {
      skipSpace();
      if (text.startsWith('/>', index)) {
        index += 2;
        return makeElement(name, attrs, true, start);
      }
      if (text[index] === '>') {
        index += 1;
        return makeElement(name, attrs, false, start);
      }
      if (index >= text.length) fail(`unterminated <${name}>`);
      const attribute = readName();
      skipSpace();
      if (text[index] !== '=') fail(`attribute ${attribute} without a value`);
      index += 1;
      skipSpace();
      const quote = text[index];
      if (quote !== '"' && quote !== "'") fail(`unquoted value for ${attribute}`);
      const end = text.indexOf(quote, index + 1);
      if (end === -1) fail(`unterminated value for ${attribute}`);
      attrs[attribute] = decode(text.slice(index + 1, end));
      index = end + 1;
    }
  }

  function makeElement(name, attrs, selfClosing, start) {
    const parentScope = stack.at(-1)?.scope ?? rootScope;
    let scope = parentScope;
    for (const [attribute, value] of Object.entries(attrs)) {
      if (attribute === 'xmlns' || attribute.startsWith('xmlns:')) {
        if (scope === parentScope) scope = new Map(parentScope);
        scope.set(attribute === 'xmlns' ? '' : attribute.slice(6), value);
      }
    }
    const colon = name.indexOf(':');
    const prefix = colon === -1 ? '' : name.slice(0, colon);
    const ns = scope.get(prefix);
    if (prefix && ns === undefined) fail(`undeclared namespace prefix "${prefix}"`);
    return {
      name,
      prefix,
      local: colon === -1 ? name : name.slice(colon + 1),
      ns: ns ?? '',
      attrs,
      children: [],
      text: '',
      line: lineAt(start),
      scope,
      selfClosing,
    };
  }

  function readName() {
    const match = /^[^\s/>=]+/.exec(text.slice(index, index + 256));
    if (!match) fail('expected a name');
    index += match[0].length;
    return match[0];
  }

  function skipSpace() {
    while (/\s/.test(text[index] ?? '')) index += 1;
  }

  function appendText(element, raw) {
    element.text += decode(raw);
  }

  function decode(raw) {
    return raw.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity) => {
      if (entity[0] === '#') {
        const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return String.fromCodePoint(code);
      }
      if (entity in ENTITIES) return ENTITIES[entity];
      fail(`unknown entity &${entity};`);
      return match;
    });
  }
}

/** Resolves a QName attribute value ("tns:Order") in an element's scope → { ns, local }. */
export function resolveQName(element, qname) {
  if (!qname) return null;
  const colon = qname.indexOf(':');
  const prefix = colon === -1 ? '' : qname.slice(0, colon);
  const local = colon === -1 ? qname : qname.slice(colon + 1);
  return { ns: element.scope.get(prefix) ?? '', local };
}

/** Child elements with the given namespace and local name (`'*'` matches any local name). */
export function childrenOf(element, ns, local = '*') {
  return element.children.filter((child) => child.ns === ns && (local === '*' || child.local === local));
}

export function childOf(element, ns, local) {
  return element.children.find((child) => child.ns === ns && child.local === local) ?? null;
}
