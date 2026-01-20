# Phase 1: Foundation Implementation Plan

This document provides a detailed, sprint-based implementation plan for the Foundation phase of MemoryJS development. This phase establishes essential developer tooling and core enhancements.

---

## Executive Summary

**Goal**: Enhance MemoryJS with essential developer tools (CLI), expanded relation capabilities, improved search features, and better developer experience.

**Core Capabilities to Implement**:
- Command-line interface for all core operations
- Relation metadata/properties support
- Search query logging, explanation, and full-text operators
- Entity validation helpers and improved error handling

**Estimated Sprints**: 10 sprints (4-5 tasks each)
**Dependencies**: Builds on existing MemoryJS infrastructure (storage backends, search, entity/relation managers)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        New Foundation Layer                              │
├─────────────────────────────────────────────────────────────────────────┤
│  Sprint 1-3:   CLI Interface (Commands, Interactive, Piping)            │
│  Sprint 4-5:   Relation Properties (Metadata, Storage Integration)       │
│  Sprint 6-8:   Search Enhancements (Logging, Explanation, Operators)     │
│  Sprint 9-10:  Developer Experience (Validation, Progress, Errors)       │
├─────────────────────────────────────────────────────────────────────────┤
│                    Existing MemoryJS Foundation                          │
│  EntityManager | RelationManager | SearchManager | GraphStorage          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Sprint Breakdown

### Phase 1A: CLI Interface (Sprints 1-3)

This phase establishes a command-line interface for MemoryJS operations.

---

#### Sprint 1: CLI Framework Foundation

**Objective**: Set up CLI infrastructure with command parsing and help system.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **1.1** Create CLI entry point | Set up main CLI entry point with `commander` for argument parsing. Add shebang for direct execution. Configure package.json bin field. | `src/cli/index.ts`, `package.json` | CLI executable via `npx memoryjs` or `memory` command |
| **1.2** Create base command structure | Define command categories: `entity`, `relation`, `search`, `import`, `export`. Each as subcommand with own help text. | `src/cli/commands/index.ts` | `memory --help` shows all command categories |
| **1.3** Implement global options | Add global options: `--storage <path>` (storage file), `--format <json|table|csv>` (output format), `--quiet` (suppress non-essential output), `--verbose` (debug output). | `src/cli/options.ts` | Global options parsed and available to all commands |
| **1.4** Create output formatters | Implement output formatters for JSON (pretty-printed), table (ASCII table), and CSV. Auto-detect terminal width for table formatting. | `src/cli/formatters.ts` | Output correctly formatted per `--format` option |
| **1.5** Add configuration file support | Support `.memoryjsrc` or `memoryjs.config.json` for default options. Merge with CLI args (CLI takes precedence). | `src/cli/config.ts` | Config file loaded and merged with CLI args |

**Testing Requirements**:
- Unit tests for argument parsing
- Unit tests for formatters
- Integration tests for config loading

---

#### Sprint 2: Entity and Relation Commands

**Objective**: Implement CRUD commands for entities and relations.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **2.1** Implement `entity create` command | Create entity from CLI: `memory entity create <name> --type <type> --obs "observation"`. Support multiple `--obs` flags. Output created entity. | `src/cli/commands/entity.ts` | Entity created with correct fields |
| **2.2** Implement `entity get/list` commands | Get single entity: `memory entity get <name>`. List entities: `memory entity list --type <type> --limit <n>`. Support filtering and pagination. | `src/cli/commands/entity.ts` | Entities retrieved and formatted correctly |
| **2.3** Implement `entity update/delete` commands | Update: `memory entity update <name> --add-obs "obs" --add-tag "tag"`. Delete: `memory entity delete <name> --force`. Confirm destructive operations. | `src/cli/commands/entity.ts` | CRUD operations complete; confirmations work |
| **2.4** Implement `relation create/list` commands | Create: `memory relation create <from> <to> --type <relType>`. List: `memory relation list --from <entity> --type <type>`. | `src/cli/commands/relation.ts` | Relations created and listed correctly |
| **2.5** Implement `relation delete` command | Delete: `memory relation delete <from> <to> <type>`. Support `--all` to delete all relations for an entity (with confirmation). | `src/cli/commands/relation.ts` | Relations deleted correctly; confirmations work |

