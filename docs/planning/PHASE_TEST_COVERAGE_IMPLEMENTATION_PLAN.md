# Phase 2: Test Coverage Implementation Plan

This document provides a detailed, sprint-based implementation plan for achieving 90%+ test coverage across the MemoryJS codebase. The plan addresses identified coverage gaps through systematic test implementation.

> **Note**: This is Phase 2 of the MemoryJS development roadmap. Phase 1 covered Foundation features (Sprints 1-15). Phase 2 focuses on test coverage (Sprints 1-15, task IDs use 2.x.y format).

---

## Executive Summary

**Goal**: Achieve 90%+ function and line coverage across all MemoryJS source files through comprehensive test implementation.

**Current State Analysis**:
- Overall coverage: ~65% (estimated)
- Critical gaps: CLI module (0%), validators (0%), search parsers (0%), several utils (<10%)
- Total lines requiring test coverage: ~5,500+ lines across 28+ files

**Core Testing Areas**:
- CLI module comprehensive testing (984 lines, 0% coverage)
- Search subsystem gaps (QueryParser, ProximitySearch, QueryLogger)
- Utility module critical coverage (validators, cache, schedulers)
- Core module enhancements (ManagerContext, SearchManager)
- Type system validation (type guards, builders)

**Estimated Sprints**: 15 sprints (4-5 tasks each)
**Total New Tests**: ~1,000 test cases
**Dependencies**: Existing test infrastructure (Vitest, coverage tooling)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Test Coverage Implementation                      │
├─────────────────────────────────────────────────────────────────────────┤
│  Sprint 1-2:   CLI Module Tests (config, formatters, interactive)        │
│  Sprint 3-4:   Search Module Gaps (QueryParser, ProximitySearch)         │
│  Sprint 5-6:   Utils Critical (validators, compressedCache, schemas)     │
│  Sprint 7-8:   Core Module Tests (ManagerContext, taskScheduler)         │
│  Sprint 9-10:  Utils Medium Coverage (formatters, entityUtils, indexes)  │
│  Sprint 11-12: Types & Errors (type guards, error suggestions)           │
│  Sprint 13-14: Search Enhancements (EmbeddingService, FuzzySearch)       │
│  Sprint 15:    Integration & Cleanup (monitors, caches)                  │
├─────────────────────────────────────────────────────────────────────────┤
│                    Existing Test Infrastructure                          │
│  Vitest | V8 Coverage | Unit Tests | Integration Tests | Benchmarks     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Current Coverage Analysis

### Critical Priority (0% Coverage)

| File | Lines | Current | Target | Gap |
|------|-------|---------|--------|-----|
| src/cli/config.ts | 93 | 0% | 90% | +90% |
| src/cli/formatters.ts | 229 | 0% | 90% | +90% |
| src/cli/interactive.ts | 212 | 0% | 90% | +90% |
| src/cli/options.ts | 51 | 0% | 90% | +90% |
| src/cli/commands/index.ts | 399 | 0% | 90% | +90% |
| src/search/ProximitySearch.ts | 231 | 0% | 90% | +90% |
| src/search/QueryParser.ts | 319 | 0% | 90% | +90% |
| src/search/QueryLogger.ts | 210 | 2.7% | 90% | +87.3% |
| src/utils/EntityValidator.ts | 286 | 0% | 90% | +90% |
| src/utils/SchemaValidator.ts | 336 | 0% | 90% | +90% |
| src/utils/compressedCache.ts | 484 | 0%* | 90% | +90% |
| src/utils/errorSuggestions.ts | 253 | 0% | 90% | +90% |
| src/utils/validators.ts | 348 | 0% | 90% | +90% |
| src/utils/relationHelpers.ts | 253 | 0% | 90% | +90% |
| src/utils/relationValidation.ts | 256 | 0% | 90% | +90% |
| src/types/progress.ts | 195 | 0% | 90% | +90% |
| src/types/search.ts | 290 | 0% | 90% | +90% |

> *Note: compressedCache.test.ts exists but shows 0% coverage - needs enhancement, not creation.

