# Archive-write responsiveness investigation

This investigates [#28](https://github.com/dalkedev/scope/issues/28) against
Scope 1.2.2. It does not change production scheduling, SQLite settings, capture
limits, response ordering, native security settings or existing test deadlines.
Six `Engine::save` calls per successful mock exchange mean 192 upserts for 32
requests. That is **not** a count of disk flushes.

## Reproduce

Use the pinned Rust 1.99.1 toolchain, Python 3.12 and the locked dependencies:

```sh
python scripts/measure-archive.py --profiles debug release --samples 3 --workers 0 2 --output-dir .runtime/archive-measurement
```

The ignored unit-test harness and all observers are compiled only with
`cfg(test)`; no diagnostic API or collector ships in the application. Normal
CI runs deterministic detector regressions, not the ignored timing workload.
The existing Build and check workflow has a manual `archive-measurement`
diagnostic choice. Dispatch it explicitly against the reviewed branch:

```sh
gh workflow run checks.yml --ref YOUR_BRANCH -f diagnostic=archive-measurement
```

Only the dedicated measurement jobs run on manual dispatch. Regular push/PR
checks keep their existing commands. Dispatch has a separate concurrency group,
contents-read permission, existing commit-pinned actions, no system-package installation
or native-security changes, and a 45-minute job limit. Each runner exports one
allowlisted numeric JSON artifact; compiler logs, archives and temporary CA keys
are excluded. The Python runner has an overall 30-minute budget, bounded builds
and child processes, and kills/reaps children on hard timeout. A failure to
establish process-tree cleanup ends further sampling.

## Workload and interpretation

Each runtime/profile combination runs three independent HTTP and three TLS
batches, each using a fresh temporary file-backed archive and client pool.
Thirty-two barrier-released logical requests use shared reqwest client clones,
HTTP/1.1, a 30-second client deadline and 60-second cooperative batch deadline.
These are logical clients, not a claim of 32 simultaneous network connections.
URLs target only loopback; three real rules rewrite the empty request, mock a
201 response, and rewrite that response. TLS uses actual CONNECT interception
and the newly generated CA. Nothing is sent to an external origin.

Client status/body, exact request-index coverage, unique exchange IDs, original
request URL/method/body/pairing header, original response status/body, all ordered
rule IDs/names/actions/stages, completion/error/provenance, session revision
increments and reopened archive evidence are checked. A batch must produce 32
rows and 192 successful save samples/revision increments, without overflow.
Independent controls corrupt rule evidence, restore/revalidate the baseline,
then delete a row; the same detector must reject both corrupted archives.

Save samples time actual serialization, connection-mutex acquisition and the
existing SQLite statement. Samples are collected **after** releasing the DB
guard, at most 256 per batch, with overflow accounting. SQL elapsed includes
SQLite internal locks, triggers, checkpoint/autocommit work and OS effects;
it does not separate fsync, storage service time or SQLite busy-handler wait.
Queue wait is NOT RUN because there is no writer queue. Summed per-save durations
may overlap between workers and must not be equated to batch wall time.
Instrumentation has overhead; this is an observed test build, not an unobserved
production benchmark.

A 10ms absolute-deadline heartbeat runs on the measured Tokio runtime. A separate
OS thread connects to a loopback echo socket served by that runtime, with finite
connect/read/write deadlines. Probes are ready before load. The report records
scheduled/start/end times, skipped timer periods, failures and exact workload
window membership; use only `in_window` samples for workload responsiveness.
Drain observations remain distinguishable. Sub-period batches can have no
in-window sample and explicitly report NOTRUN. No timing threshold gates normal
batches. A separate current-thread control intentionally blocks for 300ms and
requires both timer and network detectors to reject that interval using a 100ms
threshold. Two-worker control is NOT RUN, because another worker could progress.
Probe collectors cap at 8192 entries each; overflow invalidates results.

Setup (including CA/session/rule creation), probe drain, proxy shutdown and
archive validation are outside batch timing. Shutdown time is reported separately.
Batch timing starts before spawning/releasing clients. Cooperative timeout flags
and observed wall-budget violations are both reported; only the external parent
can bound a runtime blocked in synchronous code.

Metadata records commit/dirty state, compiler, OS/architecture, profile, runtime
worker count, build concurrency, SQLite version/compile options and actual
journal/synchronous/busy-timeout/page/cache/checkpoint settings. Logical CPU,
affinity and cgroup limits are recorded where exposed. Unknown memory/I/O quotas,
filesystem type and peak RSS are NOT RUN, not assumed unlimited. User Cargo
configuration is not inspected; clean hosted runs are the controlled profile
reference. Do not compare debug and release or differently constrained hosts as
if they were matched experiments.

## Result provenance

Hosted Linux: **NOT RUN** (awaiting reviewed dispatch).
Hosted Windows: **NOT RUN** (awaiting reviewed dispatch).
Local debug smoke: all four HTTP/TLS × current-thread/two-worker batches passed
with one sample per case, including both detector controls. This is a harness
smoke check, not comparative performance evidence. Hosted result artifacts and
exact source/run provenance will replace the pending entries before delivery.

GUI/Android, real captures, external endpoints, sustained/large-body workloads,
fsync counts, isolated storage latency and production performance: **NOT RUN**.

## Bounded writer proposal (not implemented)

Start with scheduling isolation, not transaction batching: one blocking writer
owns the SQLite connection, retains existing WAL/synchronous/busy settings and
executes each accepted save exactly once in order. An acknowledged command is a
persistence barrier, including saves before breakpoint inspection and the final
save before returning a successful response. Read operations requiring the
latest evidence must wait for their preceding barrier; rule snapshots remain
atomic per request. Preserve revision-trigger counts and original snapshots.

A candidate queue has eight command slots, at most one outstanding command per
exchange, and a 128MiB byte budget covering queued **and active** serialized
payloads. Acquire capacity before constructing another snapshot buffer. A full
queue applies bounded waiting to the producer, with an explicit cancellation or
overload result; no dropped writes, successful response or unbounded task-per-save
fallback is permitted. Reserve finalization capacity before admitting a capture
so overload cannot deadlock its terminal error write. Resource reservations are
released only after acknowledgement/finalization, not when a waiting future drops.

This is a proposal, not a claim that eight slots or 128MiB is optimal. The
existing 16MiB body limit does not bound an entire JSON exchange with headers,
encoding and original snapshots. Before implementation, establish an exact
maximum encoded command size. If valid records exceed the byte budget, use a
bounded streaming/spooled representation (coordinated with #12), or reject the
design; silently reducing accepted payloads or claiming a complete memory bound
from queue length alone is unacceptable. Existing capture memory is a separate
budget and must also be measured. No production switch is justified until this
prerequisite and overload/finalization tests are satisfied.

Cancellation before enqueue creates no accepted command. After enqueue, ownership
passes to the writer; cancellation must still await/record finalization. Stop
closes admission for the affected capture generation, cancels its network work,
drains accepted writes and terminal error records, then acknowledges shutdown.
Replay ownership stays associated with its original session/generation. Never
allow a late write to target a replacement capture. Restart continues the current
interrupted-capture recovery contract; test crashes before/after final commit and
acknowledgement, including committed-but-unacknowledged commands.

On serialization/SQLite/full-disk/lock failures, propagate a specific failure to
every affected producer. Never return successful traffic without required final
evidence. Terminal persistence failure must surface as such, not be presented as
an archived error. Retain the existing finite busy timeout. Do not automatically
retry a commit with uncertain outcome. Verify rollback/autocommit state and stop
admission when storage state cannot be established.

Only after scheduling isolation is measured should a second experiment batch
independent exchanges (for example up to eight commands or 2ms). Preserve per-
exchange ordering; acknowledge every barrier only after transaction commit. No
coalescing across breakpoint/finalization barriers, missing revision increments,
or response-before-commit is allowed. Rollback fails all commands in the group.
Acceptance must include stalled/locked storage, saturation, cancelled/replayed
captures, Stop races, crash/reopen and error-finalization tests plus matched
profiles. This increment deliberately supplies measurement and design, not that
unproven production change. Issue #28 remains open.
