---
description: Generate and analyze project dependency graph
allowed-tools: ["Bash", "Read", "Glob"]
argument-hint: "[--summary]"
---

# Dependency Graph Analysis

Generate a dependency graph for the memoryjs project and provide analysis.

## Instructions

1. Run the dependency graph tool:

```bash
npx tsx tools/create-dependency-graph/create-dependency-graph.ts
```

Or use the compiled executable if available:

```bash
./tools/create-dependency-graph/create-dependency-graph.exe
```

2. After generation, locate and read the output files in `docs/architecture/`:
   - `DEPENDENCY_GRAPH.md` - Human-readable dependency documentation
   - `dependency-graph.json` - Full graph data
   - `dependency-summary.compact.json` - Compact summary
   - `unused-analysis.md` - Potentially unused exports

3. Provide analysis including:
   - Total files and modules
   - Circular dependencies (if any)
   - Most connected files (hot paths)
   - Module structure overview

## Usage Examples

```bash
# Generate full dependency graph
/DEPS

# Focus on summary only
/DEPS --summary
```

## Output Files

| File | Purpose |
|------|---------|
| `DEPENDENCY_GRAPH.md` | Full dependency documentation with Mermaid diagrams |
| `dependency-graph.json` | Complete dependency data |
| `dependency-graph.yaml` | YAML format |
| `dependency-summary.compact.json` | Compact JSON for LLM context |
| `unused-analysis.md` | Potentially unused files/exports |

## Analysis Focus Areas

1. **Circular Dependencies** - Runtime vs type-only
2. **Hot Paths** - Files with most imports/exports
3. **Module Boundaries** - How code is organized
4. **Unused Code** - Files/exports that may be dead code
