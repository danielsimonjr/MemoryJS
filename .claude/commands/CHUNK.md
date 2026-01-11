---
description: Split or merge large files for editing within context limits
allowed-tools: ["Bash", "Read", "Glob"]
argument-hint: "<split|merge> <file-path> [options]"
---

# Chunking for Files

Run the `chunking-for-files` tool to split large files into editable chunks, then merge them back.

## Instructions

1. Run the chunking tool with the specified command:

```bash
npx tsx tools/chunking-for-files/chunking-for-files.ts $ARGUMENTS
```

2. For split operations, chunks are created in a `<filename>_chunks/` directory.

3. After editing chunks, use merge to reconstruct the file.

## Commands

- `split <file>` - Split file into chunks
- `merge <manifest.json>` - Merge chunks back into file

## Options

- `-o, --output <dir>` - Output directory for chunks
- `-l, --level <n>` - Heading level for markdown (1-6)
- `-m, --max-lines <n>` - Max lines per chunk
- `-t, --type <type>` - File type: markdown, json, typescript
- `--dry-run` - Preview without writing

## Workflow Example

```bash
# 1. Split a large file
/CHUNK split README.md -l 2

# 2. Edit individual chunks in the _chunks/ directory

# 3. Merge back
/CHUNK merge README_chunks/manifest.json
```

## Supported File Types

- **Markdown** (.md) - Split by heading level
- **JSON** (.json) - Split by top-level keys
- **TypeScript** (.ts, .tsx, .js, .jsx) - Split by declarations