### High Priority (< 35% Coverage)

| File | Lines | Current | Target | Gap |
|------|-------|---------|--------|-----|
| src/core/ManagerContext.ts | 353 | 25% | 90% | +65% |
| src/search/SearchManager.ts | 592 | 33% | 90% | +57% |
| src/utils/BatchProcessor.ts | 538 | 1% | 90% | +89% |
| src/utils/MemoryMonitor.ts | 410 | 7.6% | 90% | +82.4% |
| src/utils/taskScheduler.ts | 659 | 7.6% | 90% | +82.4% |
| src/utils/formatters.ts | 196 | 28% | 90% | +62% |
| src/utils/entityUtils.ts | 819 | 32% | 90% | +58% |
| src/utils/logger.ts | 44 | 16% | 90% | +74% |
| src/utils/parallelUtils.ts | 233 | 6.5% | 90% | +83.5% |
| src/utils/schemas.ts | 601 | 33% | 90% | +57% |
| src/utils/searchCache.ts | 254 | 49% | 90% | +41% |

### Medium Priority (35-70% Coverage)

| File | Lines | Current | Target | Gap |
|------|-------|---------|--------|-----|
| src/search/EmbeddingService.ts | 649 | 60% | 90% | +30% |
| src/search/FuzzySearch.ts | 420 | 71% | 90% | +19% |
| src/utils/compressionUtil.ts | 345 | 43% | 90% | +47% |
| src/utils/indexes.ts | 588 | 58% | 90% | +32% |
| src/utils/searchAlgorithms.ts | 191 | 72% | 90% | +18% |

---

## Sprint Breakdown

### Phase A: CLI Module Tests (Sprints 1-2)

This phase establishes comprehensive test coverage for the CLI subsystem.

---

#### Sprint 1: CLI Core Tests

**Objective**: Test CLI configuration, options, and output formatters.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **1.1** Test config.ts file loading | Test configuration file discovery, parsing, and validation. Test `.memoryjsrc`, `.memoryjsrc.json`, and `memoryjs.config.json` formats. | `tests/unit/cli/config.test.ts` | 90%+ coverage on config.ts |
| **1.2** Test config.ts edge cases | Test missing config files, invalid JSON, parent directory search, and config merging with CLI args. | `tests/unit/cli/config.test.ts` | All error paths tested |
| **1.3** Test options.ts parsing | Test global options parsing, validation, and defaults. Test `--storage`, `--format`, `--quiet`, `--verbose` options. | `tests/unit/cli/options.test.ts` | 90%+ coverage on options.ts |
| **1.4** Test formatters.ts JSON output | Test JSON formatting for entities, relations, and search results. Test pretty-printing and compact modes. | `tests/unit/cli/formatters.test.ts` | JSON formatter fully tested |
| **1.5** Test formatters.ts table/CSV output | Test table formatting with terminal width detection, column sizing, and word wrapping. Test CSV escaping. | `tests/unit/cli/formatters.test.ts` | Table and CSV formatters tested |

**Testing Requirements**:
- Mock file system for config file tests
- Mock process.stdout for terminal width
- Test empty/null/undefined inputs

---

#### Sprint 2: CLI Interactive & Commands Tests

**Objective**: Test interactive mode and command registration.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **2.1** Test interactive.ts REPL setup | Test readline interface creation, prompt display, and basic command loop. | `tests/unit/cli/interactive.test.ts` | REPL initialization tested |
| **2.2** Test interactive.ts command parsing | Test command parsing, argument extraction, and help display within REPL. | `tests/unit/cli/interactive.test.ts` | Command parsing tested |
| **2.3** Test interactive.ts history | Test command history navigation, persistence, and tab completion setup. | `tests/unit/cli/interactive.test.ts` | History functionality tested |
| **2.4** Test commands/index.ts registration | Test command category registration, help text generation, and subcommand routing. | `tests/unit/cli/commands.test.ts` | Command registration tested |
| **2.5** Test CLI entry point | Test main CLI entry point, version display, and global error handling. | `tests/unit/cli/index.test.ts` | Entry point fully tested |

