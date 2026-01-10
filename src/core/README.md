# Core Module

Core business logic and data persistence layer.

## Contents

- `GraphStorage.ts` - File I/O operations for JSONL format
- `EntityManager.ts` - Entity CRUD operations (includes hierarchy and archive)
- `RelationManager.ts` - Relation CRUD operations
- `ManagerContext.ts` - Central context holding all managers with lazy initialization
- `TransactionManager.ts` - Batch operations support

## Architecture

Uses composition pattern with dependency injection:
- GraphStorage handles all file I/O
- Specialized managers handle domain-specific operations
- ManagerContext provides direct manager access and backward-compatible convenience methods
- Exported as `KnowledgeGraphManager` alias for backward compatibility
