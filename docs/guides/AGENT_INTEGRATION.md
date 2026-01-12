# AI Agent Integration Guide

**Version**: 1.1.1
**Last Updated**: 2026-01-12

A comprehensive guide for integrating MemoryJS as a memory system for AI agents (Claude, GPT, custom LLMs).

---

## Table of Contents

1. [Overview](#overview)
2. [Memory Architecture](#memory-architecture)
3. [Entity Design Patterns](#entity-design-patterns)
4. [Observation Best Practices](#observation-best-practices)
5. [Relation Strategies](#relation-strategies)
6. [Search for RAG](#search-for-rag)
7. [Memory Persistence](#memory-persistence)
8. [Conversation Context](#conversation-context)
9. [User Preference Learning](#user-preference-learning)
10. [Knowledge Accumulation](#knowledge-accumulation)
11. [MCP Server Integration](#mcp-server-integration)
12. [Performance Considerations](#performance-considerations)
13. [Example Implementations](#example-implementations)

---

## Overview

MemoryJS provides AI agents with persistent, searchable memory that survives across conversations. This enables:

- **Long-term memory**: Remember facts, preferences, and context
- **Knowledge graphs**: Connect related concepts and entities
- **Semantic retrieval**: Find relevant memories by meaning
- **Hierarchical organization**: Structure knowledge in trees
- **Temporal awareness**: Track when things were learned

### Why Use MemoryJS for Agent Memory?

| Feature | Benefit for Agents |
|---------|-------------------|
| **Entity-Relation Model** | Natural fit for facts and connections |
| **Observations** | Store atomic facts without duplication |
| **Importance Scoring** | Prioritize critical memories |
| **Tags** | Categorize by topic, source, reliability |
| **Hybrid Search** | Find memories by meaning + keywords |
| **Hierarchy** | Organize knowledge taxonomically |

---

## Memory Architecture

### Recommended Structure

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent Memory                            │
├─────────────────────────────────────────────────────────────┤
│  User Knowledge          │  Contextual Memory               │
│  ├── user_profile        │  ├── conversation_context        │
│  ├── user_preferences    │  ├── active_tasks                │
│  └── user_history        │  └── session_state               │
├─────────────────────────────────────────────────────────────┤
│  Domain Knowledge        │  Meta Knowledge                   │
│  ├── concepts            │  ├── learned_patterns            │
│  ├── facts               │  ├── correction_history          │
│  └── procedures          │  └── confidence_scores           │
└─────────────────────────────────────────────────────────────┘
```

### Entity Types for Agents

| Entity Type | Purpose | Example |
|-------------|---------|---------|
| `user` | User profile and identity | User's name, role, context |
| `preference` | User preferences | Coding style, communication style |
| `fact` | Learned facts | "User works at Acme Corp" |
| `concept` | Domain concepts | "TypeScript", "Machine Learning" |
| `task` | Active/completed tasks | "Refactor auth module" |
| `conversation` | Conversation summaries | Key points from past chats |
| `correction` | User corrections | "Actually, I prefer tabs" |
| `project` | User's projects | "memory-mcp", "personal-site" |

---

## Entity Design Patterns

### Pattern 1: User Profile Entity

Store core user information as a single high-importance entity:

```typescript
await ctx.entityManager.createEntities([{
  name: 'user_profile',
  entityType: 'user',
  observations: [
    'Name: Alice Chen',
    'Role: Senior Software Engineer',
    'Company: Acme Corp',
    'Primary languages: TypeScript, Python',
    'Prefers functional programming style'
  ],
  tags: ['user', 'profile', 'persistent'],
  importance: 10  // Highest importance
}]);
```

### Pattern 2: Fact Entities

Store individual facts with source tracking:

```typescript
await ctx.entityManager.createEntities([{
  name: 'fact_alice_typescript_expert',
  entityType: 'fact',
  observations: [
    'Alice has 5+ years TypeScript experience',
    'Source: User stated in conversation',
    'Confidence: High',
    'Date learned: 2024-03-15'
  ],
  tags: ['fact', 'user-stated', 'skills'],
  importance: 7
}]);
```

### Pattern 3: Preference Entities

Track user preferences with context:

```typescript
await ctx.entityManager.createEntities([{
  name: 'pref_coding_style',
  entityType: 'preference',
  observations: [
    'Prefers functional over OOP',
    'Uses early returns',
    'Avoids nested ternaries',
    'Likes descriptive variable names',
    'Prefers const over let'
  ],
  tags: ['preference', 'coding', 'style'],
  importance: 8
}]);
```

### Pattern 4: Project Context Entities

Store project-specific knowledge:

```typescript
await ctx.entityManager.createEntities([{
  name: 'project_memory_mcp',
  entityType: 'project',
  observations: [
    'MCP server for Claude memory',
    'Uses MemoryJS library',
    'TypeScript codebase',
    'Has SQLite and JSONL backends',
    'Located at ~/projects/memory-mcp'
  ],
  tags: ['project', 'active', 'typescript'],
  importance: 8
}]);

// Link user to project
await ctx.relationManager.createRelations([{
  from: 'user_profile',
  to: 'project_memory_mcp',
  relationType: 'works_on'
}]);
```

### Pattern 5: Conversation Summary Entities

Summarize important conversations:

```typescript
await ctx.entityManager.createEntities([{
  name: `conversation_${Date.now()}`,
  entityType: 'conversation',
  observations: [
    'Topic: Debugging auth module',
    'Outcome: Fixed JWT expiration issue',
    'Key insight: Token refresh needed',
    'User learned about refresh tokens',
    'Follow-up needed: Add refresh endpoint'
  ],
  tags: ['conversation', 'resolved', 'auth'],
  importance: 6
}]);
```

---

## Observation Best Practices

### Do's

```typescript
// ✅ Atomic facts
'User prefers TypeScript over JavaScript'
'Company uses PostgreSQL for production'

// ✅ Include context
'Learned on 2024-03-15 during onboarding conversation'
'Source: User explicitly stated'

// ✅ Be specific
'Uses VS Code with Vim extension'
'Deploys to AWS us-east-1'

// ✅ Include confidence
'High confidence: User confirmed multiple times'
'Medium confidence: Inferred from code examples'
```

### Don'ts

```typescript
// ❌ Vague observations
'User likes coding'
'Works with technology'

// ❌ Duplicate information
'TypeScript developer'
'Develops in TypeScript'
'Uses TypeScript'

// ❌ Temporary state as permanent fact
'Currently debugging auth module'  // Use task entity instead

// ❌ Opinions without attribution
'TypeScript is better than JavaScript'
```

### Observation Templates

```typescript
// Fact observation
`${fact}. Source: ${source}. Confidence: ${confidence}. Learned: ${date}`

// Preference observation
`Prefers ${choice} over ${alternative}. Context: ${context}`

// Skill observation
`${skill}: ${level}. Evidence: ${evidence}`

// Correction observation
`Corrected: Previously thought ${wrong}, actually ${right}. Date: ${date}`
```

---

## Relation Strategies

### Core Relation Types for Agents

| Relation Type | Usage |
|---------------|-------|
| `knows` | User knows a concept/person |
| `works_on` | User works on project |
| `prefers` | User prefers X |
| `uses` | User/project uses technology |
| `related_to` | Concepts are related |
| `depends_on` | Technical dependencies |
| `learned_from` | Knowledge source |
| `corrected_by` | Correction reference |
| `part_of` | Hierarchical membership |
| `followed_by` | Temporal sequence |

### Relation Patterns

```typescript
// User knowledge connections
await ctx.relationManager.createRelations([
  { from: 'user_profile', to: 'TypeScript', relationType: 'knows' },
  { from: 'user_profile', to: 'project_memory_mcp', relationType: 'works_on' },
  { from: 'user_profile', to: 'pref_coding_style', relationType: 'prefers' }
]);

// Concept relationships
await ctx.relationManager.createRelations([
  { from: 'TypeScript', to: 'JavaScript', relationType: 'compiles_to' },
  { from: 'React', to: 'JavaScript', relationType: 'uses' },
  { from: 'memory_mcp', to: 'MemoryJS', relationType: 'depends_on' }
]);

// Knowledge provenance
await ctx.relationManager.createRelations([
  { from: 'fact_alice_expert', to: 'conversation_123', relationType: 'learned_from' },
  { from: 'pref_old', to: 'correction_456', relationType: 'corrected_by' }
]);
```

---

## Search for RAG

### Strategy Selection Guide

| User Query Type | Best Search Strategy | Why |
|-----------------|---------------------|-----|
| Direct recall | `search()` | Fast, exact matching |
| "What do I know about X" | `searchRanked()` | Relevance scoring |
| Typo-prone input | `fuzzySearch()` | Typo tolerance |
| Semantic questions | `semanticSearch()` | Meaning-based |
| Complex retrieval | `hybridSearch()` | Combined signals |

### RAG Retrieval Pattern

```typescript
async function retrieveContext(userQuery: string): Promise<string> {
  // 1. Hybrid search for comprehensive retrieval
  const hybridResults = await ctx.searchManager.hybridSearch(userQuery, {
    weights: { semantic: 0.4, lexical: 0.4, symbolic: 0.2 },
    filters: { minImportance: 3 },
    limit: 10
  });

  // 2. Always include high-importance entities
  const criticalEntities = await ctx.searchManager.search('', {
    minImportance: 9,
    limit: 5
  });

  // 3. Get related entities via graph traversal
  const relatedNames = new Set<string>();
  for (const result of hybridResults.results.slice(0, 3)) {
    const { incoming, outgoing } = await ctx.relationManager
      .getRelationsForEntity(result.entity.name);
    [...incoming, ...outgoing].forEach(r => {
      relatedNames.add(r.from);
      relatedNames.add(r.to);
    });
  }

  // 4. Format for LLM context
  return formatForContext([
    ...criticalEntities.entities,
    ...hybridResults.results.map(r => r.entity),
    ...await getEntitiesByNames([...relatedNames])
  ]);
}

function formatForContext(entities: Entity[]): string {
  return entities.map(e => `
## ${e.name} (${e.entityType})
${e.observations.map(o => `- ${o}`).join('\n')}
Tags: ${e.tags?.join(', ') || 'none'}
Importance: ${e.importance || 'unset'}
`).join('\n---\n');
}
```

### Query-Specific Retrieval

```typescript
// For "What do you know about me?"
async function getUserProfile(): Promise<Entity[]> {
  return ctx.searchManager.search('', {
    tags: ['user', 'profile', 'preference'],
    minImportance: 5
  }).then(r => r.entities);
}

// For "Remind me about project X"
async function getProjectContext(projectName: string): Promise<KnowledgeGraph> {
  const project = await ctx.entityManager.getEntityByName(projectName);
  if (!project) return { entities: [], relations: [] };

  // Get full subtree if hierarchical
  return ctx.hierarchyManager.getSubtree(projectName);
}

// For "What did we discuss about X?"
async function getConversationHistory(topic: string): Promise<Entity[]> {
  return ctx.searchManager.searchRanked(topic, {
    tags: ['conversation'],
    limit: 10
  }).then(r => r.map(sr => sr.entity));
}
```

---

## Memory Persistence

### When to Create Memories

| Event | Action |
|-------|--------|
| User states fact | Create `fact` entity |
| User expresses preference | Create/update `preference` entity |
| User corrects agent | Create `correction` entity, update original |
| Conversation ends | Create `conversation` summary |
| Task completed | Update `task` entity status |
| New project mentioned | Create `project` entity |

### Memory Creation Flow

```typescript
async function processUserMessage(message: string, intent: Intent) {
  switch (intent.type) {
    case 'statement_of_fact':
      await createFactEntity(intent.fact, intent.confidence);
      break;

    case 'preference_expression':
      await updatePreference(intent.preference, intent.value);
      break;

    case 'correction':
      await handleCorrection(intent.original, intent.corrected);
      break;

    case 'project_reference':
      await ensureProjectExists(intent.projectName);
      break;
  }
}

async function handleCorrection(original: string, corrected: string) {
  // Find original fact
  const results = await ctx.searchManager.searchRanked(original, { limit: 1 });

  if (results.length > 0) {
    const entity = results[0].entity;

    // Add correction observation
    await ctx.observationManager.addObservations([{
      entityName: entity.name,
      contents: [
        `CORRECTED: ${corrected}`,
        `Previous: ${original}`,
        `Corrected on: ${new Date().toISOString()}`
      ]
    }]);

    // Optionally lower importance of corrected facts
    if (entity.importance && entity.importance > 3) {
      await ctx.entityManager.setImportance(entity.name, entity.importance - 2);
    }
  }
}
```

### Memory Decay Strategy

```typescript
// Reduce importance of old, unused memories
async function decayOldMemories(daysThreshold: number = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysThreshold);

  const allEntities = await ctx.entityManager.getAllEntities();

  for (const entity of allEntities) {
    // Skip high-importance and user entities
    if (entity.importance && entity.importance >= 8) continue;
    if (entity.tags?.includes('persistent')) continue;

    const lastModified = new Date(entity.lastModified || entity.createdAt || 0);
    if (lastModified < cutoffDate) {
      const currentImportance = entity.importance || 5;
      const newImportance = Math.max(1, currentImportance - 1);
      await ctx.entityManager.setImportance(entity.name, newImportance);
    }
  }
}
```

---

## Conversation Context

### Session State Management

```typescript
// Create session entity at conversation start
async function startSession(sessionId: string) {
  await ctx.entityManager.createEntities([{
    name: `session_${sessionId}`,
    entityType: 'session',
    observations: [
      `Started: ${new Date().toISOString()}`,
      'Status: active'
    ],
    tags: ['session', 'active'],
    importance: 5
  }]);
}

// Track conversation topics
async function addConversationTopic(sessionId: string, topic: string) {
  await ctx.observationManager.addObservations([{
    entityName: `session_${sessionId}`,
    contents: [`Topic discussed: ${topic}`]
  }]);
}

// Summarize and archive at conversation end
async function endSession(sessionId: string, summary: string) {
  const sessionName = `session_${sessionId}`;

  await ctx.observationManager.addObservations([{
    entityName: sessionName,
    contents: [
      `Ended: ${new Date().toISOString()}`,
      `Summary: ${summary}`,
      'Status: completed'
    ]
  }]);

  // Remove 'active' tag, add 'completed'
  await ctx.entityManager.removeTags(sessionName, ['active']);
  await ctx.entityManager.addTags(sessionName, ['completed']);

  // Lower importance after completion
  await ctx.entityManager.setImportance(sessionName, 3);
}
```

### Multi-Turn Context Tracking

```typescript
class ConversationMemory {
  private sessionId: string;
  private ctx: ManagerContext;
  private turnCount: number = 0;

  constructor(ctx: ManagerContext, sessionId: string) {
    this.ctx = ctx;
    this.sessionId = sessionId;
  }

  async recordTurn(userMessage: string, agentResponse: string, extractedFacts: string[]) {
    this.turnCount++;

    // Store significant facts from conversation
    for (const fact of extractedFacts) {
      await this.ctx.entityManager.createEntities([{
        name: `fact_${this.sessionId}_${this.turnCount}_${Date.now()}`,
        entityType: 'fact',
        observations: [
          fact,
          `Source: Conversation turn ${this.turnCount}`,
          `Session: ${this.sessionId}`
        ],
        tags: ['fact', 'conversation-extracted'],
        importance: 5
      }]);
    }

    // Update session with turn summary
    await this.ctx.observationManager.addObservations([{
      entityName: `session_${this.sessionId}`,
      contents: [`Turn ${this.turnCount}: User asked about ${summarize(userMessage)}`]
    }]);
  }

  async getRelevantContext(currentQuery: string): Promise<string> {
    // Get session history
    const session = await this.ctx.entityManager.getEntityByName(`session_${this.sessionId}`);

    // Search for relevant memories
    const relevant = await this.ctx.searchManager.hybridSearch(currentQuery, {
      limit: 10,
      filters: { minImportance: 3 }
    });

    return formatContext(session, relevant.results);
  }
}
```

---

## User Preference Learning

### Preference Detection Patterns

```typescript
const PREFERENCE_PATTERNS = [
  { pattern: /I prefer (\w+) over (\w+)/i, type: 'comparison' },
  { pattern: /I like (\w+)/i, type: 'positive' },
  { pattern: /I don't like (\w+)/i, type: 'negative' },
  { pattern: /I always use (\w+)/i, type: 'habit' },
  { pattern: /I never use (\w+)/i, type: 'avoidance' },
  { pattern: /please (don't|do) (\w+)/i, type: 'instruction' }
];

async function detectAndStorePreference(message: string) {
  for (const { pattern, type } of PREFERENCE_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      await storePreference(type, match);
    }
  }
}

async function storePreference(type: string, match: RegExpMatchArray) {
  const prefName = `pref_${type}_${Date.now()}`;

  await ctx.entityManager.createEntities([{
    name: prefName,
    entityType: 'preference',
    observations: [
      `Type: ${type}`,
      `Value: ${match[1]}`,
      `Full context: "${match[0]}"`,
      `Learned: ${new Date().toISOString()}`
    ],
    tags: ['preference', type, 'user-stated'],
    importance: 7
  }]);

  // Link to user profile
  await ctx.relationManager.createRelations([{
    from: 'user_profile',
    to: prefName,
    relationType: 'has_preference'
  }]);
}
```

### Preference Application

```typescript
async function getActivePreferences(): Promise<Map<string, string>> {
  const prefs = await ctx.searchManager.search('', {
    tags: ['preference'],
    minImportance: 5
  });

  const prefMap = new Map<string, string>();

  for (const entity of prefs.entities) {
    const typeObs = entity.observations.find(o => o.startsWith('Type:'));
    const valueObs = entity.observations.find(o => o.startsWith('Value:'));

    if (typeObs && valueObs) {
      const type = typeObs.replace('Type:', '').trim();
      const value = valueObs.replace('Value:', '').trim();
      prefMap.set(type, value);
    }
  }

  return prefMap;
}

// Apply preferences to response generation
async function applyPreferences(response: string): Promise<string> {
  const prefs = await getActivePreferences();

  // Example: Apply coding style preferences
  if (prefs.get('indentation') === 'tabs') {
    response = response.replace(/  /g, '\t');
  }

  return response;
}
```

---

## Knowledge Accumulation

### Domain Knowledge Building

```typescript
async function learnConcept(
  name: string,
  type: string,
  facts: string[],
  relatedTo: string[]
) {
  // Check if concept exists
  const existing = await ctx.entityManager.getEntityByName(name);

  if (existing) {
    // Add new observations
    const newFacts = facts.filter(f => !existing.observations.includes(f));
    if (newFacts.length > 0) {
      await ctx.observationManager.addObservations([{
        entityName: name,
        contents: newFacts
      }]);
    }
  } else {
    // Create new concept
    await ctx.entityManager.createEntities([{
      name,
      entityType: type,
      observations: facts,
      tags: ['concept', 'learned'],
      importance: 5
    }]);
  }

  // Create relations to related concepts
  for (const related of relatedTo) {
    const relatedEntity = await ctx.entityManager.getEntityByName(related);
    if (relatedEntity) {
      await ctx.relationManager.createRelations([{
        from: name,
        to: related,
        relationType: 'related_to'
      }]);
    }
  }
}
```

### Knowledge Hierarchy

```typescript
// Build taxonomic knowledge structure
async function buildKnowledgeHierarchy() {
  // Create category entities
  await ctx.entityManager.createEntities([
    { name: 'programming_languages', entityType: 'category', observations: ['Top-level category for programming languages'] },
    { name: 'static_languages', entityType: 'category', observations: ['Statically typed languages'] },
    { name: 'dynamic_languages', entityType: 'category', observations: ['Dynamically typed languages'] }
  ]);

  // Set up hierarchy
  await ctx.hierarchyManager.setEntityParent('static_languages', 'programming_languages');
  await ctx.hierarchyManager.setEntityParent('dynamic_languages', 'programming_languages');

  // Add specific languages under categories
  await ctx.hierarchyManager.setEntityParent('TypeScript', 'static_languages');
  await ctx.hierarchyManager.setEntityParent('Java', 'static_languages');
  await ctx.hierarchyManager.setEntityParent('Python', 'dynamic_languages');
  await ctx.hierarchyManager.setEntityParent('JavaScript', 'dynamic_languages');
}

// Query hierarchical knowledge
async function getLanguagesByType(type: 'static' | 'dynamic'): Promise<Entity[]> {
  const category = type === 'static' ? 'static_languages' : 'dynamic_languages';
  return ctx.hierarchyManager.getDescendants(category);
}
```

---

## MCP Server Integration

MemoryJS is designed to power MCP (Model Context Protocol) servers. Here's how to build memory tools:

### Basic MCP Tool Structure

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext(process.env.MEMORY_PATH || './memory.jsonl');

// Tool: Remember a fact
const rememberTool = {
  name: 'remember',
  description: 'Store a fact in long-term memory',
  inputSchema: {
    type: 'object',
    properties: {
      fact: { type: 'string', description: 'The fact to remember' },
      category: { type: 'string', description: 'Category (fact, preference, project)' },
      importance: { type: 'number', description: 'Importance 1-10' }
    },
    required: ['fact']
  },
  handler: async ({ fact, category = 'fact', importance = 5 }) => {
    const entity = await ctx.entityManager.createEntities([{
      name: `${category}_${Date.now()}`,
      entityType: category,
      observations: [fact, `Stored: ${new Date().toISOString()}`],
      tags: [category, 'agent-stored'],
      importance
    }]);
    return { success: true, entityName: entity[0].name };
  }
};

// Tool: Recall memories
const recallTool = {
  name: 'recall',
  description: 'Search memories for relevant information',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for' },
      limit: { type: 'number', description: 'Max results' }
    },
    required: ['query']
  },
  handler: async ({ query, limit = 10 }) => {
    const results = await ctx.searchManager.hybridSearch(query, {
      limit,
      filters: { minImportance: 2 }
    });
    return {
      memories: results.results.map(r => ({
        name: r.entity.name,
        type: r.entity.entityType,
        facts: r.entity.observations,
        score: r.score
      }))
    };
  }
};

// Tool: Connect memories
const connectTool = {
  name: 'connect',
  description: 'Create a relationship between two memories',
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Source entity name' },
      to: { type: 'string', description: 'Target entity name' },
      relationship: { type: 'string', description: 'Relationship type' }
    },
    required: ['from', 'to', 'relationship']
  },
  handler: async ({ from, to, relationship }) => {
    await ctx.relationManager.createRelations([{
      from, to, relationType: relationship
    }]);
    return { success: true };
  }
};
```

### Complete MCP Server Example

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ManagerContext } from '@danielsimonjr/memoryjs';

const ctx = new ManagerContext('./memory.jsonl');

const server = new Server({
  name: 'memory-server',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {}
  }
});

// List available tools
server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'create_entity',
      description: 'Create a new entity in the knowledge graph',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          entityType: { type: 'string' },
          observations: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } },
          importance: { type: 'number', minimum: 0, maximum: 10 }
        },
        required: ['name', 'entityType', 'observations']
      }
    },
    {
      name: 'search_memory',
      description: 'Search the knowledge graph',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          searchType: { type: 'string', enum: ['basic', 'ranked', 'fuzzy', 'hybrid'] },
          limit: { type: 'number' }
        },
        required: ['query']
      }
    },
    {
      name: 'add_relation',
      description: 'Create a relationship between entities',
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          relationType: { type: 'string' }
        },
        required: ['from', 'to', 'relationType']
      }
    }
  ]
}));

