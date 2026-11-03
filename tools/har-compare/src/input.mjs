import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import { fail, isObject, LIMITS } from './config.mjs';

const utf8 = new TextDecoder('utf-8', { fatal: true });
/** Read at most limit + 1 bytes even if a file grows after stat; reject devices/FIFOs. */
export async function readJsonFile(path, limit, label) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) fail('LIMIT', `${label} must be a regular file within its byte limit.`);
    const buffer = Buffer.alloc(limit + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const chunk = await handle.read(buffer, bytes, buffer.length - bytes, null);
      if (!chunk.bytesRead) break;
      bytes += chunk.bytesRead;
    }
    if (bytes > limit) fail('LIMIT', `${label} exceeds its byte limit.`);
    return parseJson(utf8.decode(buffer.subarray(0, bytes)), label);
  } catch (error) {
    if (error.code && ['LIMIT', 'JSON'].includes(error.code)) throw error;
    fail('INPUT', `${label} could not be read as UTF-8 JSON.`);
  } finally { await handle?.close(); }
}
function parseJson(text, label) {
  try { return JSON.parse(text); } catch { fail('JSON', `${label} contains malformed JSON.`); }
}
function validateTree(value, budget, depth = 0) {
  if (depth > LIMITS.depth || ++budget.nodes > LIMITS.nodes) fail('LIMIT', 'JSON body exceeds depth or per-capture node limit.');
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) fail('NUMBER', 'JSON body contains an unsupported non-finite or unsafe integer.');
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key.length > 1024) fail('LIMIT', 'JSON field name exceeds 1024 code units.');
      validateTree(value[key], budget, depth + 1);
    }
  }
}
function scopeEvidence(raw, index) {
  if (raw === undefined) return { entry: index };
  if (!isObject(raw)) fail('HAR', `Entry ${index}: invalid Scope extension.`);
  for (const key of ['completed', 'edited']) if (raw[key] !== undefined && typeof raw[key] !== 'boolean') fail('HAR', `Entry ${index}: invalid Scope flag.`);
  if (raw.completed === false || (raw.error !== undefined && raw.error !== null)) fail('INCOMPLETE', `Entry ${index}: incomplete or failed Scope capture.`);
  if (raw.provenance !== undefined && !['upstream', 'mock', 'blocked'].includes(raw.provenance)) fail('HAR', `Entry ${index}: invalid Scope provenance.`);
  const evidence = { entry: index };
  for (const key of ['provenance', 'edited']) if (raw[key] !== undefined) evidence[key] = raw[key];
  return evidence;
}
function body(response, method, index, budget) {
  const content = response.content;
  if (!isObject(content)) fail('BODY', `Entry ${index}: response content is unavailable.`);
  if (content.encoding !== undefined && content.encoding !== null && content.encoding !== 'base64') fail('ENCODING', `Entry ${index}: unsupported body encoding.`);
  if (content.size !== undefined && (!Number.isSafeInteger(content.size) || content.size < -1)) fail('BODY', `Entry ${index}: invalid declared content size.`);
  let decodedBytes;
  let text = content.text;
  if (text !== undefined && typeof text !== 'string') fail('BODY', `Entry ${index}: invalid response body.`);
  if (text !== undefined) {
    if (Buffer.byteLength(text) > Math.ceil(LIMITS.bodyBytes / 3) * 4) fail('LIMIT', `Entry ${index}: encoded body exceeds its byte limit.`);
    decodedBytes = Buffer.byteLength(text);
    if (content.encoding === 'base64') {
      // Buffer.from alone tolerates malformed base64. Require canonical padding/bits.
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(text)) fail('ENCODING', `Entry ${index}: malformed base64 body.`);
      const decoded = Buffer.from(text, 'base64');
      decodedBytes = decoded.length;
      if (decoded.toString('base64') !== text) fail('ENCODING', `Entry ${index}: non-canonical base64 body.`);
      try { text = utf8.decode(decoded); } catch { fail('ENCODING', `Entry ${index}: body is not valid UTF-8.`); }
    }
    if (Buffer.byteLength(text) > LIMITS.bodyBytes) fail('LIMIT', `Entry ${index}: body exceeds its decoded byte limit.`);
  }
  const noEntity = method === 'HEAD' || [204, 205, 304].includes(response.status);
  if (noEntity) {
    if (text) fail('BODY', `Entry ${index}: unexpected body for a bodyless response.`);
    return { kind: 'empty' };
  }
  if (text !== undefined && content.size !== undefined && content.size >= 0 && content.size !== decodedBytes) fail('INCOMPLETE', `Entry ${index}: declared content size differs from captured decoded bytes.`);
  if (typeof content.mimeType !== 'string') fail('BODY', `Entry ${index}: response MIME type is unavailable.`);
  const mime = content.mimeType.split(';', 1)[0].trim().toLowerCase();
  const json = /^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/u.test(mime);
  if (!json) {
    if (text === '' && content.size === 0) return { kind: 'empty' };
    fail('BODY', `Entry ${index}: only JSON or explicitly empty response bodies are supported.`);
  }
  if (text === undefined) fail('BODY', `Entry ${index}: JSON body was not captured.`);
  const value = parseJson(text, `Entry ${index} body`);
  validateTree(value, budget);
  return { kind: 'json', value };
}
export function parseHar(raw) {
  if (!isObject(raw) || !isObject(raw.log) || !Array.isArray(raw.log.entries)) fail('HAR', 'Expected a HAR object containing log.entries.');
  if (raw.log.entries.length > LIMITS.entries) fail('LIMIT', 'HAR exceeds 2000 entries.');
  const budget = { nodes: 0 };
  return raw.log.entries.map((item, offset) => {
    const index = offset + 1;
    if (!isObject(item) || !isObject(item.request) || !isObject(item.response)) fail('HAR', `Entry ${index}: missing request or response.`);
    const { request, response } = item;
    if (typeof request.method !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,32}$/u.test(request.method)) fail('HAR', `Entry ${index}: invalid method.`);
    const method = request.method.toUpperCase();
    if (typeof request.url !== 'string' || request.url.length > 4096 || /[\u0000-\u0020\u007f]/u.test(request.url)) fail('HAR', `Entry ${index}: invalid URL.`);
    let url;
    try { url = new URL(request.url); } catch { fail('HAR', `Entry ${index}: invalid URL.`); }
    if (!['http:', 'https:'].includes(url.protocol)) fail('HAR', `Entry ${index}: only HTTP(S) URLs are supported.`);
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) fail('HAR', `Entry ${index}: missing or invalid HTTP status.`);
    if (response.status < 200) fail('INCOMPLETE', `Entry ${index}: no supported final HTTP response was captured.`);
    url.searchParams.sort(); // Stable among equal keys: repeated parameter order is significant.
    const key = JSON.stringify([method, url.origin, url.pathname, url.searchParams.toString()]);
    return { key, method, origin: url.origin, path: url.pathname, hasQuery: url.search !== '', status: response.status, body: body(response, method, index, budget), evidence: scopeEvidence(item._scope, index) };
  });
}