**Testing Requirements**:
- Mock readline for interactive tests
- Test stdin/stdout piping
- Test error handling and exit codes

---

### Phase B: Search Module Gaps (Sprints 3-4)

This phase addresses critical search module coverage gaps.

---

#### Sprint 3: Query Parser & Proximity Search

**Objective**: Test query parsing and proximity search functionality.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **3.1** Test QueryParser basic parsing | Test tokenization, term extraction, and basic query structure. | `tests/unit/search/QueryParser.test.ts` | Basic parsing 90% covered |
| **3.2** Test QueryParser phrase handling | Test quoted phrase detection, phrase search generation, and escaping. | `tests/unit/search/QueryParser.test.ts` | Phrase handling tested |
| **3.3** Test QueryParser operators | Test wildcard (`*`, `?`), field-specific (`field:`), and proximity (`~N`) operators. | `tests/unit/search/QueryParser.test.ts` | All operators tested |
| **3.4** Test ProximitySearch core | Test proximity matching algorithm, word distance calculation, and scoring. | `tests/unit/search/ProximitySearch.test.ts` | Core algorithm tested |
| **3.5** Test ProximitySearch edge cases | Test empty queries, single-word queries, overlapping matches, and large documents. | `tests/unit/search/ProximitySearch.test.ts` | Edge cases covered |

**Testing Requirements**:
- Test malformed queries
- Test special characters and unicode
- Performance tests for large documents

---

#### Sprint 4: Query Logger & SearchManager

**Objective**: Complete QueryLogger tests and enhance SearchManager coverage.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **4.1** Test QueryLogger core functionality | Test log entry creation, log levels, and query ID generation. | `tests/unit/search/QueryLogger.test.ts` | Core logging tested |
| **4.2** Test QueryLogger outputs | Test console output, file output, and callback notifications. | `tests/unit/search/QueryLogger.test.ts` | All outputs tested |
| **4.3** Test QueryLogger tracing | Test stage timing, trace building, and trace event emission. | `tests/unit/search/QueryLogger.test.ts` | Tracing functionality tested |
| **4.4** Test SearchManager cache management | Test cache clearing, cache invalidation, and cache hit/miss scenarios. | `tests/unit/search/SearchManager.test.ts` | Cache management 90% covered |
| **4.5** Test SearchManager auto-search | Test automatic search method selection, cost estimation, and query analysis. | `tests/unit/search/SearchManager.test.ts` | Auto-search fully tested |

**Testing Requirements**:
- Mock file system for log file tests
- Test concurrent logging scenarios
- Test cache consistency

---

### Phase C: Utils Critical Coverage (Sprints 5-6)

This phase addresses critical utility module coverage gaps.

---

#### Sprint 5: Validators & EntityValidator

**Objective**: Test validation utilities comprehensively.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **5.1** Test validators.ts built-ins | Test `required()`, `minLength()`, `maxLength()`, `pattern()`, `range()`, `oneOf()`. | `tests/unit/utils/validators.test.ts` | All built-in validators tested |
| **5.2** Test validators.ts custom | Test custom validator creation, async validators, and validator composition. | `tests/unit/utils/validators.test.ts` | Custom validators tested |
| **5.3** Test EntityValidator rules | Test rule definition, field targeting, and severity levels. | `tests/unit/utils/EntityValidator.test.ts` | Rule system tested |
| **5.4** Test EntityValidator execution | Test validation execution, error collection, and warning vs error handling. | `tests/unit/utils/EntityValidator.test.ts` | Execution paths tested |
| **5.5** Test SchemaValidator integration | Test JSON Schema validation, schema loading, and validation error formatting. | `tests/unit/utils/SchemaValidator.test.ts` | Schema validation tested |

**Testing Requirements**:
- Test all validation error scenarios
- Test async validation timeout
- Test schema format variations

---

#### Sprint 6: CompressedCache & ErrorSuggestions