// Handle tool calls
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'create_entity':
      const entities = await ctx.entityManager.createEntities([args]);
      return { content: [{ type: 'text', text: JSON.stringify(entities[0]) }] };

    case 'search_memory':
      const results = await ctx.searchManager.hybridSearch(args.query, {
        limit: args.limit || 10
      });
      return { content: [{ type: 'text', text: JSON.stringify(results.results) }] };

    case 'add_relation':
      await ctx.relationManager.createRelations([args]);
      return { content: [{ type: 'text', text: 'Relation created' }] };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Performance Considerations

### Memory Size Guidelines

| Entity Count | Recommended Storage | Search Strategy |
|--------------|--------------------|-----------------|
| < 500 | JSONL | Any |
| 500-2,000 | JSONL or SQLite | Prefer `searchRanked` |
| 2,000-10,000 | SQLite | Use filters, limit results |
| > 10,000 | SQLite | Aggressive filtering, pagination |

### Optimization Tips

```typescript
// 1. Batch operations
await ctx.entityManager.createEntities(manyEntities);  // Single I/O

// 2. Use importance filtering
await ctx.searchManager.search(query, { minImportance: 5 });  // Reduce results

// 3. Limit results
await ctx.searchManager.hybridSearch(query, { limit: 10 });  // Cap processing

// 4. Use specific searches for specific needs
await ctx.searchManager.search('exact term');      // Fast, exact
await ctx.searchManager.fuzzySearch('typo toelrant');  // Slower, flexible

// 5. Pre-filter with tags
await ctx.searchManager.search(query, { tags: ['user-stated'] });

// 6. Use SQLite for large memory stores
const ctx = new ManagerContext('./memory.db');  // FTS5 indexing
```

