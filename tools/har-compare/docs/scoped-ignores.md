# Operation-scoped JSON noise

Use explicit operation scopes when a JSON pointer is noisy in one endpoint but
meaningful in another:

```json
{
  "mode": "strict",
  "scopedIgnores": [
    {
      "method": "GET",
      "origin": "https://api.example.invalid",
      "path": "/health",
      "pointers": ["/timestamp"]
    }
  ]
}
```

Only `/timestamp` in paired GET responses at that exact origin/path is ignored.
The same pointer at `/billing` remains compared. All query variants and repeated
occurrences of a selected triple inherit the scope; query values stay private.
JSON pointer escaping, subtree behavior and array-index semantics remain those
of `ignoreJsonPaths`.

Each scoped pointer must actually be reached within its own paired JSON
operation or comparison fails2/IGNORE_UNUSED. A matching pointer at another
operation cannot satisfy it. Excluded operations, missing parents, type-changed
parents and unpaired-only operations do not make an ignore valid. Global and
scoped pointers may not overlap, and duplicate operation scopes or overlapping
pointers within one scope are rejected. This avoids hidden precedence/shadowing.

Limits:100 exact scopes,100 pointers per scope,1000 total scoped pointers;
non-root RFC6901 pointers up to1024codeunits and64tokens. `scopedIgnores: []` is
an explicit invalid config; omit the field when unnecessary. Existing global
`ignoreJsonPaths` remains available and applies to every paired JSON response.

`summary.ignoredNodes` includes global and scoped skips; with scoped rules,
`summary.scopedIgnoredNodes` reports the scoped subset. No status, body-availability
or authored contract check is suppressed by a JSON noise rule. Authoring a
required pointer/type contract can still fail on an ignored JSON node.
