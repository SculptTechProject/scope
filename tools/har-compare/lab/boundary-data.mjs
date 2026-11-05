/** Deliberately raw JSON bytes: JSON.stringify would erase the parser boundaries. */
export const jsonBoundaryBodies = Object.freeze({
  'duplicate-member': ['{"safe":1}', '{"safe":"SYNTHETIC_DUPLICATE_SECRET","safe":2}'],
  'escaped-duplicate': ['{"a":1}', '{"a":1,"\\u0061":2}'],
  'nested-duplicate': ['{"outer":{"a":1}}', '{"outer":{"a":1,"a":2}}'],
  'lossy-decimal': ['{"measure":1}', '{"measure":1.0000000000000001}'],
  underflow: ['{"measure":0}', '{"measure":1e-324}'],
  overflow: ['{"measure":1}', '{"measure":1e309}'],
  'safe-decimal': ['{"measure":0.1}', '{"measure":0.100}'],
  'equivalent-exponent': ['{"measure":1.00}', '{"measure":1000e-3}'],
  'changed-decimal': ['{"measure":0.1}', '{"measure":0.2}'],
  'signed-zero': ['{"measure":-0}', '{"measure":0}'],
  'separate-members': ['{"left":{"a":1},"right":{"a":2}}', '{"left":{"a":1},"right":{"a":2}}'],
  'malformed-string': ['{"safe":1}', '{"safe":"SYNTHETIC_MALFORMED_SECRET}'],
  'invalid-utf8': ['{"a":"valid"}', Buffer.from([123, 34, 97, 34, 58, 34, 255, 34, 125])],
  'single-bom': ['{"a":1}', Buffer.from('\uFEFF{"a":1}', 'utf8')],
  'double-bom': ['{"a":1}', Buffer.from('\uFEFF\uFEFF{"a":1}', 'utf8')],
});
export const scopeBoundaryScenarios = Object.freeze(['scoped', 'scoped-http-500', 'scoped-missing', 'scoped-parent']);

/** Encoded HTTP query targets; URLSearchParams would collapse invalid bytes. */
export const queryBoundaryCases = Object.freeze([
  { name: 'invalid-hex-case', before: 'q=%ff', after: 'q=%FF', equivalent: true },
  { name: 'valid-hex-case', before: 'q=%c3%a9', after: 'q=%C3%A9', equivalent: true },
  { name: 'form-space', before: 'q=a+b', after: 'q=a%20b', equivalent: true },
  { name: 'literal-percent', before: 'q=%', after: 'q=%25', equivalent: true },
  { name: 'parameter-order', before: 'q=1&z=2', after: 'z=2&q=1', equivalent: true },
  { name: 'invalid-versus-replacement', before: 'q=%FF', after: 'q=%EF%BF%BD', equivalent: false },
  { name: 'distinct-invalid-bytes', before: 'q=%FF', after: 'q=%FE', equivalent: false },
  { name: 'bom-in-name', before: '%EF%BB%BFq=1', after: 'q=1', equivalent: false },
  { name: 'bom-in-value', before: 'q=%EF%BB%BF1', after: 'q=1', equivalent: false },
  { name: 'duplicate-order', before: 'q=a&q=b', after: 'q=b&q=a', equivalent: false },
]);