### Memory Cleanup

```typescript
// Archive old, low-importance memories
async function cleanupMemory() {
  // Archive old sessions
  await ctx.archiveManager.archiveEntities({
    olderThan: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    maxImportance: 3,
    tags: ['session', 'completed']
  });

  // Find and merge duplicates
  const duplicates = await ctx.compressionManager.findDuplicates(0.85);
  for (const group of duplicates) {
    await ctx.compressionManager.mergeEntities(group);
  }
}
```

---

## Example Implementations

### Complete Agent Memory System

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

class AgentMemory {
  private ctx: ManagerContext;
  private userId: string;

  constructor(storagePath: string, userId: string) {
    this.ctx = new ManagerContext(storagePath);
    this.userId = userId;
  }

  // Initialize user profile if not exists
  async initialize() {
    const profile = await this.ctx.entityManager.getEntityByName('user_profile');
    if (!profile) {
      await this.ctx.entityManager.createEntities([{
        name: 'user_profile',
        entityType: 'user',
        observations: [`User ID: ${this.userId}`, `Created: ${new Date().toISOString()}`],
        tags: ['user', 'profile', 'persistent'],
        importance: 10
      }]);
    }
  }

  // Remember a fact about the user
  async rememberFact(fact: string, confidence: 'high' | 'medium' | 'low' = 'medium') {
    const importance = { high: 8, medium: 6, low: 4 }[confidence];

    await this.ctx.entityManager.createEntities([{
      name: `fact_${Date.now()}`,
      entityType: 'fact',
      observations: [fact, `Confidence: ${confidence}`, `Learned: ${new Date().toISOString()}`],
      tags: ['fact', confidence],
      importance
    }]);
  }

