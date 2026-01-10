#!/usr/bin/env node
/**
 * Memory MCP Migration Tool
 *
 * Migrates knowledge graph data between JSONL and SQLite storage formats.
 * This is a standalone tool that uses better-sqlite3 for native SQLite support.
 *
 * Usage:
 *   npx migrate-from-jsonl-to-sqlite --from memory.jsonl --to memory.db
 *   npx migrate-from-jsonl-to-sqlite --from memory.db --to memory.jsonl
 *
 * @module tools/migrate-from-jsonl-to-sqlite
 */

import { resolve, extname, dirname } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

// ============================================================================
// Types (inline to avoid external dependencies)
// ============================================================================

interface Entity {
  name: string;
  entityType: string;
  observations: string[];
  createdAt?: string;
  lastModified?: string;
  tags?: string[];
  importance?: number | null;
  parentId?: string | null;
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
  createdAt?: string;
  lastModified?: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

interface MigrationOptions {
  from: string;
  to: string;
  verbose?: boolean;
}

interface TimestampValidationResult {
  entitiesWithMissingCreatedAt: string[];
  entitiesWithMissingLastModified: string[];
  relationsWithMissingCreatedAt: number;
  relationsWithMissingLastModified: number;
}

/**
 * Validates timestamps in the graph and logs warnings for missing values.
 * Returns counts of entities/relations with missing timestamps.
 */
function validateTimestamps(graph: KnowledgeGraph, verbose: boolean): TimestampValidationResult {
  const result: TimestampValidationResult = {
    entitiesWithMissingCreatedAt: [],
    entitiesWithMissingLastModified: [],
    relationsWithMissingCreatedAt: 0,
    relationsWithMissingLastModified: 0,
  };

  // Check entities
  for (const entity of graph.entities) {
    if (!entity.createdAt) {
      result.entitiesWithMissingCreatedAt.push(entity.name);
    }
    if (!entity.lastModified) {
      result.entitiesWithMissingLastModified.push(entity.name);
    }
  }

  // Check relations
  for (const relation of graph.relations) {
    if (!relation.createdAt) {
      result.relationsWithMissingCreatedAt++;
    }
    if (!relation.lastModified) {
      result.relationsWithMissingLastModified++;
    }
  }

  // Log warnings
  const hasIssues =
    result.entitiesWithMissingCreatedAt.length > 0 ||
    result.entitiesWithMissingLastModified.length > 0 ||
    result.relationsWithMissingCreatedAt > 0 ||
    result.relationsWithMissingLastModified > 0;

  if (hasIssues) {
    console.log('\n⚠️  Timestamp Validation Warnings:');

    if (result.entitiesWithMissingCreatedAt.length > 0) {
      console.log(
        `   ${result.entitiesWithMissingCreatedAt.length} entities missing createdAt timestamp`
      );
      if (verbose && result.entitiesWithMissingCreatedAt.length <= 10) {
        for (const name of result.entitiesWithMissingCreatedAt) {
          console.log(`     - ${name}`);
        }
      } else if (verbose) {
        for (const name of result.entitiesWithMissingCreatedAt.slice(0, 10)) {
          console.log(`     - ${name}`);
        }
        console.log(`     ... and ${result.entitiesWithMissingCreatedAt.length - 10} more`);
      }
    }

    if (result.entitiesWithMissingLastModified.length > 0) {
      console.log(
        `   ${result.entitiesWithMissingLastModified.length} entities missing lastModified timestamp`
      );
      if (verbose && result.entitiesWithMissingLastModified.length <= 10) {
        for (const name of result.entitiesWithMissingLastModified) {
          console.log(`     - ${name}`);
        }
      } else if (verbose) {
        for (const name of result.entitiesWithMissingLastModified.slice(0, 10)) {
          console.log(`     - ${name}`);
        }
        console.log(`     ... and ${result.entitiesWithMissingLastModified.length - 10} more`);
      }
    }

    if (result.relationsWithMissingCreatedAt > 0) {
      console.log(
        `   ${result.relationsWithMissingCreatedAt} relations missing createdAt timestamp`
      );
    }

    if (result.relationsWithMissingLastModified > 0) {
      console.log(
        `   ${result.relationsWithMissingLastModified} relations missing lastModified timestamp`
      );
    }

    console.log('   Missing timestamps will be set to current date/time during migration.');
  }

  return result;
}

interface EntityRow {
  name: string;
  entityType: string;
  observations: string;
  createdAt: string | null;
  lastModified: string | null;
  tags: string | null;
  importance: number | null;
  parentId: string | null;
}

interface RelationRow {
  fromEntity: string;
  toEntity: string;
  relationType: string;
  createdAt: string | null;
  lastModified: string | null;
}

// ============================================================================
// JSONL Storage (inline implementation)
// ============================================================================

function loadFromJsonl(filePath: string): KnowledgeGraph {
  const absolutePath = resolve(filePath);

  if (!existsSync(absolutePath)) {
    return { entities: [], relations: [] };
  }

  const content = readFileSync(absolutePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim());

  const entities: Entity[] = [];
  const relations: Relation[] = [];
  const entityMap = new Map<string, Entity>();

  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item.type === 'entity') {
        const entity: Entity = {
          name: item.name,
          entityType: item.entityType,
          observations: item.observations || [],
          createdAt: item.createdAt,
          lastModified: item.lastModified,
          tags: item.tags,
          importance: item.importance,
          parentId: item.parentId,
        };
        entityMap.set(entity.name, entity);
      } else if (item.type === 'relation') {
        relations.push({
          from: item.from,
          to: item.to,
          relationType: item.relationType,
          createdAt: item.createdAt,
          lastModified: item.lastModified,
        });
      }
    } catch {
      // Skip invalid lines
    }
  }

  entities.push(...entityMap.values());
  return { entities, relations };
}