**Testing Requirements**:
- Integration tests for each command
- Test error handling for invalid inputs
- Test confirmation prompts

---

#### Sprint 3: Search, Import/Export, and Interactive Mode

**Objective**: Complete CLI with search, I/O commands, and interactive mode.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **3.1** Implement `search` command | Basic search: `memory search <query>`. Options: `--type <search-type>` (basic/fuzzy/boolean/ranked), `--limit`, `--explain` (show scoring). | `src/cli/commands/search.ts` | Search executes correctly; results formatted |
| **3.2** Implement `import` command | Import: `memory import <file> --format <json|csv|graphml>`. Support `--merge` (update existing) vs `--replace`. Show progress for large imports. | `src/cli/commands/import.ts` | Import works for all formats; progress shown |
| **3.3** Implement `export` command | Export: `memory export <file> --format <json|csv|graphml|mermaid>`. Support `--filter` for entity type filtering. Support stdout with `-`. | `src/cli/commands/export.ts` | Export works for all formats; stdout works |
| **3.4** Implement interactive mode | Interactive REPL: `memory interactive` or `memory -i`. Readline-based with command history, tab completion for entity names, and multi-line input. | `src/cli/interactive.ts` | REPL works; history and completion functional |
| **3.5** Add pipe/stdin support | Support piping: `echo '{"name":"test"}' | memory entity create --stdin`. Read from stdin when `--stdin` flag present or data piped. | `src/cli/commands/entity.ts`, `src/cli/stdin.ts` | Piped input processed correctly |

**Testing Requirements**:
- Integration tests for search command
- Test import/export round-trip
- Test interactive mode basics
- Test piping scenarios

---

### Phase 1B: Relation Properties (Sprints 4-5)

This phase extends relations with metadata and properties support.

---

#### Sprint 4: Relation Metadata Types

**Objective**: Define types and extend Relation interface for metadata support.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **4.1** Extend `Relation` interface | Add optional `metadata?: Record<string, unknown>` field to Relation interface. Add `weight?: number` for weighted relations. Add `properties?: RelationProperties`. | `src/types/types.ts` | Relation interface extended; backward compatible |
| **4.2** Create `RelationProperties` type | Define typed properties: `weight` (number), `confidence` (0-1), `bidirectional` (boolean), `temporal` (validFrom/validUntil), `custom` (Record<string, unknown>). | `src/types/types.ts` | Properties fully typed with JSDoc |
| **4.3** Create `WeightedRelation` utility type | Type alias for relations with weight. Add type guard `isWeightedRelation()`. Create builder pattern `RelationBuilder` for fluent construction. | `src/types/types.ts` | Utility types work; builder pattern functional |
| **4.4** Add validation for relation properties | Create `validateRelationProperties()` function. Validate weight range (0-1 or custom), confidence range, temporal consistency. | `src/utils/validation.ts` | Validation catches invalid properties |
| **4.5** Update exports | Export all new types from `src/types/index.ts`. Update package exports in `package.json` if needed. | `src/types/index.ts` | Types importable from package |

**Testing Requirements**:
- Unit tests for type guards
- Unit tests for validation
- Compile-time tests for type compatibility

---

#### Sprint 5: Relation Properties Storage Integration

**Objective**: Integrate relation metadata with storage backends and CRUD operations.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **5.1** Update `GraphStorage` for relation metadata | Modify JSONL storage to persist relation metadata. Ensure backward compatibility (read relations without metadata). | `src/core/GraphStorage.ts` | Metadata persisted; old files still readable |
| **5.2** Update `SQLiteStorage` for relation metadata | Add `metadata` column (JSON) to relations table. Handle null for relations without metadata. Add index on weight for weighted queries. | `src/core/SQLiteStorage.ts` | SQLite stores metadata; migration handled |
| **5.3** Update `RelationManager` CRUD | Update `createRelation()` to accept metadata. Update `updateRelation()` to modify metadata. Add `getRelationsByWeight()` query. | `src/core/RelationManager.ts` | CRUD operations handle metadata correctly |
| **5.4** Add relation property queries | Add `getRelationsWithProperty(key, value)`. Add `getWeightedRelations(minWeight)`. Add `getBidirectionalRelations()`. | `src/core/RelationManager.ts` | Property queries work correctly |
| **5.5** Update CLI for relation metadata | Update `relation create` to accept `--weight`, `--meta key=value`. Update `relation list` to show metadata in output. | `src/cli/commands/relation.ts` | CLI supports relation metadata |

