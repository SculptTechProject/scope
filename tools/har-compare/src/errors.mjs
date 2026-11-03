/** Safe diagnostics never include captured strings, file paths or parser excerpts. */
export class AnalysisError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function fail(code, message) { throw new AnalysisError(code, message); }
