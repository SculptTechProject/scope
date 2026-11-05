import { fail } from '../src/errors.mjs';

// Comparing coefficient/power pairs avoids exponent expansion and binary-float
// arithmetic. Ordinary decimals such as 0.1 stay valid: the comparison is to
// the shortest JSON number representation, not the full binary64 fraction.
function decimalValue(token) {
  const [, sign, integer, fraction = '', exponent = '0'] = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(token);
  const power = Number(exponent);
  if (!Number.isSafeInteger(power) || Math.abs(power) > 1_000_000) fail('LIMIT', 'JSON numeric exponent exceeds its analysis limit.');
  const coefficient = (integer + fraction).replace(/^0+/u, '');
  if (!coefficient) return '0'; // Signed zero and exponent spellings are equivalent.
  const digits = coefficient.replace(/0+$/u, '');
  return `${sign}${digits}e${power - fraction.length + coefficient.length - digits.length}`;
}

function validateNumber(token) {
  if (token.length > 4096) fail('LIMIT', 'JSON numeric token exceeds its analysis limit.');
  const original = decimalValue(token);
  const number = Number(token);
  if (!Number.isFinite(number) || original !== decimalValue(JSON.stringify(number))) fail('NUMBER', 'JSON number loses decimal precision during parsing.');
}

/** Parse bounded JSON without ambiguous names or silent decimal round-trip loss.
 * The label is trusted caller text, never a filename or captured string.
 * JSON.parse is the syntax oracle; the lexical pass uses the original text,
 * so escaped duplicates are still visible after parsing creates its result.
 */
export function parseJsonSafe(text, label) {
  if (typeof text !== 'string') fail('JSON', `${label} must contain JSON text.`);
  if (text.length > 10 * 1024 * 1024) fail('LIMIT', 'JSON text exceeds its analysis limit.');
  let value;
  try { value = JSON.parse(text); } catch { fail('JSON', `${label} contains malformed JSON.`); }
  const containers = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      const start = index++;
      while (index < text.length && text[index] !== '"') {
        if (text[index] === '\\') index++;
        index++;
      }
      const object = containers.at(-1);
      if (object?.keys && object.expectKey) {
        const key = JSON.parse(text.slice(start, index + 1));
        if (object.keys.has(key)) fail('JSON', `${label} contains duplicate object names.`);
        object.keys.add(key);
        object.expectKey = false;
      }
    } else if (char === '{' || char === '[') {
      containers.push(char === '{' ? { keys: new Set(), expectKey: true } : {});
      if (containers.length > 128) fail('LIMIT', 'JSON document exceeds the 128-level envelope nesting limit.');
    } else if (char === '}' || char === ']') containers.pop();
    else if (char === ',' && containers.at(-1)?.keys) containers.at(-1).expectKey = true;
    else if (char === '-' || (char >= '0' && char <= '9')) {
      const start = index;
      while (index + 1 < text.length && /[\d.eE+-]/u.test(text[index + 1])) index++;
      validateNumber(text.slice(start, index + 1));
    }
  }
  return value;
}