**Testing Requirements**:
- Integration tests for storage backends
- Test backward compatibility
- Test property queries

---

### Phase 1C: Search Enhancements (Sprints 6-8)

This phase improves search with logging, explanation, and new operators.

---

#### Sprint 6: Query Logging and Tracing

**Objective**: Implement search query logging for debugging and analytics.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **6.1** Create `QueryLogger` class | Implement logger with configurable output: console, file, callback. Log query text, type, duration, result count. Support log levels. | `src/search/QueryLogger.ts` | Logger captures query details |
| **6.2** Create `QueryTrace` type | Define trace structure: `queryId`, `queryText`, `queryType`, `startTime`, `endTime`, `duration`, `resultCount`, `stages[]` (per-stage timing). | `src/types/search.ts` | Trace captures full query lifecycle |
| **6.3** Integrate logger with SearchManager | Add optional `logger` to SearchManager constructor. Log at start and end of each search. Emit trace events for subscribers. | `src/search/SearchManager.ts` | Searches logged when logger enabled |
| **6.4** Add query tracing to search stages | Trace each search stage: parsing, index lookup, scoring, ranking, filtering. Record timing for each. Include in QueryTrace. | `src/search/SearchManager.ts`, `src/search/*.ts` | Stage timings captured accurately |
| **6.5** Add env configuration | Support `MEMORY_QUERY_LOGGING=true`, `MEMORY_QUERY_LOG_FILE=queries.log`, `MEMORY_QUERY_LOG_LEVEL=debug`. | `src/search/QueryLogger.ts` | Logging configurable via env |

**Testing Requirements**:
- Unit tests for logger
- Test trace accuracy
- Test log output formats

---

#### Sprint 7: Search Result Explanation

**Objective**: Add explanation feature showing why results matched and their scores.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **7.1** Create `SearchExplanation` type | Define explanation structure: `entityName`, `totalScore`, `signals[]` (name, value, contribution), `matchedTerms[]`, `boosts[]`. | `src/types/search.ts` | Explanation captures all scoring factors |
| **7.2** Implement explanation for TF-IDF search | Track term frequencies, IDF values, field boosts. Calculate per-signal contribution to final score. | `src/search/RankedSearch.ts` | TF-IDF signals explained |
| **7.3** Implement explanation for BM25 search | Track BM25 components: term frequency saturation, document length normalization, IDF. Show per-term contribution. | `src/search/BM25Search.ts` | BM25 components explained |
| **7.4** Implement explanation for hybrid search | Show semantic, lexical, and symbolic signal contributions. Show weight applied to each. Show combined scoring. | `src/search/HybridSearchManager.ts` | Hybrid signals explained |
| **7.5** Add `explain` option to search API | Add `explain?: boolean` to search options. When true, return `ExplainedSearchResult[]` with explanation attached. | `src/search/SearchManager.ts` | Explanation returned when requested |

**Testing Requirements**:
- Test explanation accuracy
- Test for each search type
- Verify score breakdown sums to total

---

#### Sprint 8: Full-Text Search Operators