**Objective**: Test cache compression and error handling utilities.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **6.1** Test compressedCache core operations | Test set, get, delete, clear, has operations with compression enabled. | `tests/unit/utils/compressedCache.test.ts` | Core operations tested |
| **6.2** Test compressedCache compression logic | Test adaptive compression triggers, compression ratios, and size thresholds. | `tests/unit/utils/compressedCache.test.ts` | Compression logic tested |
| **6.3** Test compressedCache decompression | Test on-demand decompression, decompression errors, and cache stats. | `tests/unit/utils/compressedCache.test.ts` | Decompression tested |
| **6.4** Test errorSuggestions mapping | Test error-to-suggestion mapping, recovery step generation, and context inclusion. | `tests/unit/utils/errorSuggestions.test.ts` | Suggestion mapping tested |
| **6.5** Test errorSuggestions categories | Test suggestions for storage errors, validation errors, search errors, and config errors. | `tests/unit/utils/errorSuggestions.test.ts` | All categories tested |

**Testing Requirements**:
- Test compression with various data sizes
- Test corrupted compressed data handling
- Test all error type suggestions

---

### Phase D: Core Module Tests (Sprints 7-8)

This phase enhances core module coverage.

---

#### Sprint 7: ManagerContext Agent Memory

**Objective**: Test ManagerContext agent memory system initialization.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **7.1** Test decayEngine initialization | Test DecayEngine getter, environment variable parsing, and configuration. | `tests/unit/core/ManagerContext.test.ts` | DecayEngine init tested |
| **7.2** Test salienceEngine initialization | Test SalienceEngine getter, weight configuration, and dependency injection. | `tests/unit/core/ManagerContext.test.ts` | SalienceEngine init tested |
| **7.3** Test contextWindowManager | Test ContextWindowManager getter, token budget configuration. | `tests/unit/core/ManagerContext.test.ts` | Context window tested |
| **7.4** Test agentMemory() facade | Test AgentMemoryManager creation, optional config override, and lazy initialization. | `tests/unit/core/ManagerContext.test.ts` | Agent memory facade tested |
| **7.5** Test accessTracker wiring | Test AccessTracker initialization and wiring to EntityManager and SearchManager. | `tests/unit/core/ManagerContext.test.ts` | Access tracking tested |

**Testing Requirements**:
- Test all environment variable combinations
- Test initialization order dependencies
- Test null/undefined handling

---

#### Sprint 8: TaskScheduler & BatchProcessor

**Objective**: Test task scheduling and batch processing utilities.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **8.1** Test taskScheduler queue operations | Test task enqueue, priority sorting, and task cancellation. | `tests/unit/utils/taskScheduler.test.ts` | Queue operations tested |
| **8.2** Test taskScheduler execution | Test task execution, worker pool integration, and result handling. | `tests/unit/utils/taskScheduler.test.ts` | Execution paths tested |
| **8.3** Test taskScheduler rate limiting | Test `rateLimitedProcess()`, rate enforcement, and burst handling. | `tests/unit/utils/taskScheduler.test.ts` | Rate limiting tested |
| **8.4** Test taskScheduler utilities | Test `debounce()`, `throttle()`, and `withRetry()` functions. | `tests/unit/utils/taskScheduler.test.ts` | Utility functions tested |
| **8.5** Test BatchProcessor edge cases | Test memory pressure, very large batches, and mixed async/sync processors. | `tests/unit/utils/BatchProcessor.test.ts` | Edge cases covered |

**Testing Requirements**:
- Mock worker pool for isolation
- Test timeout scenarios
- Test concurrent task execution

---

### Phase E: Utils Medium Coverage (Sprints 9-10)

This phase improves utilities with moderate coverage.

---

#### Sprint 9: Formatters & EntityUtils

**Objective**: Enhance formatter and entity utility coverage.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **9.1** Test formatters.ts time formatting | Test timestamp formatting, duration formatting, and relative time. | `tests/unit/utils/formatters.test.ts` | Time formatting tested |
| **9.2** Test formatters.ts size formatting | Test byte size formatting, memory usage display, and precision. | `tests/unit/utils/formatters.test.ts` | Size formatting tested |
| **9.3** Test entityUtils validation | Test entity name validation, type validation, and observation validation. | `tests/unit/utils/entityUtils.test.ts` | Validation functions tested |
| **9.4** Test entityUtils transformation | Test entity normalization, merging, and comparison functions. | `tests/unit/utils/entityUtils.test.ts` | Transformations tested |
| **9.5** Test entityUtils helpers | Test importance calculation, tag manipulation, and hierarchy helpers. | `tests/unit/utils/entityUtils.test.ts` | Helper functions tested |

