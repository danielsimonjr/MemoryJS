# Design: compressForContext() on ContextWindowManager

**Date:** 2026-04-10
**Status:** Approved, not yet implemented
**Branch:** TBD (future work)
**Related:** `tools/compress-for-context/compress-for-context.ts` (1460-line standalone tool)

## Goal

Integrate the existing CTON compress-for-context tool into ContextWindowManager as a library method, enabling token-efficient context compression with legend-based abbreviation codes.

## Approach

Approach C: Text-level core method + entity-level wrapper. Extend existing ContextWindowManager (Approach A — no new classes).

## Text-level core method

```typescript
compressForContext(
  text: string,
  options?: {
    level?: 'light' | 'medium' | 'aggressive';  // default 'medium'
  }
): CompressionResult

interface CompressionResult {
  compressed: string;
  legend: Record<string, string>;
  stats: {
    originalTokens: number;
    compressedTokens: number;
    savedTokens: number;
    savedPercent: number;
  };
}
```

Pure string compression. Finds repeated substrings via n-gram analysis, replaces with `§0`/`§1` codes when net savings > threshold, optionally applies unicode keyword abbreviations at aggressive level. Legend prepended to output.

## Entity-level wrapper

```typescript
compressEntitiesForContext(
  entities: Entity[],
  options?: {
    level?: 'light' | 'medium' | 'aggressive';
    maxTokens?: number;
  }
): CompressionResult & { entityCount: number }
```

Formats entities as `[type] name: obs1; obs2; obs3`, concatenates, passes to `compressForContext()`. Respects maxTokens budget.

## Integration with wakeUp()

`wakeUp()` accepts optional `compress` parameter:
```typescript
async wakeUp(options?: WakeUpOptions & { compress?: boolean | 'light' | 'medium' | 'aggressive' })
```

When set, L1 text is compressed before returning. Default: no compression (raw mode).

## Functions to extract from tool (~200 lines)

| Function | Lines | Purpose |
|----------|-------|---------|
| findRepeatedSubstrings | ~60 | N-gram analysis with savings calculation |
| applySubstringCompression | ~20 | Replace substrings with §-codes |
| generateAbbreviation | ~35 | Collision-free code generation |
| applyCommonPatterns | ~25 | Code keyword → unicode at aggressive level |
| COMMON_PATTERNS constant | ~47 | The abbreviation map |
| calculateStats (adapted) | ~15 | Use existing estimateStringTokens() |

## What we DON'T extract

- File I/O, CLI, batch mode, recursive scanning
- Format-specific compressors (JSON, YAML, CSV, XML, Code, Markdown)
- decompress() — compressed text consumed by LLMs, not decompressed

## Testing

- Unit: compressForContext with light/medium/aggressive levels
- Unit: repeated substrings detected and abbreviated
- Unit: legend generated correctly
- Unit: stats report accurate token savings
- Unit: compressEntitiesForContext formats and compresses entities
- Unit: wakeUp with compress option returns compressed L1
- Integration: round-trip — compress entities, verify compressed output is shorter
