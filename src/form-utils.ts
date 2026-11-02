import type { Header } from './types';
export const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function validateHeaders(headers: Header[]): void {
  for (const header of headers) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header.name))
      throw new Error('Each header needs a valid name without spaces.');
    if (/[\r\n]/.test(header.value)) throw new Error('Header values cannot contain line breaks.');
  }
}
export function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Enter an absolute http:// or https:// URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  if (parsed.username || parsed.password)
    throw new Error('Move URL credentials into an authorization header.');
}
export function validateMethod(method: string): void {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(method)) throw new Error('Enter a valid HTTP method.');
}
export function validateStatus(status: string): number {
  const n = Number(status);
  if (!Number.isInteger(n) || n < 100 || n > 599)
    throw new Error('Enter an HTTP status from 100 to 599.');
  return n;
}
