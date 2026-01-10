# Types Module

TypeScript type definitions and interfaces for the Memory MCP Server.

## Contents

- `entity.types.ts` - Entity, Relation, KnowledgeGraph interfaces
- `search.types.ts` - Search-related types (SearchResult, SavedSearch, BooleanQueryNode)
- `analytics.types.ts` - Analytics and validation types
- `import-export.types.ts` - Import/export result types
- `tag.types.ts` - Tag-related types
- `index.ts` - Barrel export for all types

## Usage

```typescript
import { Entity, Relation, KnowledgeGraph } from './types/index.js';
```

All types are re-exported from `index.ts` for convenient importing.
