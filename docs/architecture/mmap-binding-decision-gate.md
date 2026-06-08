# mmap binding decision gate

**Status:** ⏸ Deferred — awaiting user approval of an external native dep.

> **Note (v2.5.0):** The `BufferMmapBackend` reference impl was removed during
> a dead-code pass. `FsReadMmapBackend` is now the sole production
> `IMmapBackend` implementation.

## Background

memoryjs ships one `IMmapBackend` impl without taking any external dep:

- `FsReadMmapBackend` — pins a `FileHandle` open and services range reads via
  `fileHandle.read(buffer, offset, length, position)`. Most of the practical
  mmap benefit (no full-file load, random-access, constant-memory iteration)
  without a native binding.

A **third backend** wrapping the OS-level `mmap(2)` syscall would
add:

- Zero-copy reads (kernel page cache aliased directly into the
  process's address space — no `memcpy` per range).
- True random-access at byte granularity with no syscall per
  read for cached pages.
- Lower CPU cost on iteration workloads where the bottleneck is
  copy-out, not disk I/O.

The cost: a native dep that has to be approved (we don't add deps
without explicit user input on this branch).

## Options surveyed

| Binding | License | Last published | Platforms | Notes |
|---|---|---|---|---|
| [`mmap-io`](https://www.npmjs.com/package/mmap-io) | MIT | 2020 | POSIX + Windows | Popular; ~280 weekly downloads. Maintenance has been quiet — last commit ~3y. Wraps `mmap`/`MapViewOfFile`. |
| [`node-mmap`](https://www.npmjs.com/package/node-mmap) | MIT | 2014 | POSIX only | Older. Doesn't ship Windows shim — would force a fallback on Windows. |
| **Custom node addon** | (in-tree) | n/a | macOS / Linux / Windows | Build via `node-gyp`; we'd own the maintenance + the platform matrix. Highest control, highest cost. |

## Recommendation

If user approves a native dep: **`mmap-io`**. It's the most-maintained
of the published options, has a Windows shim via `MapViewOfFile`,
and exposes a `Buffer`-compatible API that drops cleanly into
`IMmapBackend`'s contract.

A `MmapIoBackend.ts` would be ~150 LOC: open via `mmap-io.openSync`,
`mmap-io.map(fd, length, prot, flags, offset)` for the range, return
the slice. The existing `FsReadMmapBackend.test.ts` shape applies
1:1 — same interface, same expected behaviors.

If the user prefers no native deps at all: stay with
`FsReadMmapBackend`. The practical perf delta on the workloads
MemoryJS targets (random-access JSONL iteration, lazy-load over
large files) is small relative to disk I/O. The native binding is
a 10–30 % CPU improvement on iteration-heavy workloads; not
free, not transformative.

## Phase 11 disposition

- Task 82 documented (this file).
- Task 83 ships the `FsReadMmapBackend` as the default portable
  backend so callers don't have to wait for the decision.
- Task 84 wires `GraphStorage.loadGraph` to use a configurable
  backend via `MEMORY_USE_MMAP=true`, default backend is
  `FsReadMmapBackend`. A future `MmapIoBackend` plugs in via the
  same env var without touching the wiring.

## Platform matrix

`FsReadMmapBackend` relies only on Node built-ins (`fs/promises`), so the
platform matrix is whatever Node supports — Linux, macOS, and Windows all
work without any platform-specific shim. CI smoke is the existing `npm test`
run. A native `MmapIoBackend` (deferred per the decision gate above) would
require a CI matrix entry, and would land alongside the binding in a
follow-up.
