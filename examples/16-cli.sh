#!/usr/bin/env bash
# 16 - Command-line tour: the `memory` binary (also `memoryjs`).
#
# Run from the repository root after building:
#   bun run build && bash examples/16-cli.sh
#
# Every command below is registered in src/cli/commands/*.ts. Global options such as
# --storage come before the command name. Set MEMORY_CLI to use an installed binary.
set -euo pipefail

MEMORY_CLI="${MEMORY_CLI:-node dist/cli/index.js}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STORE="$WORK/memory.jsonl"

memory() { $MEMORY_CLI --storage "$STORE" "$@"; }

# Entities and relations (entity create <name> -t <type> -o <obs...> --tags <tags...>)
memory entity create Alice --type person --observation "Senior engineer" --tags core backend
memory entity create Acme --type organization --observation "Customer"
memory relation create Alice works_at Acme
memory observation add Alice "Joined in 2024"
memory tag add Alice mentor
memory entity get Alice

# Search: plain, ranked (TF-IDF/BM25), boolean, and fuzzy.
memory search engineer
memory search engineer --ranked --limit 5
memory search "person AND backend" --boolean
memory search Alise --fuzzy --threshold 0.7

# Hierarchy and graph algorithms.
memory hierarchy set-parent Alice Acme
memory hierarchy roots
memory graph shortest-path Alice Acme
memory graph centrality --algo pagerank --top 5
memory graph components

# Import and export (export <file> -f <format>; import <file> -f <format> --merge <strategy>).
memory export "$WORK/graph.json" --format json
memory import "$WORK/graph.json" --format json --merge skip

# Health, diagnostics, and the tamper-evident audit trail.
memory stats
memory check
memory health
memory doctor --json
memory audit log --entity Alice --json
memory audit verify
