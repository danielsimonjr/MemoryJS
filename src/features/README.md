# Features Module

Advanced feature implementations for the Memory MCP Server.

## Contents

- `TagManager.ts` - Tag operations and alias management
- `IOManager.ts` - Import, export, and backup operations

Note: CompressionManager and AnalyticsManager functionality merged into SearchManager (Sprint 11.1-11.2)
Note: ArchiveManager functionality merged into EntityManager (Sprint 11.3)
Note: BackupManager, ExportManager, ImportManager merged into IOManager (Sprint 11.4)

## Feature Categories

### Tags & Metadata
- Tag CRUD operations
- Tag aliases for synonyms
- Bulk tag operations
- Importance levels (0-10 scale)

### Hierarchy
- Parent-child relationships
- Ancestry traversal
- Subtree extraction
- Cycle detection

### Optimization
- Duplicate detection (similarity scoring)
- Entity merging
- Graph compression
- Archiving by age/importance/tags

### Analytics
- Graph statistics
- Validation reports
- Orphaned relation detection

### Import/Export
- JSON, CSV, GraphML, GEXF, DOT, Markdown, Mermaid
- Multiple merge strategies
- Dry-run mode for safety