**Objective**: Add phrase search, wildcards, and proximity operators.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **8.1** Implement phrase search | Support `"exact phrase"` syntax. Match consecutive terms in order. Integrate with existing search parsers. | `src/search/BooleanSearch.ts`, `src/search/QueryParser.ts` | Phrase search matches exact sequences |
| **8.2** Implement wildcard search | Support `*` (any characters) and `?` (single character). Convert to regex for matching. Optimize common patterns. | `src/search/BasicSearch.ts`, `src/search/QueryParser.ts` | Wildcards expand correctly |
| **8.3** Implement proximity search | Support `"term1 term2"~N` syntax (terms within N words). Calculate word distance. Score based on proximity. | `src/search/QueryParser.ts`, `src/search/ProximitySearch.ts` | Proximity matching works |
| **8.4** Implement field-specific search | Support `field:value` syntax. Search specific fields: `name:`, `type:`, `obs:` (observations), `tag:`. | `src/search/QueryParser.ts` | Field search targets correct fields |
| **8.5** Update search documentation | Document all operators in search guide. Add examples for each operator. Update CLAUDE.md with new capabilities. | `docs/guides/SEARCH_GUIDE.md`, `CLAUDE.md` | Documentation complete and accurate |

**Testing Requirements**:
- Test each operator type
- Test operator combinations
- Test edge cases (empty phrases, invalid patterns)

---

### Phase 1D: Developer Experience (Sprints 9-10)

This phase improves validation, progress reporting, and error handling.

---

#### Sprint 9: Entity Validation Helpers

**Objective**: Create validation utilities for entities with custom field support.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **9.1** Create `EntityValidator` class | Implement validator with configurable rules. Support required fields, type checking, custom validators. Return detailed error list. | `src/utils/EntityValidator.ts` | Validator catches invalid entities |
| **9.2** Create `ValidationRule` type | Define rule structure: `field`, `validator` (function), `message`, `severity` (error/warning). Support async validators. | `src/types/validation.ts` | Rules fully typed and flexible |
| **9.3** Implement built-in validators | Create validators: `required()`, `minLength(n)`, `maxLength(n)`, `pattern(regex)`, `range(min, max)`, `oneOf(values)`, `custom(fn)`. | `src/utils/validators.ts` | Built-in validators work correctly |
| **9.4** Add schema-based validation | Support JSON Schema validation via optional `ajv` integration. Allow defining entity schemas per type. | `src/utils/SchemaValidator.ts` | JSON Schema validation works |
| **9.5** Integrate with EntityManager | Add optional validation to `createEntity()` and `updateEntity()`. Support `validateOnWrite` config option. | `src/core/EntityManager.ts` | Validation runs on write operations |

**Testing Requirements**:
- Unit tests for each validator
- Test custom validator support
- Test schema validation

---

#### Sprint 10: Progress Callbacks and Error Improvements

**Objective**: Add progress reporting for batch operations and improve error messages.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **10.1** Create `ProgressCallback` type | Define callback signature: `(progress: ProgressInfo) => void`. ProgressInfo includes: `current`, `total`, `percentage`, `message`, `phase`. | `src/types/progress.ts` | Callback type defined |
| **10.2** Add progress to batch operations | Add `onProgress` callback to: `IOManager.import()`, `CompressionManager.compress()`, `ArchiveManager.archive()`. Call at regular intervals. | `src/features/IOManager.ts`, `src/features/CompressionManager.ts` | Progress reported during batch ops |
| **10.3** Create `MemoryJSError` class hierarchy | Create error hierarchy: `MemoryJSError` (base), `ValidationError`, `StorageError`, `SearchError`, `ConfigurationError`. Include error codes. | `src/utils/errors.ts` | Error hierarchy implemented |
| **10.4** Add recovery suggestions to errors | Each error type includes `suggestions[]` with recovery steps. Example: StorageError suggests checking file permissions, path existence. | `src/utils/errors.ts` | Errors include actionable suggestions |
| **10.5** Improve error messages throughout | Audit existing error throws. Replace generic errors with specific types. Add context (entity name, operation, etc.) to all errors. | `src/core/*.ts`, `src/search/*.ts` | Errors informative with context |

**Testing Requirements**:
- Test progress callbacks fire correctly
- Test error hierarchy
- Test error suggestions

---

## Environment Variables Summary

Add these to the environment configuration:

```bash
# CLI Configuration
MEMORYJS_STORAGE_PATH=./memory.jsonl
MEMORYJS_OUTPUT_FORMAT=json  # json, table, csv
MEMORYJS_CONFIG_FILE=.memoryjsrc

# Query Logging
MEMORY_QUERY_LOGGING=false
MEMORY_QUERY_LOG_FILE=queries.log
MEMORY_QUERY_LOG_LEVEL=info  # debug, info, warn, error

# Validation
MEMORY_VALIDATE_ON_WRITE=false
MEMORY_VALIDATION_STRICT=false
```

---

## File Structure

New files to be created:

```
src/
├── cli/
│   ├── index.ts                    # Sprint 1 - CLI entry point
│   ├── options.ts                  # Sprint 1 - Global options
│   ├── config.ts                   # Sprint 1 - Config file support
│   ├── formatters.ts               # Sprint 1 - Output formatters
│   ├── interactive.ts              # Sprint 3 - REPL mode
│   ├── stdin.ts                    # Sprint 3 - Stdin handling
│   └── commands/
│       ├── index.ts                # Sprint 1 - Command registry
│       ├── entity.ts               # Sprint 2 - Entity commands
│       ├── relation.ts             # Sprint 2 - Relation commands
│       ├── search.ts               # Sprint 3 - Search command
│       ├── import.ts               # Sprint 3 - Import command
│       └── export.ts               # Sprint 3 - Export command
├── search/
│   ├── QueryLogger.ts              # Sprint 6 - Query logging
│   ├── QueryParser.ts              # Sprint 8 - Query parsing (enhanced)
│   └── ProximitySearch.ts          # Sprint 8 - Proximity search
├── utils/
│   ├── EntityValidator.ts          # Sprint 9 - Entity validation
│   ├── SchemaValidator.ts          # Sprint 9 - JSON Schema validation
│   ├── validators.ts               # Sprint 9 - Built-in validators
│   └── errors.ts                   # Sprint 10 - Error hierarchy (enhanced)
├── types/
│   ├── search.ts                   # Sprint 6-7 - Search types (new)
│   ├── progress.ts                 # Sprint 10 - Progress types
│   └── validation.ts               # Sprint 9 - Validation types
tests/
├── unit/cli/                       # Unit tests for CLI
├── unit/search/                    # Unit tests for search enhancements
├── unit/utils/                     # Unit tests for utilities
└── integration/cli/                # CLI integration tests
docs/
└── guides/
    └── SEARCH_GUIDE.md             # Sprint 8 - Search documentation
```

---

## Dependencies

External dependencies to add:

| Package | Purpose | Sprint |
|---------|---------|--------|
| `commander` | CLI argument parsing | Sprint 1 |
| `chalk` | Terminal colors | Sprint 1 |
| `cli-table3` | ASCII table formatting | Sprint 1 |
| `readline` | Interactive mode (built-in) | Sprint 3 |
| `ajv` | JSON Schema validation (optional) | Sprint 9 |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| CLI complexity for users | Comprehensive help, examples in each command |
| Backward compatibility for relations | Metadata field optional, old relations work |
| Search performance with new operators | Optimize common patterns, lazy evaluation |
| Validation overhead | Opt-in validation, configurable strictness |

---

## Success Metrics

- **Unit test coverage**: >80% for all new code
- **Integration test coverage**: All CLI commands tested
- **Performance**:
  - CLI startup: <200ms
  - Search with explanation: <50ms additional overhead
  - Validation: <5ms per entity
- **Usability**: Clear help text, actionable error messages
- **Backward Compatibility**: 100% - no breaking changes

---

## Conclusion

This implementation plan establishes MemoryJS Foundation capabilities across 10 sprints. Each sprint delivers testable, incremental value while improving developer experience and expanding core functionality.

The phased approach ensures:
1. **CLI first**: Interactive tooling enables faster development and debugging
2. **Non-breaking enhancements**: Relation properties and search operators extend without breaking
3. **Developer focus**: Validation and error improvements reduce friction
4. **Incremental delivery**: Each sprint produces working, tested code

Begin with Sprint 1 to establish the CLI framework, then proceed sequentially through each sprint.