**Testing Requirements**:
- Test edge cases (empty strings, special chars)
- Test locale-specific formatting
- Test large entity handling

---

#### Sprint 10: Indexes & ParallelUtils

**Objective**: Complete index and parallel utility coverage.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **10.1** Test indexes.ts name index | Test name index creation, lookup, and update operations. | `tests/unit/utils/indexes.test.ts` | Name index tested |
| **10.2** Test indexes.ts type index | Test type index grouping, filtering, and update operations. | `tests/unit/utils/indexes.test.ts` | Type index tested |
| **10.3** Test indexes.ts tag index | Test tag index multi-value handling and efficient lookups. | `tests/unit/utils/indexes.test.ts` | Tag index tested |
| **10.4** Test parallelUtils chunking | Test array chunking, work distribution, and concurrency limits. | `tests/unit/utils/parallelUtils.test.ts` | Chunking tested |
| **10.5** Test parallelUtils execution | Test parallel map, parallel filter, and error aggregation. | `tests/unit/utils/parallelUtils.test.ts` | Parallel execution tested |

**Testing Requirements**:
- Test index consistency after updates
- Test parallel execution ordering
- Test error handling in parallel operations

---

### Phase F: Types & Errors (Sprints 11-12)

This phase tests type guards and error handling.

---

#### Sprint 11: Type Guards & Builders

**Objective**: Test type system runtime support.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **11.1** Test agent-memory type guards | Test `isAgentEntity()`, `isSessionEntity()`, and memory type guards. | `tests/unit/types/agent-memory.test.ts` | Type guards tested |
| **11.2** Test agent-memory builders | Test entity builders, observation builders, and session builders. | `tests/unit/types/agent-memory.test.ts` | Builders tested |
| **11.3** Test progress.ts types | Test progress callback types, ProgressInfo creation, and phase tracking. | `tests/unit/types/progress.test.ts` | Progress types tested |
| **11.4** Test search.ts QueryTrace | Test QueryTraceBuilder, stage tracking, and trace completion. | `tests/unit/types/search.test.ts` | QueryTrace tested |
| **11.5** Test search.ts SearchExplanation | Test explanation structure, signal aggregation, and score breakdown. | `tests/unit/types/search.test.ts` | Explanation types tested |

**Testing Requirements**:
- Test type narrowing correctness
- Test builder validation
- Test type compatibility

---

#### Sprint 12: Error Handling & Relations

**Objective**: Test error hierarchy and relation utilities.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **12.1** Test errors.ts hierarchy | Test MemoryJSError, ValidationError, StorageError, SearchError classes. | `tests/unit/utils/errors.test.ts` | Error hierarchy tested |
| **12.2** Test errors.ts suggestions | Test error code mapping, suggestion retrieval, and context formatting. | `tests/unit/utils/errors.test.ts` | Suggestions tested |
| **12.3** Test relationHelpers.ts core | Test relation creation helpers, type guards, and relation queries. | `tests/unit/utils/relationHelpers.test.ts` | Core helpers tested |
| **12.4** Test relationHelpers.ts traversal | Test relation path finding, bidirectional support, and filtering. | `tests/unit/utils/relationHelpers.test.ts` | Traversal helpers tested |
| **12.5** Test relationValidation.ts | Test relation validation rules, circular reference detection, and integrity checks. | `tests/unit/utils/relationValidation.test.ts` | Relation validation tested |

**Testing Requirements**:
- Test error inheritance chain
- Test all relation validation scenarios
- Test circular reference edge cases

---

### Phase G: Search Enhancements (Sprints 13-14)

This phase improves search coverage to 90%.

---

#### Sprint 13: EmbeddingService Completion

