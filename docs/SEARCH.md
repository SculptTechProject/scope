# Search captured traffic

The desktop traffic search scans the selected session, including saved exchanges
beyond the current page. Ordinary text is a case-insensitive substring of the
method, URL, status, headers and stored bodies. Spaces stay part of that substring.
Existing literal searches keep this behavior.

Start a query with the exact, lowercase prefix `filter:` to combine conditions.
All conditions must match the same exchange. Use **Search syntax** under the
search field for clickable examples.

```text
filter: method=POST host=api.example.test status>=500
filter: body~="rate limit" status=429
filter: state=pending
filter: edited=true method!=GET
```

| Field | Operators | Meaning |
| --- | --- | --- |
| `method` | `=`, `!=` | Exact HTTP method, ignoring ASCII case. |
| `host` | `=`, `!=` | Entire hostname, ignoring case; exclude the port. IPv6 uses brackets, e.g. `host=[::1]`. |
| `status` | `=`, `!=`, `>`, `>=`, `<`, `<=` | Integer HTTP status from 100 through 599. Missing statuses match none of these operators, including `!=`. |
| `body` | `~=` | Case-insensitive substring in either plain request or plain response body. Base64-encoded bodies are excluded. |
| `state` | `=` | `pending`, `error` or `complete`, as defined below. |
| `edited` | `=` | `true` or `false`. |

`state=pending` means capture has not completed. `state=error` requires completion
and either a nonempty recorded error or HTTP status 400 or greater.
`state=complete` requires completion without either kind of error. These are
the same lifecycle distinctions used by the traffic table. A missing HTTP status
alone does not establish a failure. Imported or interrupted captures use their
persisted lifecycle state; a reopened unfinished capture is recorded as interrupted.

Host matching parses the URL and compares its hostname. It does not match a
suffix, path, query, username or port. `host=example.test` excludes
`sub.example.test` but includes `example.test:8443`. A URL without a valid host
matches neither host operator.

Put a value containing whitespace inside double quotes. Within quotes, `\"`
represents a quote and `\\` a backslash. Other escapes are invalid. `%` and `_`
are ordinary characters, not wildcards. There is no regex, OR or nested expression
syntax. A malformed structured query returns an error and the desktop clears
the results; it is never treated as an empty successful search. Error messages
do not echo query values.

To search literal text that starts with a reserved prefix, use `text:`:

```text
text:filter: method=POST
text:text:example
```

The first searches for the literal substring `filter: method=POST`; the second
searches for `text:example`. Prefixes are case-sensitive. A plain query such as
`status=500` remains a literal substring; it is not a structured condition.

## Boundaries

- Structured queries are limited to 4096 UTF-8 bytes including `filter:`, and
  32 conditions. All values must be nonempty.
- Matching happens before the result limit and offset. Equal timestamps retain
  the archive's stable newest-inserted-first order. The core limit remains
  10,000 returned rows; the desktop bridge caps a page at 1000.
- The separate **All traffic / Successful / Errors / Edited** dropdown filters
  the currently returned page. Use structured conditions for archive-wide
  filtering before pagination.
- Search still scans and deserializes archive rows; this change does not add
  an index, disk-backed bodies, streaming or a large-session performance claim.
- These conditions apply to the desktop/native `list_exchanges` query. MCP
  `search_requests` keeps its existing literal search over the sanitized view
  and its existing scan limit. It cannot probe raw credentials through these
  predicates. No MCP permission or redaction boundary changes.
- Results and queries remain local. A body search may match sensitive traffic;
  ordinary exports still require review before sharing.
