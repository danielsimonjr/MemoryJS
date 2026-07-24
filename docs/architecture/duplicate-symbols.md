# Duplicate Symbols

**Generated**: 2026-07-24 (by tools/create-dependency-graph)

Names that are OWN-DEFINED (not merely re-exported) by >= 2 distinct files, then CLASSIFIED so the actionable subset is clear: `TRUE_DUPLICATE` (real merge targets) vs `ALIAS_DELEGATION` (a `const X = importedY` forward, excluded once <2 real bodies remain) and `ALLOWLISTED` (matches `duplicate-allowlist.json`).

> **Note:** This report groups names by OWN definition, not by call graph, then classifies each flagged name: TRUE_DUPLICATE (the actionable merge targets), ALIAS_DELEGATION (a const-alias forward to an imported symbol, not an independent body — excluded once fewer than 2 real bodies remain), and ALLOWLISTED (matches duplicate-allowlist.json: deliberately-independent local helpers/types). A flagged name may be a genuine duplicate OR a legitimately-independent local definition; a human triages TRUE_DUPLICATE entries using the defining files + public flags before merging anything.

## Summary — runtime (function/constant/class)

| Category | Count |
| --- | --: |
<<<<<<< HEAD
| **TRUE_DUPLICATE** (actionable) | 0 |
| ALIAS_DELEGATION | 0 |
| ALLOWLISTED | 1 |
| _Total flagged names_ | 1 |
=======
| **TRUE_DUPLICATE** (actionable) | 4 |
| ALIAS_DELEGATION | 0 |
| ALLOWLISTED | 1 |
| _Total flagged names_ | 5 |
>>>>>>> origin/master

## Summary — types (interface/type/enum)

| Category | Count |
| --- | --: |
<<<<<<< HEAD
| **TRUE_DUPLICATE** (actionable) | 0 |
| ALIAS_DELEGATION | 0 |
| ALLOWLISTED | 0 |
| _Total flagged names_ | 0 |
=======
| **TRUE_DUPLICATE** (actionable) | 6 |
| ALIAS_DELEGATION | 0 |
| ALLOWLISTED | 0 |
| _Total flagged names_ | 6 |
>>>>>>> origin/master

## Runtime duplicates

### TRUE_DUPLICATE — actionable merge targets

<<<<<<< HEAD
_None._
=======
| Name | Category | Defining files (public?, sub-tag) | Canonical hint |
| --- | --- | --- | --- |
| `cosineSimilarity` | function | `src/search/VectorStore.ts` (public, PLAIN)<br>`src/utils/textSimilarity.ts` (public, PLAIN) | **AMBIGUOUS** |
| `mergeConfig` | function | `src/agent/AgentMemoryConfig.ts` (public, PLAIN)<br>`src/cli/config.ts` (internal, PLAIN) | `src/agent/AgentMemoryConfig.ts` |
| `ReflectionManager` | class | `src/agent/ReflectionManager.ts` (public, PLAIN)<br>`src/search/ReflectionManager.ts` (public, PLAIN) | **AMBIGUOUS** |
| `tokenize` | function | `src/utils/searchAlgorithms.ts` (public, PLAIN)<br>`src/utils/textSimilarity.ts` (public, PLAIN) | **AMBIGUOUS** |
>>>>>>> origin/master

### ALIAS_DELEGATION — const-alias forwards (not independent bodies)

_None._

### ALLOWLISTED — accepted duplication (see duplicate-allowlist.json)

| Name | Category | Defining files (public?, sub-tag) | Canonical hint |
| --- | --- | --- | --- |
| `levenshteinDistance` | function | `src/utils/searchAlgorithms.ts` (public, PLAIN)<br>`src/workers/levenshteinWorker.ts` (public, ALLOWLISTED: Worker bundle is built standalone to dist/workers/ and loaded by file path at runtime (see tsup.config.ts); it deliberately keeps local copies rather than importing across the worker bundle boundary.) | **AMBIGUOUS** |

## Type duplicates (lower priority)

### TRUE_DUPLICATE

<<<<<<< HEAD
_None._
=======
| Name | Category | Defining files (public?, sub-tag) | Canonical hint |
| --- | --- | --- | --- |
| `BackupInfo` | interface | `src/features/BackupManager.ts` (internal, PLAIN)<br>`src/features/IOManager.ts` (public, PLAIN) | `src/features/IOManager.ts` |
| `BackupMetadata` | interface | `src/features/BackupManager.ts` (internal, PLAIN)<br>`src/features/IOManager.ts` (public, PLAIN) | `src/features/IOManager.ts` |
| `Contradiction` | interface | `src/agent/MemoryValidator.ts` (public, PLAIN)<br>`src/features/ContradictionDetector.ts` (public, PLAIN) | **AMBIGUOUS** |
| `DistillationResult` | interface | `src/agent/DistillationPipeline.ts` (public, PLAIN)<br>`src/types/reconstruction.ts` (public, PLAIN) | **AMBIGUOUS** |
| `Rule` | interface | `src/agent/ExperienceExtractor.ts` (public, PLAIN)<br>`src/agent/RuleEvaluator.ts` (internal, PLAIN) | `src/agent/ExperienceExtractor.ts` |
| `ValidationResult` | interface | `src/security/APIKeyStore.ts` (public, PLAIN)<br>`src/utils/schemas.ts` (public, PLAIN) | **AMBIGUOUS** |
>>>>>>> origin/master

### ALIAS_DELEGATION

_None._

### ALLOWLISTED

_None._

