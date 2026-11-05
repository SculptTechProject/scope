import { isUtf8 } from 'node:buffer';
const hex = byte => byte >= 48 && byte <= 57 ? byte - 48 : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1;

/** Form-decode to bytes, never replacement characters; malformed percent signs remain literal. */
function formBytes(text) {
  const input = Buffer.from(text, 'utf8'), bytes = [];
  for (let i = 0; i < input.length; i++) {
    if (input[i] === 37 && i + 2 < input.length && hex(input[i + 1]) >= 0 && hex(input[i + 2]) >= 0) {
      bytes.push(hex(input[++i]) * 16 + hex(input[++i]));
    } else bytes.push(input[i] === 43 ? 32 : input[i]);
  }
  return Buffer.from(bytes);
}

/** Internal only: exact query bytes participate in matching but never enter reports. */
export function queryIdentity(search) {
  const pairs = search.replace(/^\?/u, '').split('&').filter(Boolean).map((pair, ordinal) => {
    const split = pair.indexOf('='), name = formBytes(split < 0 ? pair : pair.slice(0, split)), value = formBytes(split < 0 ? '' : pair.slice(split + 1));
    let order;
    order = isUtf8(name) ? `u:${name.toString('utf8')}` : `b:${name.toString('hex')}`;
    return { name: name.toString('hex'), value: value.toString('hex'), order, ordinal };
  });
  pairs.sort((a, b) => a.order < b.order ? -1 : a.order > b.order ? 1 : a.ordinal - b.ordinal);
  return JSON.stringify(pairs.map(({ name, value }) => [name, value]));
}