function saveToJsonl(filePath: string, graph: KnowledgeGraph): void {
  const absolutePath = resolve(filePath);
  const dir = dirname(absolutePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const lines: string[] = [];

  for (const entity of graph.entities) {
    lines.push(
      JSON.stringify({
        type: 'entity',
        name: entity.name,
        entityType: entity.entityType,
        observations: entity.observations,
        createdAt: entity.createdAt,
        lastModified: entity.lastModified,
        tags: entity.tags,
        importance: entity.importance,
        parentId: entity.parentId,
      })
    );
  }

  for (const relation of graph.relations) {
    lines.push(
      JSON.stringify({
        type: 'relation',
        from: relation.from,
        to: relation.to,
        relationType: relation.relationType,
        createdAt: relation.createdAt,
        lastModified: relation.lastModified,
      })
    );
  }

  writeFileSync(absolutePath, lines.join('\n') + '\n', 'utf-8');
}

// ============================================================================
// SQLite Storage (using better-sqlite3)
// ============================================================================

function loadFromSqlite(filePath: string): KnowledgeGraph {
  const absolutePath = resolve(filePath);

  if (!existsSync(absolutePath)) {
    return { entities: [], relations: [] };
  }

  const db: DatabaseType = new Database(absolutePath, { readonly: true });

  try {
    const entities: Entity[] = [];
    const relations: Relation[] = [];

    // Check if tables exist
    const tableCheck = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('entities', 'relations')"
      )
      .all();

    if (tableCheck.length === 0) {
      return { entities: [], relations: [] };
    }

    // Load entities
    const entityRows = db.prepare('SELECT * FROM entities').all() as EntityRow[];
    for (const row of entityRows) {
      entities.push({
        name: row.name,
        entityType: row.entityType,
        observations: row.observations ? JSON.parse(row.observations) : [],
        createdAt: row.createdAt ?? undefined,
        lastModified: row.lastModified ?? undefined,
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        importance: row.importance ?? undefined,
        parentId: row.parentId ?? undefined,
      });
    }

    // Load relations
    const relationRows = db.prepare('SELECT * FROM relations').all() as RelationRow[];
    for (const row of relationRows) {
      relations.push({
        from: row.fromEntity,
        to: row.toEntity,
        relationType: row.relationType,
        createdAt: row.createdAt ?? undefined,
        lastModified: row.lastModified ?? undefined,
      });
    }

    return { entities, relations };
  } finally {
    db.close();
  }
}

