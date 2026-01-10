# Search Module

Search functionality with multiple algorithms and strategies.

## Contents

- `BasicSearch.ts` - Simple text search with filters
- `RankedSearch.ts` - TF-IDF relevance ranking
- `BooleanSearch.ts` - Boolean query parser (AND/OR/NOT)
- `FuzzySearch.ts` - Levenshtein-based fuzzy matching
- `SearchSuggestions.ts` - Trigram-based auto-complete
- `SavedSearchManager.ts` - Search persistence and execution
- `SearchManager.ts` - Orchestrator for all search types

## Search Types

1. **Basic**: Text matching with tag/importance filters
2. **Ranked**: TF-IDF scoring for relevance
3. **Boolean**: Complex queries with logical operators
4. **Fuzzy**: Typo-tolerant matching
5. **Suggestions**: Auto-complete based on trigrams
6. **Saved**: Store and reuse frequent searches
