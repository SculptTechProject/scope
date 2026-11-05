// Original bounded data strings inspired by context boundaries, not a sanitizer corpus.
// References: https://www.w3.org/TR/xml/#charsets and OWASP XSS prevention guidance.
export const payloads = Object.freeze([
  { name: 'script-close', key: '</script><script>globalThis.scopeLabExecuted=true</script>', pointer: '/<~1script><script>globalThis.scopeLabExecuted=true<~1script>' },
  { name: 'svg-handler', key: '<svg onload="globalThis.scopeLabExecuted=true">', pointer: '/<svg onload="globalThis.scopeLabExecuted=true">' },
  { name: 'image-handler', key: '"><img src="http://127.0.0.1:9/payload" onerror="globalThis.scopeLabExecuted=true">', pointer: '/"><img src="http:~1~1127.0.0.1:9~1payload" onerror="globalThis.scopeLabExecuted=true">' },
  { name: 'xml-element-close', key: '</failure><failure message="SYNTHETIC_XML_INJECTION">', pointer: '/<~1failure><failure message="SYNTHETIC_XML_INJECTION">' },
  { name: 'cdata-close', key: ']]><testcase name="SYNTHETIC_XML_INJECTION">', pointer: '/]]><testcase name="SYNTHETIC_XML_INJECTION">' },
  { name: 'entity-like', key: '&xxe; &amp; &#x3c;', pointer: '/&xxe; &amp; &#x3c;' },
  { name: 'xml-metacharacters', key: '" \' & < >', pointer: '/" \' & < >' },
  { name: 'xml-invalid-controls', key: 'nul:\u0000 bell:\u0007', pointer: '/nul:\u0000 bell:\u0007' },
  { name: 'lone-surrogate', key: 'lone:\ud800', pointer: '/lone:\ud800' },
  { name: 'unicode', key: '🧪 日本語 e\u0301', pointer: '/🧪 日本語 e\u0301' },
  { name: 'carriage-return', key: 'line\rbreak', pointer: '/line\rbreak' },
  { name: 'prototype-name', key: '__proto__', pointer: '/__proto__' },
]);