  // Update or create preference
  async setPreference(category: string, value: string) {
    const prefName = `pref_${category}`;
    const existing = await this.ctx.entityManager.getEntityByName(prefName);

    if (existing) {
      await this.ctx.observationManager.addObservations([{
        entityName: prefName,
        contents: [`Updated to: ${value}`, `Updated: ${new Date().toISOString()}`]
      }]);
    } else {
      await this.ctx.entityManager.createEntities([{
        name: prefName,
        entityType: 'preference',
        observations: [`${category}: ${value}`],
        tags: ['preference', category],
        importance: 7
      }]);

      await this.ctx.relationManager.createRelations([{
        from: 'user_profile',
        to: prefName,
        relationType: 'has_preference'
      }]);
    }
  }

  // Get context for RAG
  async getContext(query: string): Promise<string> {
    // Get user profile
    const profile = await this.ctx.entityManager.getEntityByName('user_profile');

    // Get relevant memories
    const results = await this.ctx.searchManager.hybridSearch(query, {
      weights: { semantic: 0.4, lexical: 0.4, symbolic: 0.2 },
      limit: 10,
      filters: { minImportance: 3 }
    });

    // Get active preferences
    const prefs = await this.ctx.searchManager.search('', {
      tags: ['preference'],
      minImportance: 5
    });

    // Format context
    let context = `## User Profile\n${profile?.observations.join('\n')}\n\n`;
    context += `## Preferences\n${prefs.entities.map(e => e.observations.join('; ')).join('\n')}\n\n`;
    context += `## Relevant Memories\n${results.results.map(r =>
      `- ${r.entity.name}: ${r.entity.observations[0]} (score: ${r.score.toFixed(2)})`
    ).join('\n')}`;

    return context;
  }

  // Record conversation summary
  async summarizeConversation(topics: string[], outcome: string) {
    await this.ctx.entityManager.createEntities([{
      name: `conv_${Date.now()}`,
      entityType: 'conversation',
      observations: [
        `Topics: ${topics.join(', ')}`,
        `Outcome: ${outcome}`,
        `Date: ${new Date().toISOString()}`
      ],
      tags: ['conversation', ...topics.map(t => t.toLowerCase().replace(/\s+/g, '-'))],
      importance: 5
    }]);
  }
}

// Usage
const memory = new AgentMemory('./agent-memory.jsonl', 'user123');
await memory.initialize();

// During conversation
await memory.rememberFact('User is a TypeScript developer', 'high');
await memory.setPreference('coding_style', 'functional');

// For RAG retrieval
const context = await memory.getContext('How should I write TypeScript code?');
console.log(context);
```

---

**Document Version**: 1.0
**Last Updated**: 2026-01-12
