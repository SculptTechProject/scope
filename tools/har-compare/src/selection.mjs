import { fail } from './config.mjs';

/** Validate selection across both captures, exposing counts rather than excluded data. */
export function selectionCoverage(baseline, candidate, config) {
  if (!config.includeOperations) return undefined;
  for (let i = 0; i < config.includeOperations.length; i++) {
    if (!baseline.matchedSelectors.has(i) && !candidate.matchedSelectors.has(i)) fail('SELECTION_UNUSED', 'An operation selector matched neither capture; check the method, origin and path.');
  }
  if (baseline.entries.length === 0) fail('SELECTION_EMPTY', 'No baseline entries were selected; comparison requires baseline coverage.');
  const counts = capture => ({ totalEntries: capture.totalEntries, selectedEntries: capture.entries.length, excludedEntries: capture.totalEntries - capture.entries.length });
  return { baseline: counts(baseline), candidate: counts(candidate) };
}