**Objective**: Complete EmbeddingService test coverage.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **13.1** Test EmbeddingService error handling | Test API failures, rate limiting, timeout scenarios, and retry logic. | `tests/unit/search/EmbeddingService.test.ts` | Error handling tested |
| **13.2** Test EmbeddingService caching | Test cache hit/miss behavior, cache invalidation, and memory management. | `tests/unit/search/EmbeddingService.test.ts` | Caching tested |
| **13.3** Test EmbeddingService batch ops | Test batch embedding efficiency, partial failure handling, and chunking. | `tests/unit/search/EmbeddingService.test.ts` | Batch operations tested |
| **13.4** Test EmbeddingService providers | Test OpenAI provider, local provider, and provider fallback logic. | `tests/unit/search/EmbeddingService.test.ts` | Provider support tested |
| **13.5** Test EmbeddingService config | Test model selection, dimension configuration, and initialization options. | `tests/unit/search/EmbeddingService.test.ts` | Configuration tested |

**Testing Requirements**:
- Mock external API calls
- Test network error scenarios
- Test various embedding dimensions

---

#### Sprint 14: FuzzySearch & Algorithms

**Objective**: Complete FuzzySearch and search algorithm coverage.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **14.1** Test FuzzySearch multi-term | Test multi-term fuzzy queries, term combination scoring. | `tests/unit/search/FuzzySearch.test.ts` | Multi-term queries tested |
| **14.2** Test FuzzySearch observations | Test observation-level matching accuracy and scoring. | `tests/unit/search/FuzzySearch.test.ts` | Observation matching tested |
| **14.3** Test FuzzySearch performance | Test cache effectiveness and large dataset performance. | `tests/unit/search/FuzzySearch.test.ts` | Performance tested |
| **14.4** Test searchAlgorithms core | Test Levenshtein distance, similarity scoring, and threshold tuning. | `tests/unit/utils/searchAlgorithms.test.ts` | Core algorithms tested |
| **14.5** Test searchAlgorithms edge cases | Test empty strings, unicode handling, and very long strings. | `tests/unit/utils/searchAlgorithms.test.ts` | Edge cases tested |

**Testing Requirements**:
- Test worker pool integration
- Test scoring consistency
- Performance benchmarks

---

### Phase H: Integration & Cleanup (Sprint 15)

This phase completes remaining coverage gaps.

---

#### Sprint 15: Final Coverage Push

**Objective**: Address remaining coverage gaps and verify 90% target.

| Task | Description | Files | Acceptance Criteria |
|------|-------------|-------|---------------------|
| **15.1** Test MemoryMonitor comprehensively | Test heap stats collection, component isolation, and threshold alerts. | `tests/unit/utils/MemoryMonitor.test.ts` | MemoryMonitor 90% covered |
| **15.2** Test searchCache completeness | Test cache policies, eviction strategies, and concurrent access. | `tests/unit/utils/searchCache.test.ts` | SearchCache 90% covered |
| **15.3** Test compressionUtil completeness | Test compression quality levels, streaming compression, and error handling. | `tests/unit/utils/compressionUtil.test.ts` | CompressionUtil 90% covered |
| **15.4** Test schemas.ts validation | Test all schema definitions, validation error formatting, and custom schemas. | `tests/unit/utils/schemas.test.ts` | Schemas 90% covered |
| **15.5** Coverage verification and cleanup | Run full coverage report, identify any remaining gaps, create follow-up issues. | N/A | Overall coverage 90%+ verified |

**Testing Requirements**:
- Run full coverage suite
- Document any exceptions
- Create issues for edge cases

---

## File Structure

New test files to be created:

```
tests/
├── unit/
│   ├── cli/
│   │   ├── config.test.ts              # Sprint 1 - Config file loading
│   │   ├── options.test.ts             # Sprint 1 - Global options
│   │   ├── formatters.test.ts          # Sprint 1 - Output formatters
│   │   ├── interactive.test.ts         # Sprint 2 - REPL mode
│   │   ├── commands.test.ts            # Sprint 2 - Command registration
│   │   └── index.test.ts               # Sprint 2 - Entry point
│   ├── search/
│   │   ├── QueryParser.test.ts         # Sprint 3 - Query parsing
│   │   └── ProximitySearch.test.ts     # Sprint 3 - Proximity search
│   ├── utils/
│   │   ├── validators.test.ts          # Sprint 5 - Validation utilities
│   │   ├── EntityValidator.test.ts     # Sprint 5 - Entity validation
│   │   ├── SchemaValidator.test.ts     # Sprint 5 - JSON Schema
│   │   ├── errorSuggestions.test.ts    # Sprint 6 - Error suggestions
│   │   ├── relationHelpers.test.ts     # Sprint 12 - Relation helpers
│   │   └── relationValidation.test.ts  # Sprint 12 - Relation validation
│   └── types/
│       ├── progress.test.ts            # Sprint 11 - Progress types
│       └── search.test.ts              # Sprint 11 - Search types
└── integration/
    └── cli/
        └── cli-integration.test.ts     # Sprint 2 - CLI integration
```

Existing test files to be enhanced:

```
tests/unit/
├── core/
│   └── ManagerContext.test.ts          # Sprint 7 - Agent memory init
├── search/
│   ├── QueryLogger.test.ts             # Sprint 4 - Query logging
│   ├── SearchManager.test.ts           # Sprint 4 - Cache & auto-search
│   ├── EmbeddingService.test.ts        # Sprint 13 - Error handling
│   └── FuzzySearch.test.ts             # Sprint 14 - Multi-term queries
└── utils/
    ├── BatchProcessor.test.ts          # Sprint 8 - Edge cases
    ├── taskScheduler.test.ts           # Sprint 8 - Rate limiting
    ├── formatters.test.ts              # Sprint 9 - Time/size formatting
    ├── entityUtils.test.ts             # Sprint 9 - Validation/transform
    ├── indexes.test.ts                 # Sprint 10 - Index operations
    ├── parallelUtils.test.ts           # Sprint 10 - Parallel execution
    ├── errors.test.ts                  # Sprint 12 - Error hierarchy
    ├── compressedCache.test.ts         # Sprint 6 - Compression logic
    ├── MemoryMonitor.test.ts           # Sprint 15 - Comprehensive tests
    ├── searchCache.test.ts             # Sprint 15 - Cache policies
    ├── compressionUtil.test.ts         # Sprint 15 - Quality levels
    └── schemas.test.ts                 # Sprint 15 - Schema validation
```

---

## Dependencies

| Dependency | Purpose | Sprint |
|------------|---------|--------|
| `memfs` (optional) | Virtual file system mocking | Sprint 1, 6 |
| Mock utilities | Testing CLI interactive features | Sprint 2 |
| Existing Vitest setup | Test runner and coverage | All |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Worker pool tests flaky | Mock worker pool, use single-threaded fallback |
| CLI tests platform-dependent | Use cross-platform path handling |
| Coverage measurement inconsistency | Verify V8 coverage settings |
| Test isolation issues | Ensure proper cleanup in afterEach |
| Large test files | Split into focused test suites |

---

## Success Metrics

- **Overall line coverage**: 90%+ for all source files
- **Overall function coverage**: 90%+ for all source files
- **Individual file minimum**: 80% for any single file
- **Test execution time**: Full suite completes in <5 minutes
- **Test reliability**: 100% pass rate on CI

---

## Environment Variables

No new environment variables required. Tests should mock all environment variable scenarios.

---

## Conclusion

This implementation plan addresses all identified coverage gaps through 15 focused sprints. Each sprint delivers testable improvements while maintaining existing functionality.

The prioritization ensures:
1. **Critical gaps first**: CLI module and validators get immediate attention
2. **High-value targets**: Core modules and search enhancements follow
3. **Systematic approach**: Each sprint has clear deliverables and acceptance criteria
4. **Measurable progress**: Coverage metrics tracked throughout

Begin with Sprint 1 to establish CLI test infrastructure, then proceed through each sprint sequentially. Regular coverage checks should verify progress toward the 90% target.