function saveToSqlite(
  filePath: string,
  graph: KnowledgeGraph,
  migrationTimestamp: string
): void {
  const absolutePath = resolve(filePath);
  const dir = dirname(absolutePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Remove existing file if present (we're doing a full migration)
  if (existsSync(absolutePath)) {
    const fs = require('fs');
    fs.unlinkSync(absolutePath);
  }

  const db: DatabaseType = new Database(absolutePath);

  try {
    // Enable WAL mode for better performance
    db.pragma('journal_mode = WAL');

    // Create tables with schema matching SQLiteStorage.ts
    // Enable foreign keys for referential integrity
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        name TEXT PRIMARY KEY,
        entityType TEXT NOT NULL,
        observations TEXT NOT NULL,
        tags TEXT,
        importance INTEGER,
        parentId TEXT REFERENCES entities(name) ON DELETE SET NULL,
        createdAt TEXT NOT NULL,
        lastModified TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS relations (
        fromEntity TEXT NOT NULL REFERENCES entities(name) ON DELETE CASCADE,
        toEntity TEXT NOT NULL REFERENCES entities(name) ON DELETE CASCADE,
        relationType TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastModified TEXT NOT NULL,
        PRIMARY KEY (fromEntity, toEntity, relationType)
      )
    `);

    // Create indexes
    db.exec('CREATE INDEX IF NOT EXISTS idx_entity_type ON entities(entityType)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_entity_parent ON entities(parentId)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_relation_from ON relations(fromEntity)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_relation_to ON relations(toEntity)');

    // Create FTS5 virtual table for full-text search
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
        name,
        entityType,
        observations,
        tags,
        content='entities',
        content_rowid='rowid'
      )
    `);

    // Create triggers to keep FTS5 index in sync
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
        INSERT INTO entities_fts(rowid, name, entityType, observations, tags)
        VALUES (NEW.rowid, NEW.name, NEW.entityType, NEW.observations, NEW.tags);
      END
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, name, entityType, observations, tags)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.entityType, OLD.observations, OLD.tags);
      END
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
        INSERT INTO entities_fts(entities_fts, rowid, name, entityType, observations, tags)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.entityType, OLD.observations, OLD.tags);
        INSERT INTO entities_fts(rowid, name, entityType, observations, tags)
        VALUES (NEW.rowid, NEW.name, NEW.entityType, NEW.observations, NEW.tags);
      END
    `);

    // Disable foreign keys during data insertion to allow dangling references
    // (matches JSONL behavior where parentId/relations may reference non-existent entities)
    db.pragma('foreign_keys = OFF');

    // Use transaction for atomicity
    // Note: We use explicit null/undefined checks instead of || to avoid
    // accidentally replacing empty strings or other falsy values.
    // Missing timestamps are replaced with the migration timestamp.
    const insertEntities = db.transaction((entities: Entity[]) => {
      const insertEntity = db.prepare(`
        INSERT INTO entities (name, entityType, observations, tags, importance, parentId, createdAt, lastModified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const entity of entities) {
        // Use original timestamp if present, otherwise use migration timestamp
        const createdAt =
          entity.createdAt !== null && entity.createdAt !== undefined
            ? entity.createdAt
            : migrationTimestamp;
        const lastModified =
          entity.lastModified !== null && entity.lastModified !== undefined
            ? entity.lastModified
            : migrationTimestamp;

        insertEntity.run(
          entity.name,
          entity.entityType,
          JSON.stringify(entity.observations),
          entity.tags ? JSON.stringify(entity.tags) : null,
          entity.importance ?? null,
          entity.parentId ?? null,
          createdAt,
          lastModified
        );
      }
    });

    const insertRelations = db.transaction((relations: Relation[]) => {
      const insertRelation = db.prepare(`
        INSERT INTO relations (fromEntity, toEntity, relationType, createdAt, lastModified)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const relation of relations) {
        // Use original timestamp if present, otherwise use migration timestamp
        const createdAt =
          relation.createdAt !== null && relation.createdAt !== undefined
            ? relation.createdAt
            : migrationTimestamp;
        const lastModified =
          relation.lastModified !== null && relation.lastModified !== undefined
            ? relation.lastModified
            : migrationTimestamp;

        insertRelation.run(
          relation.from,
          relation.to,
          relation.relationType,
          createdAt,
          lastModified
        );
      }
    });

    // Insert data
    insertEntities(graph.entities);
    insertRelations(graph.relations);

    // Re-enable foreign keys for future operations
    db.pragma('foreign_keys = ON');

    // Checkpoint WAL to ensure all data is written
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}

// ============================================================================
// Migration Logic
// ============================================================================

/**
 * Resolves file path, checking both specified location and legacy dist/ location.
 * Returns the path where the file actually exists, or the original path if not found.
 */
function resolveFilePath(filePath: string): string {
  const absolutePath = resolve(filePath);

  // If file exists at specified path, use it
  if (existsSync(absolutePath)) {
    return absolutePath;
  }

  // Check if this might be a file that was in dist/ (old default location)
  const fileName = absolutePath.split(/[/\\]/).pop() || '';
  const dir = dirname(absolutePath);
  const legacyPath = resolve(dir, 'dist', fileName);

  if (existsSync(legacyPath)) {
    console.log(`\n📍 Note: File not found at ${absolutePath}`);
    console.log(`   Found at legacy location: ${legacyPath}`);
    return legacyPath;
  }

  // Return original path (will fail later with appropriate error)
  return absolutePath;
}

function detectStorageType(filePath: string): 'jsonl' | 'sqlite' {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.jsonl' || ext === '.json') {
    return 'jsonl';
  }
  if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3') {
    return 'sqlite';
  }
  console.warn(`Unknown extension "${ext}", assuming JSONL format`);
  return 'jsonl';
}

function migrate(options: MigrationOptions): void {
  const { from, to, verbose = false } = options;

  // Resolve source path, checking legacy dist/ location if needed
  const resolvedFrom = resolveFilePath(from);

  const fromType = detectStorageType(resolvedFrom);
  const toType = detectStorageType(to);

  if (fromType === toType) {
    console.warn(`Warning: Both source and destination are ${fromType} format.`);
    console.warn('This will copy the data but not change the storage format.');
  }

  if (verbose) {
    console.log(`Migrating from ${fromType.toUpperCase()} to ${toType.toUpperCase()}`);
    console.log(`  Source: ${resolvedFrom}`);
    console.log(`  Target: ${resolve(to)}`);
  }

  try {
    // Load data from source
    console.log('\n📖 Loading source data...');
    let graph: KnowledgeGraph;

    if (fromType === 'jsonl') {
      graph = loadFromJsonl(resolvedFrom);
    } else {
      graph = loadFromSqlite(resolvedFrom);
    }

    const entityCount = graph.entities.length;
    const relationCount = graph.relations.length;

    if (entityCount === 0 && relationCount === 0) {
      console.log('⚠️  Source graph is empty. Nothing to migrate.');
      return;
    }

    console.log(`   Found ${entityCount} entities and ${relationCount} relations`);

    // Validate timestamps and warn about missing values
    validateTimestamps(graph, verbose);

    // Generate a single migration timestamp for consistency
    // All entities/relations with missing timestamps will get this same value
    const migrationTimestamp = new Date().toISOString();

    // Write to target
    console.log('\n💾 Writing to target...');

    if (toType === 'jsonl') {
      saveToJsonl(to, graph);
    } else {
      saveToSqlite(to, graph, migrationTimestamp);
    }

    // Verify by reading back
    console.log('\n✅ Verifying migration...');
    let verifyGraph: KnowledgeGraph;

    if (toType === 'jsonl') {
      verifyGraph = loadFromJsonl(to);
    } else {
      verifyGraph = loadFromSqlite(to);
    }

    const verifyEntityCount = verifyGraph.entities.length;
    const verifyRelationCount = verifyGraph.relations.length;

    if (verifyEntityCount !== entityCount || verifyRelationCount !== relationCount) {
      console.error('❌ Verification failed!');
      console.error(`   Expected: ${entityCount} entities, ${relationCount} relations`);
      console.error(`   Got: ${verifyEntityCount} entities, ${verifyRelationCount} relations`);
      process.exit(1);
    }

    console.log('\n✨ Migration completed successfully!');
    console.log(`   Migrated ${entityCount} entities and ${relationCount} relations`);
    console.log(`   From: ${resolvedFrom} (${fromType})`);
    console.log(`   To:   ${to} (${toType})`);

    if (toType === 'sqlite') {
      console.log('\n   📝 Note: FTS5 full-text search index has been created.');
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): MigrationOptions {
  const args = process.argv.slice(2);
  const options: Partial<MigrationOptions> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--from' || arg === '-f') {
      options.from = args[++i];
    } else if (arg === '--to' || arg === '-t') {
      options.to = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      if (!options.from) {
        options.from = arg;
      } else if (!options.to) {
        options.to = arg;
      }
    }
  }

  if (!options.from || !options.to) {
    console.error('Error: Both source (--from) and target (--to) paths are required.\n');
    printHelp();
    process.exit(1);
  }

  return options as MigrationOptions;
}

function printHelp(): void {
  console.log(`
Memory MCP Migration Tool
=========================

Migrate knowledge graph data between JSONL and SQLite storage formats.
Uses better-sqlite3 for native SQLite performance.

USAGE:
  migrate-from-jsonl-to-sqlite --from <source> --to <target> [options]
  migrate-from-jsonl-to-sqlite <source> <target> [options]

ARGUMENTS:
  --from, -f <path>    Source file path (JSONL or SQLite)
  --to, -t <path>      Target file path (JSONL or SQLite)
  --verbose, -v        Show detailed progress
  --help, -h           Show this help message

EXAMPLES:
  # Migrate JSONL to SQLite
  migrate-from-jsonl-to-sqlite --from memory.jsonl --to memory.db

  # Migrate SQLite to JSONL
  migrate-from-jsonl-to-sqlite --from memory.db --to memory.jsonl

  # Using positional arguments
  migrate-from-jsonl-to-sqlite memory.jsonl memory.db

  # Verbose output
  migrate-from-jsonl-to-sqlite -f memory.jsonl -t memory.db -v

FILE EXTENSIONS:
  JSONL: .jsonl, .json
  SQLite: .db, .sqlite, .sqlite3

FEATURES:
  - Native SQLite via better-sqlite3 (3-10x faster than WASM)
  - FTS5 full-text search index created automatically
  - WAL mode for better performance
  - Atomic transactions for data integrity
  - Timestamp validation with warnings for missing values

NOTES:
  - The target file will be created if it doesn't exist
  - If the target file exists, it will be overwritten
  - Migration preserves all entities, relations, and metadata
  - Missing timestamps (null/undefined) are set to migration time with warnings
  - Saved searches and tag aliases are NOT migrated (they use separate files)
`);
}

// Run migration
const options = parseArgs();
migrate(options);
