---
description: Search files using Everything (fast indexed) or fzf (fuzzy matching)
allowed-tools: ["mcp__everything-mcp__search", "mcp__everything-mcp__get_file_info", "mcp__fzf-mcp__fuzzy_search_files", "mcp__fzf-mcp__fuzzy_filter", "mcp__fzf-mcp__fuzzy_search_content"]
argument-hint: "<query> [--fzf] [--content] [--info]"
---

# File Search

Search for files using Everything (instant indexed search) or fzf (fuzzy matching).

## Default Behavior

By default, uses **Everything** for blazing-fast indexed file search across all drives.

## Arguments

| Argument | Description |
|----------|-------------|
| `<query>` | Search query (filename, pattern, or path) |
| `--fzf` | Use fzf fuzzy finder instead of Everything |
| `--content` | Search within file contents (fzf only) |
| `--info` | Get detailed file info (size, dates, attributes) |

## Usage Examples

```bash
# Fast file search with Everything
/SEARCH EntityManager.ts
/SEARCH *.test.ts
/SEARCH ext:ts search

# Search with wildcards and filters
/SEARCH "src/*.test.ts"
/SEARCH "parent:C:\users\danie\dropbox\github\memoryjs *.md"

# Fuzzy search with fzf
/SEARCH config --fzf
/SEARCH readme --fzf

# Search file contents
/SEARCH "import.*EntityManager" --content
/SEARCH "async function" --content

# Get detailed file info
/SEARCH package.json --info
```

## Everything Search Syntax

| Operator | Example | Description |
|----------|---------|-------------|
| `ext:` | `ext:ts` | Filter by extension |
| `size:` | `size:>1mb` | Filter by size |
| `dm:` | `dm:today` | Date modified |
| `parent:` | `parent:C:\src` | Search in directory |
| `*` | `*.config.*` | Wildcard |
| `"..."` | `"exact match"` | Exact phrase |
| `!` | `*.ts !test` | Exclude |
| `|` | `*.ts | *.js` | OR |

## When to Use Which

| Tool | Best For |
|------|----------|
| **Everything** | Finding files by name, extension, path, size, date |
| **fzf** | Fuzzy/approximate matching, typo-tolerant search |
| **fzf --content** | Searching inside file contents |
