# Design and support boundaries

The CLI compares two explicit HAR files offline without replaying requests or
opening a native application archive. The runtime has no npm dependencies;
optional browser and lab dependencies are separately locked.

Requests match by uppercase method, exact canonical HTTP(S) origin/path and
losslessly form-decoded query byte pairs. Query names are stably sorted while
repeated-name values retain encounter order. Repeated matching requests pair in
HAR encounter order. Request bodies do not participate in identity: reordered or
body-dependent calls need human review. Displayed operation labels omit queries.

Explicit operation selectors include every query variant and repetition. They
validate request identities across the HAR, then analyze selected responses.
Excluded responses are counted, never reported as healthy. Missing baseline
coverage and unused selectors fail analysis. Evidence retains original HAR indices.

Shape mode compares observed JSON structure, array positions and lengths; strict
mode also compares scalar values. Observations cannot infer required API fields.
Authored contracts independently assert status allowlists and required JSON
pointer/types, including fields absent from both captures. Exact subtree ignores
must be used and cannot suppress status or contract checks.

Inputs and outputs have explicit size/count/depth limits. Unsupported, malformed
or incomplete selected bodies fail closed with exit 2; completed analysis returns
0 (no configured regressions) or 1 (regression candidates). Errors omit source excerpts and
parser internals. Reports are deterministic and refuse existing output paths.

Reports omit captured scalar values, headers, cookies, query data and fragments.
Readable origin/path/pointer labels may themselves contain sensitive data;
`--labels ids` removes those labels through explicit allowlists. This minimizes
data, not identity risk. Review derived output before sharing it.

HTML renders captured labels as escaped text, uses only generated local anchors,
has no scripts or external resources, and permits its static CSS through a CSP
hash. Real-browser detector controls and runtime CSP checks are separate from
static/DOM tests. See [verification](verification.md) and [CI](ci.md).

This experiment does not establish device support, desktop packaging, complete
anonymization, inferred schema compatibility, large-session memory safety, market
demand or release readiness. Existing free features and AGPL notices remain.
