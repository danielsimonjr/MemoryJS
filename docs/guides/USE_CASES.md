# MemoryJS Use Cases & Examples

**Version**: 1.1.1
**Last Updated**: 2026-01-12

Real-world examples and implementation patterns for common MemoryJS use cases.

---

## Table of Contents

1. [Personal Knowledge Base](#1-personal-knowledge-base)
2. [AI Chatbot Memory](#2-ai-chatbot-memory)
3. [RAG (Retrieval-Augmented Generation)](#3-rag-retrieval-augmented-generation)
4. [Research Note System](#4-research-note-system)
5. [Project Documentation Hub](#5-project-documentation-hub)
6. [Contact Relationship Manager](#6-contact-relationship-manager)
7. [Learning Progress Tracker](#7-learning-progress-tracker)
8. [Content Recommendation Engine](#8-content-recommendation-engine)
9. [Codebase Knowledge Graph](#9-codebase-knowledge-graph)
10. [Meeting Notes & Action Items](#10-meeting-notes--action-items)

---

## 1. Personal Knowledge Base

A Zettelkasten-style personal knowledge management system.

### Setup

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

const kb = new ManagerContext('./knowledge-base.jsonl');
```

### Creating Notes with Connections

```typescript
// Create interconnected notes
async function createNote(
  title: string,
  content: string,
  linkedNotes: string[],
  tags: string[]
) {
  // Create the note entity
  await kb.entityManager.createEntities([{
    name: title,
    entityType: 'note',
    observations: content.split('\n').filter(l => l.trim()),
    tags: ['note', ...tags],
    importance: 5
  }]);

  // Create bidirectional links
  for (const linked of linkedNotes) {
    const existing = await kb.entityManager.getEntityByName(linked);
    if (existing) {
      await kb.relationManager.createRelations([
        { from: title, to: linked, relationType: 'links_to' },
        { from: linked, to: title, relationType: 'linked_from' }
      ]);
    }
  }

  return title;
}

// Example usage
await createNote(
  'TypeScript Generics',
  `Generics provide type safety with flexibility.
Use <T> syntax to define type parameters.
Common patterns: Array<T>, Promise<T>, Map<K,V>
Constraints: <T extends SomeType>`,
  ['TypeScript Basics', 'Type Safety'],
  ['programming', 'typescript', 'types']
);
```

### Finding Related Notes

```typescript
async function findRelatedNotes(noteName: string): Promise<Entity[]> {
  // Get direct links
  const { incoming, outgoing } = await kb.relationManager.getRelationsForEntity(noteName);

  const relatedNames = new Set([
    ...incoming.map(r => r.from),
    ...outgoing.map(r => r.to)
  ]);

  // Get entities
  const related: Entity[] = [];
  for (const name of relatedNames) {
    const entity = await kb.entityManager.getEntityByName(name);
    if (entity) related.push(entity);
  }

  return related;
}

// Find notes by similarity
async function findSimilarNotes(query: string): Promise<SearchResult[]> {
  return kb.searchManager.searchRanked(query, {
    tags: ['note'],
    limit: 10,
    minScore: 0.3
  });
}
```

### Building a Knowledge Graph Visualization

```typescript
async function exportForVisualization(): Promise<string> {
  // Export as Mermaid diagram
  const mermaid = await kb.ioManager.exportGraph('mermaid', {
    filter: { tags: ['note'] }
  });

  return mermaid;
}

// Output:
// graph TD
//   TypeScript_Generics --> TypeScript_Basics
//   TypeScript_Generics --> Type_Safety
//   ...
```

---

## 2. AI Chatbot Memory

Persistent memory for a conversational AI assistant.

### Memory System Class

```typescript
import { ManagerContext, Entity } from '@danielsimonjr/memoryjs';

class ChatbotMemory {
  private ctx: ManagerContext;

  constructor(memoryPath: string) {
    this.ctx = new ManagerContext(memoryPath);
  }

  // Remember user information
  async rememberUser(userId: string, facts: string[]) {
    const userName = `user_${userId}`;
    const existing = await this.ctx.entityManager.getEntityByName(userName);

    if (existing) {
      // Add new facts
      const newFacts = facts.filter(f => !existing.observations.includes(f));
      if (newFacts.length > 0) {
        await this.ctx.observationManager.addObservations([{
          entityName: userName,
          contents: newFacts
        }]);
      }
    } else {
      // Create new user profile
      await this.ctx.entityManager.createEntities([{
        name: userName,
        entityType: 'user',
        observations: facts,
        tags: ['user', 'profile'],
        importance: 9
      }]);
    }
  }

  // Remember conversation topic
  async rememberTopic(userId: string, topic: string, details: string[]) {
    const topicName = `topic_${userId}_${topic.replace(/\s+/g, '_')}`;

    await this.ctx.entityManager.createEntities([{
      name: topicName,
      entityType: 'conversation_topic',
      observations: details,
      tags: ['topic', 'conversation'],
      importance: 6
    }]);

    // Link to user
    await this.ctx.relationManager.createRelations([{
      from: `user_${userId}`,
      to: topicName,
      relationType: 'discussed'
    }]);
  }

  // Recall relevant context for a query
  async recallContext(userId: string, query: string): Promise<string> {
    // Get user profile
    const user = await this.ctx.entityManager.getEntityByName(`user_${userId}`);

    // Search relevant memories
    const results = await this.ctx.searchManager.hybridSearch(query, {
      weights: { semantic: 0.5, lexical: 0.3, symbolic: 0.2 },
      limit: 5
    });

    // Format context
    let context = '';

    if (user) {
      context += `User Profile:\n${user.observations.map(o => `- ${o}`).join('\n')}\n\n`;
    }

    if (results.results.length > 0) {
      context += `Relevant Memories:\n`;
      for (const r of results.results) {
        context += `[${r.entity.entityType}] ${r.entity.name}:\n`;
        context += r.entity.observations.map(o => `  - ${o}`).join('\n');
        context += '\n';
      }
    }

    return context;
  }

  // Store user preference
  async setPreference(userId: string, preference: string, value: string) {
    const prefName = `pref_${userId}_${preference}`;

    await this.ctx.entityManager.createEntities([{
      name: prefName,
      entityType: 'preference',
      observations: [`${preference}: ${value}`],
      tags: ['preference'],
      importance: 8
    }]);

    await this.ctx.relationManager.createRelations([{
      from: `user_${userId}`,
      to: prefName,
      relationType: 'prefers'
    }]);
  }

  // Get user preferences
  async getPreferences(userId: string): Promise<Map<string, string>> {
    const { outgoing } = await this.ctx.relationManager.getRelationsForEntity(`user_${userId}`);

    const prefs = new Map<string, string>();

    for (const rel of outgoing.filter(r => r.relationType === 'prefers')) {
      const pref = await this.ctx.entityManager.getEntityByName(rel.to);
      if (pref && pref.observations[0]) {
        const [key, value] = pref.observations[0].split(': ');
        prefs.set(key, value);
      }
    }

    return prefs;
  }
}

// Usage
const memory = new ChatbotMemory('./chatbot-memory.jsonl');

// During conversation
await memory.rememberUser('alice123', [
  'Name: Alice',
  'Works as a software engineer',
  'Prefers concise answers'
]);

await memory.setPreference('alice123', 'response_style', 'technical');
await memory.rememberTopic('alice123', 'React Hooks', [
  'Asked about useEffect cleanup',
  'Explained dependency arrays',
  'Showed useState examples'
]);

// When responding
const context = await memory.recallContext('alice123', 'How do I use React hooks?');
console.log(context);
```

---

## 3. RAG (Retrieval-Augmented Generation)

Document-based question answering with semantic search.

### Document Ingestion

```typescript
import { ManagerContext, createEmbeddingService, createVectorStore, SemanticSearch } from '@danielsimonjr/memoryjs';

class RAGSystem {
  private ctx: ManagerContext;
  private semantic: SemanticSearch;

  async initialize(storagePath: string) {
    this.ctx = new ManagerContext(storagePath);

    // Initialize semantic search
    const embeddingService = await createEmbeddingService({
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY
    });

    const vectorStore = createVectorStore('rag', this.ctx.storage);
    this.semantic = new SemanticSearch(this.ctx.storage, embeddingService, vectorStore);
  }

  // Ingest a document
  async ingestDocument(
    documentId: string,
    title: string,
    chunks: string[],
    metadata: { source: string; author?: string; date?: string }
  ) {
    // Create document entity
    await this.ctx.entityManager.createEntities([{
      name: documentId,
      entityType: 'document',
      observations: [
        `Title: ${title}`,
        `Source: ${metadata.source}`,
        metadata.author ? `Author: ${metadata.author}` : '',
        metadata.date ? `Date: ${metadata.date}` : '',
        `Chunks: ${chunks.length}`
      ].filter(Boolean),
      tags: ['document', 'source'],
      importance: 7
    }]);

    // Create chunk entities
    for (let i = 0; i < chunks.length; i++) {
      const chunkName = `${documentId}_chunk_${i}`;
      await this.ctx.entityManager.createEntities([{
        name: chunkName,
        entityType: 'chunk',
        observations: [chunks[i]],
        tags: ['chunk', 'searchable'],
        importance: 5
      }]);

      // Link chunk to document
      await this.ctx.relationManager.createRelations([{
        from: chunkName,
        to: documentId,
        relationType: 'part_of'
      }]);

      // Index for semantic search
      await this.semantic.indexEntity({
        name: chunkName,
        entityType: 'chunk',
        observations: [chunks[i]]
      });
    }
  }

  // Retrieve relevant context for a query
  async retrieve(query: string, topK: number = 5): Promise<RetrievalResult[]> {
    // Semantic search for relevant chunks
    const semanticResults = await this.semantic.search(query, {
      limit: topK * 2,
      minScore: 0.5
    });

    // Also do lexical search for keyword matching
    const lexicalResults = await this.ctx.searchManager.searchRanked(query, {
      tags: ['chunk'],
      limit: topK * 2
    });

    // Combine and deduplicate
    const seen = new Set<string>();
    const combined: RetrievalResult[] = [];

    for (const r of semanticResults) {
      if (!seen.has(r.entity.name)) {
        seen.add(r.entity.name);
        combined.push({
          chunk: r.entity.observations[0],
          score: r.score,
          source: await this.getDocumentSource(r.entity.name)
        });
      }
    }

    for (const r of lexicalResults) {
      if (!seen.has(r.entity.name)) {
        seen.add(r.entity.name);
        combined.push({
          chunk: r.entity.observations[0],
          score: r.score * 0.8,  // Weight lexical slightly lower
          source: await this.getDocumentSource(r.entity.name)
        });
      }
    }

    // Sort by score and return top K
    return combined
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private async getDocumentSource(chunkName: string): Promise<string> {
    const { outgoing } = await this.ctx.relationManager.getRelationsForEntity(chunkName);
    const docRel = outgoing.find(r => r.relationType === 'part_of');
    return docRel?.to || 'unknown';
  }

  // Generate context string for LLM
  async generateContext(query: string): Promise<string> {
    const results = await this.retrieve(query, 5);

    let context = `Relevant information for: "${query}"\n\n`;

    for (let i = 0; i < results.length; i++) {
      context += `[${i + 1}] Source: ${results[i].source}\n`;
      context += `${results[i].chunk}\n\n`;
    }

    return context;
  }
}

interface RetrievalResult {
  chunk: string;
  score: number;
  source: string;
}

// Usage
const rag = new RAGSystem();
await rag.initialize('./rag-store.db');

// Ingest documents
await rag.ingestDocument('doc1', 'TypeScript Handbook', [
  'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.',
  'Interfaces in TypeScript describe the shape of an object.',
  'Generics provide a way to create reusable components.'
], { source: 'typescript-handbook.md', author: 'Microsoft' });

// Query
const context = await rag.generateContext('How do TypeScript interfaces work?');
console.log(context);
```

---

## 4. Research Note System

Academic research organization with papers, concepts, and citations.

### Research Graph Setup

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

class ResearchGraph {
  private ctx: ManagerContext;

  constructor(path: string) {
    this.ctx = new ManagerContext(path);
  }

  // Add a research paper
  async addPaper(paper: {
    title: string;
    authors: string[];
    abstract: string;
    keywords: string[];
    year: number;
    doi?: string;
  }) {
    const paperId = paper.title.toLowerCase().replace(/\s+/g, '_').substring(0, 50);

    await this.ctx.entityManager.createEntities([{
      name: paperId,
      entityType: 'paper',
      observations: [
        `Title: ${paper.title}`,
        `Authors: ${paper.authors.join(', ')}`,
        `Year: ${paper.year}`,
        paper.doi ? `DOI: ${paper.doi}` : '',
        `Abstract: ${paper.abstract}`
      ].filter(Boolean),
      tags: ['paper', ...paper.keywords],
      importance: 7
    }]);

    // Create author entities and links
    for (const author of paper.authors) {
      const authorId = `author_${author.toLowerCase().replace(/\s+/g, '_')}`;

      const existing = await this.ctx.entityManager.getEntityByName(authorId);
      if (!existing) {
        await this.ctx.entityManager.createEntities([{
          name: authorId,
          entityType: 'author',
          observations: [`Name: ${author}`],
          tags: ['author'],
          importance: 5
        }]);
      }

      await this.ctx.relationManager.createRelations([{
        from: authorId,
        to: paperId,
        relationType: 'authored'
      }]);
    }

    return paperId;
  }

  // Add citation relationship
  async addCitation(citingPaper: string, citedPaper: string) {
    await this.ctx.relationManager.createRelations([{
      from: citingPaper,
      to: citedPaper,
      relationType: 'cites'
    }]);
  }

  // Add research note
  async addNote(note: {
    title: string;
    content: string;
    relatedPapers: string[];
    concepts: string[];
  }) {
    const noteId = `note_${Date.now()}`;

    await this.ctx.entityManager.createEntities([{
      name: noteId,
      entityType: 'note',
      observations: note.content.split('\n').filter(l => l.trim()),
      tags: ['note', ...note.concepts],
      importance: 6
    }]);

    // Link to papers
    for (const paper of note.relatedPapers) {
      await this.ctx.relationManager.createRelations([{
        from: noteId,
        to: paper,
        relationType: 'references'
      }]);
    }

    return noteId;
  }

  // Find papers by author
  async findPapersByAuthor(authorName: string): Promise<Entity[]> {
    const authorId = `author_${authorName.toLowerCase().replace(/\s+/g, '_')}`;
    const { outgoing } = await this.ctx.relationManager.getRelationsForEntity(authorId);

    const papers: Entity[] = [];
    for (const rel of outgoing.filter(r => r.relationType === 'authored')) {
      const paper = await this.ctx.entityManager.getEntityByName(rel.to);
      if (paper) papers.push(paper);
    }

    return papers;
  }

  // Find citation network
  async getCitationNetwork(paperId: string, depth: number = 2): Promise<KnowledgeGraph> {
    const visited = new Set<string>();
    const entities: Entity[] = [];
    const relations: Relation[] = [];

    async function traverse(id: string, currentDepth: number) {
      if (currentDepth > depth || visited.has(id)) return;
      visited.add(id);

      const entity = await this.ctx.entityManager.getEntityByName(id);
      if (entity) entities.push(entity);

      const { incoming, outgoing } = await this.ctx.relationManager.getRelationsForEntity(id);

      for (const rel of [...incoming, ...outgoing].filter(r => r.relationType === 'cites')) {
        relations.push(rel);
        const nextId = rel.from === id ? rel.to : rel.from;
        await traverse.call(this, nextId, currentDepth + 1);
      }
    }

    await traverse.call(this, paperId, 0);
    return { entities, relations };
  }

  // Find related concepts
  async findRelatedConcepts(query: string): Promise<SearchResult[]> {
    return this.ctx.searchManager.searchRanked(query, {
      tags: ['paper', 'note'],
      limit: 20
    });
  }
}

// Usage
const research = new ResearchGraph('./research.jsonl');

const paperId = await research.addPaper({
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'],
  abstract: 'We propose a new simple network architecture, the Transformer...',
  keywords: ['transformers', 'attention', 'deep-learning', 'nlp'],
  year: 2017,
  doi: '10.48550/arXiv.1706.03762'
});

await research.addNote({
  title: 'Transformer Architecture Notes',
  content: `Key insight: Self-attention allows parallelization.
Multi-head attention captures different relationships.
Positional encoding needed since no recurrence.`,
  relatedPapers: [paperId],
  concepts: ['attention', 'architecture']
});
```

---

## 5. Project Documentation Hub

Centralized documentation with cross-references.

### Documentation System

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

class DocumentationHub {
  private ctx: ManagerContext;

  constructor(path: string) {
    this.ctx = new ManagerContext(path);
  }

  // Create documentation category hierarchy
  async createCategory(name: string, parent?: string, description?: string) {
    await this.ctx.entityManager.createEntities([{
      name,
      entityType: 'category',
      observations: description ? [description] : [],
      tags: ['category'],
      importance: 8
    }]);

    if (parent) {
      await this.ctx.hierarchyManager.setEntityParent(name, parent);
    }
  }

  // Add documentation page
  async addPage(page: {
    slug: string;
    title: string;
    content: string;
    category: string;
    keywords: string[];
  }) {
    await this.ctx.entityManager.createEntities([{
      name: page.slug,
      entityType: 'page',
      observations: [
        `# ${page.title}`,
        '',
        ...page.content.split('\n')
      ],
      tags: ['page', ...page.keywords],
      importance: 6
    }]);

    // Set category as parent
    await this.ctx.hierarchyManager.setEntityParent(page.slug, page.category);
  }

  // Add cross-reference
  async addReference(fromPage: string, toPage: string) {
    await this.ctx.relationManager.createRelations([{
      from: fromPage,
      to: toPage,
      relationType: 'references'
    }]);
  }

  // Get table of contents
  async getTableOfContents(): Promise<TOCNode[]> {
    const roots = await this.ctx.hierarchyManager.getRootEntities();
    const categories = roots.filter(e => e.entityType === 'category');

    const toc: TOCNode[] = [];
    for (const cat of categories) {
      toc.push(await this.buildTOCNode(cat.name));
    }

    return toc;
  }

  private async buildTOCNode(name: string): Promise<TOCNode> {
    const entity = await this.ctx.entityManager.getEntityByName(name);
    const children = await this.ctx.hierarchyManager.getChildren(name);

    return {
      name,
      title: entity?.observations[0]?.replace('# ', '') || name,
      type: entity?.entityType || 'unknown',
      children: await Promise.all(children.map(c => this.buildTOCNode(c.name)))
    };
  }

  // Search documentation
  async search(query: string): Promise<SearchResult[]> {
    return this.ctx.searchManager.searchRanked(query, {
      tags: ['page'],
      limit: 20
    });
  }

  // Get page with related pages
  async getPage(slug: string): Promise<PageWithRelated | null> {
    const page = await this.ctx.entityManager.getEntityByName(slug);
    if (!page) return null;

    const { incoming, outgoing } = await this.ctx.relationManager.getRelationsForEntity(slug);

    const relatedPages: Entity[] = [];
    for (const rel of [...incoming, ...outgoing].filter(r => r.relationType === 'references')) {
      const relatedName = rel.from === slug ? rel.to : rel.from;
      const related = await this.ctx.entityManager.getEntityByName(relatedName);
      if (related) relatedPages.push(related);
    }

    return {
      page,
      related: relatedPages,
      breadcrumbs: await this.getBreadcrumbs(slug)
    };
  }

  private async getBreadcrumbs(slug: string): Promise<string[]> {
    const ancestors = await this.ctx.hierarchyManager.getAncestors(slug);
    return [...ancestors.map(a => a.name).reverse(), slug];
  }
}

interface TOCNode {
  name: string;
  title: string;
  type: string;
  children: TOCNode[];
}

interface PageWithRelated {
  page: Entity;
  related: Entity[];
  breadcrumbs: string[];
}

// Usage
const docs = new DocumentationHub('./docs.jsonl');

// Create hierarchy
await docs.createCategory('getting-started', undefined, 'Getting Started Guide');
await docs.createCategory('api', undefined, 'API Reference');
await docs.createCategory('core-api', 'api', 'Core API');

// Add pages
await docs.addPage({
  slug: 'installation',
  title: 'Installation',
  content: `Install using npm:\n\`\`\`bash\nnpm install memoryjs\n\`\`\``,
  category: 'getting-started',
  keywords: ['install', 'setup', 'npm']
});

await docs.addPage({
  slug: 'entity-manager',
  title: 'EntityManager API',
  content: `The EntityManager handles all entity CRUD operations...`,
  category: 'core-api',
  keywords: ['entity', 'crud', 'api']
});

// Cross-reference
await docs.addReference('installation', 'entity-manager');

// Get TOC
const toc = await docs.getTableOfContents();
console.log(JSON.stringify(toc, null, 2));
```

---

## 6. Contact Relationship Manager

Personal CRM for managing contacts and relationships.

### Contact Manager Implementation

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

class ContactManager {
  private ctx: ManagerContext;

  constructor(path: string) {
    this.ctx = new ManagerContext(path);
  }

  // Add a contact
  async addContact(contact: {
    name: string;
    email?: string;
    phone?: string;
    company?: string;
    role?: string;
    notes?: string[];
    tags?: string[];
  }) {
    const contactId = `contact_${contact.name.toLowerCase().replace(/\s+/g, '_')}`;

    const observations = [
      contact.email ? `Email: ${contact.email}` : '',
      contact.phone ? `Phone: ${contact.phone}` : '',
      contact.company ? `Company: ${contact.company}` : '',
      contact.role ? `Role: ${contact.role}` : '',
      ...(contact.notes || [])
    ].filter(Boolean);

    await this.ctx.entityManager.createEntities([{
      name: contactId,
      entityType: 'contact',
      observations,
      tags: ['contact', ...(contact.tags || [])],
      importance: 5
    }]);

    // Create company entity if specified
    if (contact.company) {
      const companyId = `company_${contact.company.toLowerCase().replace(/\s+/g, '_')}`;
      const existingCompany = await this.ctx.entityManager.getEntityByName(companyId);

      if (!existingCompany) {
        await this.ctx.entityManager.createEntities([{
          name: companyId,
          entityType: 'company',
          observations: [`Name: ${contact.company}`],
          tags: ['company'],
          importance: 6
        }]);
      }

      await this.ctx.relationManager.createRelations([{
        from: contactId,
        to: companyId,
        relationType: 'works_at'
      }]);
    }

    return contactId;
  }

  // Add relationship between contacts
  async addRelationship(
    contact1: string,
    contact2: string,
    relationship: string
  ) {
    await this.ctx.relationManager.createRelations([
      { from: contact1, to: contact2, relationType: relationship }
    ]);
  }

  // Log interaction
  async logInteraction(contactId: string, interaction: {
    type: 'meeting' | 'call' | 'email' | 'message';
    summary: string;
    date?: string;
  }) {
    const date = interaction.date || new Date().toISOString();

    await this.ctx.observationManager.addObservations([{
      entityName: contactId,
      contents: [`[${interaction.type.toUpperCase()}] ${date}: ${interaction.summary}`]
    }]);

    // Update last modified (touch)
    const contact = await this.ctx.entityManager.getEntityByName(contactId);
    if (contact) {
      await this.ctx.entityManager.updateEntity(contactId, {});
    }
  }

  // Find contacts at company
  async findContactsAtCompany(companyName: string): Promise<Entity[]> {
    const companyId = `company_${companyName.toLowerCase().replace(/\s+/g, '_')}`;
    const { incoming } = await this.ctx.relationManager.getRelationsForEntity(companyId);

    const contacts: Entity[] = [];
    for (const rel of incoming.filter(r => r.relationType === 'works_at')) {
      const contact = await this.ctx.entityManager.getEntityByName(rel.from);
      if (contact) contacts.push(contact);
    }

    return contacts;
  }

  // Get contact network
  async getNetwork(contactId: string, depth: number = 2): Promise<KnowledgeGraph> {
    return this.ctx.graphTraversal.findAllPaths(contactId, contactId, { maxDepth: depth })
      .then(async () => {
        // Get connected component
        const visited = new Set<string>();
        const entities: Entity[] = [];
        const relations: Relation[] = [];

        async function traverse(id: string, d: number) {
          if (d > depth || visited.has(id)) return;
          visited.add(id);

          const entity = await this.ctx.entityManager.getEntityByName(id);
          if (entity && entity.entityType === 'contact') {
            entities.push(entity);
          }

          const { incoming, outgoing } = await this.ctx.relationManager.getRelationsForEntity(id);
          for (const rel of [...incoming, ...outgoing]) {
            if (!relations.find(r =>
              r.from === rel.from && r.to === rel.to && r.relationType === rel.relationType
            )) {
              relations.push(rel);
            }
            const nextId = rel.from === id ? rel.to : rel.from;
            await traverse.call(this, nextId, d + 1);
          }
        }

        await traverse.call(this, contactId, 0);
        return { entities, relations };
      });
  }

  // Search contacts
  async searchContacts(query: string, filters?: {
    company?: string;
    tags?: string[];
  }): Promise<Entity[]> {
    const results = await this.ctx.searchManager.search(query, {
      tags: filters?.tags ? ['contact', ...filters.tags] : ['contact'],
      limit: 50
    });

    let contacts = results.entities;

    if (filters?.company) {
      contacts = contacts.filter(c =>
        c.observations.some(o => o.includes(`Company: ${filters.company}`))
      );
    }

    return contacts;
  }
}

// Usage
const crm = new ContactManager('./contacts.jsonl');

await crm.addContact({
  name: 'Alice Chen',
  email: 'alice@acme.com',
  company: 'Acme Corp',
  role: 'Engineering Manager',
  tags: ['engineering', 'decision-maker']
});

await crm.addContact({
  name: 'Bob Smith',
  email: 'bob@acme.com',
  company: 'Acme Corp',
  role: 'Senior Engineer',
  tags: ['engineering', 'technical']
});

await crm.addRelationship(
  'contact_alice_chen',
  'contact_bob_smith',
  'manages'
);

await crm.logInteraction('contact_alice_chen', {
  type: 'meeting',
  summary: 'Discussed Q4 project roadmap'
});

const acmeContacts = await crm.findContactsAtCompany('Acme Corp');
console.log(acmeContacts);
```

---

## 7. Learning Progress Tracker

Track learning progress across topics and resources.

### Learning Tracker Implementation

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

class LearningTracker {
  private ctx: ManagerContext;

  constructor(path: string) {
    this.ctx = new ManagerContext(path);
  }

  // Add learning topic
  async addTopic(topic: {
    name: string;
    description: string;
    parent?: string;
    prerequisites?: string[];
    importance?: number;
  }) {
    const topicId = topic.name.toLowerCase().replace(/\s+/g, '_');

    await this.ctx.entityManager.createEntities([{
      name: topicId,
      entityType: 'topic',
      observations: [
        topic.description,
        'Status: Not Started',
        'Progress: 0%'
      ],
      tags: ['topic', 'learning'],
      importance: topic.importance || 5
    }]);

    if (topic.parent) {
      await this.ctx.hierarchyManager.setEntityParent(topicId, topic.parent);
    }

    if (topic.prerequisites) {
      for (const prereq of topic.prerequisites) {
        await this.ctx.relationManager.createRelations([{
          from: topicId,
          to: prereq,
          relationType: 'requires'
        }]);
      }
    }

    return topicId;
  }

  // Add learning resource
  async addResource(resource: {
    title: string;
    type: 'book' | 'course' | 'video' | 'article' | 'tutorial';
    url?: string;
    topics: string[];
    estimatedHours?: number;
  }) {
    const resourceId = `resource_${Date.now()}`;

    await this.ctx.entityManager.createEntities([{
      name: resourceId,
      entityType: 'resource',
      observations: [
        `Title: ${resource.title}`,
        `Type: ${resource.type}`,
        resource.url ? `URL: ${resource.url}` : '',
        resource.estimatedHours ? `Estimated: ${resource.estimatedHours}h` : '',
        'Status: Not Started'
      ].filter(Boolean),
      tags: ['resource', resource.type],
      importance: 5
    }]);

    for (const topic of resource.topics) {
      await this.ctx.relationManager.createRelations([{
        from: resourceId,
        to: topic,
        relationType: 'covers'
      }]);
    }

    return resourceId;
  }

  // Update progress
  async updateProgress(
    entityId: string,
    progress: number,
    notes?: string
  ) {
    const entity = await this.ctx.entityManager.getEntityByName(entityId);
    if (!entity) throw new Error('Entity not found');

    // Update progress observation
    const observations = entity.observations.filter(o =>
      !o.startsWith('Progress:') && !o.startsWith('Status:')
    );

    const status = progress === 0 ? 'Not Started' :
                   progress === 100 ? 'Completed' : 'In Progress';

    observations.push(`Status: ${status}`);
    observations.push(`Progress: ${progress}%`);

    if (notes) {
      observations.push(`[${new Date().toISOString()}] ${notes}`);
    }

    await this.ctx.entityManager.updateEntity(entityId, { observations });
  }

  // Log learning session
  async logSession(session: {
    topic: string;
    duration: number; // minutes
    notes: string[];
    resources?: string[];
  }) {
    const sessionId = `session_${Date.now()}`;

    await this.ctx.entityManager.createEntities([{
      name: sessionId,
      entityType: 'session',
      observations: [
        `Duration: ${session.duration} minutes`,
        `Date: ${new Date().toISOString()}`,
        ...session.notes
      ],
      tags: ['session', 'learning'],
      importance: 3
    }]);

    await this.ctx.relationManager.createRelations([{
      from: sessionId,
      to: session.topic,
      relationType: 'studied'
    }]);

    if (session.resources) {
      for (const resource of session.resources) {
        await this.ctx.relationManager.createRelations([{
          from: sessionId,
          to: resource,
          relationType: 'used'
        }]);
      }
    }

    return sessionId;
  }

  // Get learning path
  async getLearningPath(targetTopic: string): Promise<string[]> {
    const path: string[] = [];
    const visited = new Set<string>();

    async function findPrerequisites(topicId: string): Promise<void> {
      if (visited.has(topicId)) return;
      visited.add(topicId);

      const { outgoing } = await this.ctx.relationManager.getRelationsForEntity(topicId);
      const prereqs = outgoing.filter(r => r.relationType === 'requires');

      for (const prereq of prereqs) {
        await findPrerequisites.call(this, prereq.to);
      }

      path.push(topicId);
    }

    await findPrerequisites.call(this, targetTopic);
    return path;
  }

  // Get learning statistics
  async getStats(): Promise<LearningStats> {
    const topics = await this.ctx.searchManager.search('', { tags: ['topic'] });
    const resources = await this.ctx.searchManager.search('', { tags: ['resource'] });
    const sessions = await this.ctx.searchManager.search('', { tags: ['session'] });

    const completed = topics.entities.filter(t =>
      t.observations.some(o => o.includes('Status: Completed'))
    );

    const inProgress = topics.entities.filter(t =>
      t.observations.some(o => o.includes('Status: In Progress'))
    );

    let totalMinutes = 0;
    for (const session of sessions.entities) {
      const durationObs = session.observations.find(o => o.startsWith('Duration:'));
      if (durationObs) {
        const match = durationObs.match(/Duration: (\d+)/);
        if (match) totalMinutes += parseInt(match[1]);
      }
    }

    return {
      totalTopics: topics.entities.length,
      completedTopics: completed.length,
      inProgressTopics: inProgress.length,
      totalResources: resources.entities.length,
      totalSessions: sessions.entities.length,
      totalLearningMinutes: totalMinutes
    };
  }
}

interface LearningStats {
  totalTopics: number;
  completedTopics: number;
  inProgressTopics: number;
  totalResources: number;
  totalSessions: number;
  totalLearningMinutes: number;
}

// Usage
const tracker = new LearningTracker('./learning.jsonl');

// Set up learning topics
await tracker.addTopic({
  name: 'javascript_basics',
  description: 'Fundamental JavaScript concepts'
});

await tracker.addTopic({
  name: 'typescript',
  description: 'TypeScript language and type system',
  prerequisites: ['javascript_basics']
});

await tracker.addTopic({
  name: 'react',
  description: 'React library for building UIs',
  prerequisites: ['javascript_basics']
});

await tracker.addTopic({
  name: 'nextjs',
  description: 'Next.js framework',
  prerequisites: ['react', 'typescript']
});

// Add resource
const resource = await tracker.addResource({
  title: 'TypeScript Handbook',
  type: 'tutorial',
  url: 'https://www.typescriptlang.org/docs/',
  topics: ['typescript'],
  estimatedHours: 10
});

// Log learning session
await tracker.logSession({
  topic: 'typescript',
  duration: 45,
  notes: [
    'Learned about generics',
    'Practiced with utility types'
  ],
  resources: [resource]
});

// Update progress
await tracker.updateProgress('typescript', 30, 'Completed generics section');

// Get path to learn Next.js
const path = await tracker.getLearningPath('nextjs');
console.log('Learning path:', path);
// ['javascript_basics', 'typescript', 'react', 'nextjs']

// Get stats
const stats = await tracker.getStats();
console.log(stats);
```

---

## 8. Content Recommendation Engine

Tag-based content recommendation system.

### Recommendation Engine

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

class RecommendationEngine {
  private ctx: ManagerContext;

  constructor(path: string) {
    this.ctx = new ManagerContext(path);
  }

  // Add content item
  async addContent(content: {
    id: string;
    title: string;
    description: string;
    tags: string[];
    category: string;
    metadata?: Record<string, string>;
  }) {
    await this.ctx.entityManager.createEntities([{
      name: content.id,
      entityType: 'content',
      observations: [
        `Title: ${content.title}`,
        `Description: ${content.description}`,
        `Category: ${content.category}`,
        ...Object.entries(content.metadata || {}).map(([k, v]) => `${k}: ${v}`)
      ],
      tags: ['content', content.category, ...content.tags],
      importance: 5
    }]);
  }

  // Record user interaction
  async recordInteraction(userId: string, contentId: string, type: 'view' | 'like' | 'save' | 'share') {
    const userEntity = `user_${userId}`;

    // Ensure user exists
    const existing = await this.ctx.entityManager.getEntityByName(userEntity);
    if (!existing) {
      await this.ctx.entityManager.createEntities([{
        name: userEntity,
        entityType: 'user',
        observations: [],
        tags: ['user'],
        importance: 5
      }]);
    }

    // Create interaction relation
    await this.ctx.relationManager.createRelations([{
      from: userEntity,
      to: contentId,
      relationType: type
    }]);

    // Increase content importance based on interaction
    const content = await this.ctx.entityManager.getEntityByName(contentId);
    if (content) {
      const boost = { view: 0, like: 1, save: 1, share: 2 }[type];
      const newImportance = Math.min(10, (content.importance || 5) + boost);
      await this.ctx.entityManager.setImportance(contentId, newImportance);
    }
  }

  // Get user preferences from interactions
  async getUserPreferences(userId: string): Promise<Map<string, number>> {
    const userEntity = `user_${userId}`;
    const { outgoing } = await this.ctx.relationManager.getRelationsForEntity(userEntity);

    const tagScores = new Map<string, number>();

    for (const rel of outgoing) {
      const content = await this.ctx.entityManager.getEntityByName(rel.to);
      if (!content || content.entityType !== 'content') continue;

      // Weight by interaction type
      const weight = { view: 1, like: 3, save: 4, share: 5 }[rel.relationType] || 1;

      for (const tag of content.tags || []) {
        if (tag === 'content') continue;
        tagScores.set(tag, (tagScores.get(tag) || 0) + weight);
      }
    }

    return tagScores;
  }

  // Get recommendations
  async getRecommendations(userId: string, limit: number = 10): Promise<Entity[]> {
    const preferences = await this.getUserPreferences(userId);
    const userEntity = `user_${userId}`;

    // Get content user has interacted with
    const { outgoing } = await this.ctx.relationManager.getRelationsForEntity(userEntity);
    const interactedContent = new Set(outgoing.map(r => r.to));

    // Get all content
    const allContent = await this.ctx.searchManager.search('', { tags: ['content'] });

    // Score content by preference match
    const scored: Array<{ entity: Entity; score: number }> = [];

    for (const entity of allContent.entities) {
      // Skip already interacted
      if (interactedContent.has(entity.name)) continue;

      // Calculate preference score
      let score = 0;
      for (const tag of entity.tags || []) {
        score += preferences.get(tag) || 0;
      }

      // Boost by importance
      score += (entity.importance || 5) / 2;

      scored.push({ entity, score });
    }

    // Sort by score and return top N
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.entity);
  }

  // Get similar content
  async getSimilarContent(contentId: string, limit: number = 5): Promise<Entity[]> {
    const content = await this.ctx.entityManager.getEntityByName(contentId);
    if (!content) return [];

    const tags = content.tags || [];

    // Search for content with overlapping tags
    const results = await this.ctx.searchManager.search(tags.join(' '), {
      tags: ['content'],
      limit: limit + 1
    });

    // Filter out the source content
    return results.entities.filter(e => e.name !== contentId).slice(0, limit);
  }
}

// Usage
const recommender = new RecommendationEngine('./recommendations.db');

// Add content
await recommender.addContent({
  id: 'article_1',
  title: 'Introduction to TypeScript',
  description: 'Learn the basics of TypeScript',
  tags: ['typescript', 'programming', 'beginner'],
  category: 'tutorial'
});

await recommender.addContent({
  id: 'article_2',
  title: 'Advanced TypeScript Patterns',
  description: 'Deep dive into TypeScript patterns',
  tags: ['typescript', 'programming', 'advanced'],
  category: 'tutorial'
});

await recommender.addContent({
  id: 'video_1',
  title: 'React with TypeScript',
  description: 'Building React apps with TypeScript',
  tags: ['react', 'typescript', 'frontend'],
  category: 'video'
});

// Record user interactions
await recommender.recordInteraction('user123', 'article_1', 'view');
await recommender.recordInteraction('user123', 'article_1', 'like');

// Get recommendations
const recommendations = await recommender.getRecommendations('user123', 5);
console.log('Recommendations:', recommendations.map(r => r.name));

// Get similar content
const similar = await recommender.getSimilarContent('article_1');
console.log('Similar:', similar.map(s => s.name));
```

---

## 9. Codebase Knowledge Graph

Map and navigate a codebase structure.

### Codebase Graph

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

class CodebaseGraph {
  private ctx: ManagerContext;

  constructor(path: string) {
    this.ctx = new ManagerContext(path);
  }

  // Add module
  async addModule(module: {
    name: string;
    path: string;
    description: string;
    exports: string[];
  }) {
    await this.ctx.entityManager.createEntities([{
      name: module.name,
      entityType: 'module',
      observations: [
        `Path: ${module.path}`,
        `Description: ${module.description}`,
        `Exports: ${module.exports.join(', ')}`
      ],
      tags: ['module', 'code'],
      importance: 7
    }]);
  }

  // Add function/class
  async addSymbol(symbol: {
    name: string;
    type: 'function' | 'class' | 'interface' | 'type' | 'const';
    module: string;
    signature: string;
    description: string;
    examples?: string[];
  }) {
    await this.ctx.entityManager.createEntities([{
      name: symbol.name,
      entityType: symbol.type,
      observations: [
        `Signature: ${symbol.signature}`,
        `Description: ${symbol.description}`,
        ...(symbol.examples || []).map(e => `Example: ${e}`)
      ],
      tags: ['symbol', symbol.type],
      importance: 5
    }]);

    // Link to module
    await this.ctx.hierarchyManager.setEntityParent(symbol.name, symbol.module);
  }

  // Add dependency
  async addDependency(from: string, to: string, type: 'imports' | 'extends' | 'implements' | 'uses') {
    await this.ctx.relationManager.createRelations([{
      from,
      to,
      relationType: type
    }]);
  }

  // Find all usages of a symbol
  async findUsages(symbolName: string): Promise<Entity[]> {
    const { incoming } = await this.ctx.relationManager.getRelationsForEntity(symbolName);

    const usages: Entity[] = [];
    for (const rel of incoming.filter(r => r.relationType === 'uses' || r.relationType === 'imports')) {
      const entity = await this.ctx.entityManager.getEntityByName(rel.from);
      if (entity) usages.push(entity);
    }

    return usages;
  }

  // Get module structure
  async getModuleStructure(moduleName: string): Promise<KnowledgeGraph> {
    return this.ctx.hierarchyManager.getSubtree(moduleName);
  }

  // Search code
  async searchCode(query: string): Promise<SearchResult[]> {
    return this.ctx.searchManager.searchRanked(query, {
      tags: ['symbol'],
      limit: 20
    });
  }

  // Get dependency graph
  async getDependencyGraph(): Promise<string> {
    return this.ctx.ioManager.exportGraph('mermaid', {
      filter: { tags: ['module'] }
    });
  }
}

// Usage
const codebase = new CodebaseGraph('./codebase.jsonl');

// Add modules
await codebase.addModule({
  name: 'core',
  path: 'src/core',
  description: 'Core storage and managers',
  exports: ['EntityManager', 'RelationManager', 'GraphStorage']
});

await codebase.addModule({
  name: 'search',
  path: 'src/search',
  description: 'Search implementations',
  exports: ['SearchManager', 'BasicSearch', 'RankedSearch']
});

// Add symbols
await codebase.addSymbol({
  name: 'EntityManager',
  type: 'class',
  module: 'core',
  signature: 'class EntityManager',
  description: 'Manages entity CRUD operations',
  examples: ['const em = new EntityManager(storage)']
});

await codebase.addSymbol({
  name: 'createEntities',
  type: 'function',
  module: 'core',
  signature: 'async createEntities(entities: Entity[]): Promise<Entity[]>',
  description: 'Creates multiple entities'
});

// Add dependencies
await codebase.addDependency('search', 'core', 'imports');
await codebase.addDependency('SearchManager', 'EntityManager', 'uses');

// Find usages
const usages = await codebase.findUsages('EntityManager');
console.log('EntityManager usages:', usages.map(u => u.name));

// Get dependency visualization
const diagram = await codebase.getDependencyGraph();
console.log(diagram);
```

---

## 10. Meeting Notes & Action Items

Track meetings, decisions, and action items.

### Meeting Tracker

```typescript
import { ManagerContext } from '@danielsimonjr/memoryjs';

class MeetingTracker {
  private ctx: ManagerContext;

  constructor(path: string) {
    this.ctx = new ManagerContext(path);
  }

  // Create meeting
  async createMeeting(meeting: {
    title: string;
    date: string;
    attendees: string[];
    agenda: string[];
    notes?: string[];
  }) {
    const meetingId = `meeting_${Date.now()}`;

    await this.ctx.entityManager.createEntities([{
      name: meetingId,
      entityType: 'meeting',
      observations: [
        `Title: ${meeting.title}`,
        `Date: ${meeting.date}`,
        `Attendees: ${meeting.attendees.join(', ')}`,
        '---',
        'Agenda:',
        ...meeting.agenda.map(a => `- ${a}`),
        ...(meeting.notes ? ['---', 'Notes:', ...meeting.notes] : [])
      ],
      tags: ['meeting'],
      importance: 6
    }]);

    // Create attendee entities and relationships
    for (const attendee of meeting.attendees) {
      const attendeeId = `person_${attendee.toLowerCase().replace(/\s+/g, '_')}`;

      const existing = await this.ctx.entityManager.getEntityByName(attendeeId);
      if (!existing) {
        await this.ctx.entityManager.createEntities([{
          name: attendeeId,
          entityType: 'person',
          observations: [`Name: ${attendee}`],
          tags: ['person'],
          importance: 5
        }]);
      }

      await this.ctx.relationManager.createRelations([{
        from: attendeeId,
        to: meetingId,
        relationType: 'attended'
      }]);
    }

    return meetingId;
  }

  // Add decision
  async addDecision(meetingId: string, decision: {
    description: string;
    rationale?: string;
    owner?: string;
  }) {
    const decisionId = `decision_${Date.now()}`;

    await this.ctx.entityManager.createEntities([{
      name: decisionId,
      entityType: 'decision',
      observations: [
        decision.description,
        decision.rationale ? `Rationale: ${decision.rationale}` : '',
        decision.owner ? `Owner: ${decision.owner}` : ''
      ].filter(Boolean),
      tags: ['decision'],
      importance: 7
    }]);

    await this.ctx.relationManager.createRelations([{
      from: decisionId,
      to: meetingId,
      relationType: 'decided_in'
    }]);

    return decisionId;
  }

  // Add action item
  async addActionItem(meetingId: string, action: {
    description: string;
    assignee: string;
    dueDate?: string;
    priority?: 'high' | 'medium' | 'low';
  }) {
    const actionId = `action_${Date.now()}`;

    await this.ctx.entityManager.createEntities([{
      name: actionId,
      entityType: 'action_item',
      observations: [
        action.description,
        `Assignee: ${action.assignee}`,
        action.dueDate ? `Due: ${action.dueDate}` : '',
        `Priority: ${action.priority || 'medium'}`,
        'Status: Open'
      ].filter(Boolean),
      tags: ['action', 'open', action.priority || 'medium'],
      importance: action.priority === 'high' ? 9 : action.priority === 'low' ? 4 : 6
    }]);

    await this.ctx.relationManager.createRelations([
      { from: actionId, to: meetingId, relationType: 'created_in' }
    ]);

    // Link to assignee
    const assigneeId = `person_${action.assignee.toLowerCase().replace(/\s+/g, '_')}`;
    await this.ctx.relationManager.createRelations([{
      from: actionId,
      to: assigneeId,
      relationType: 'assigned_to'
    }]);

    return actionId;
  }

  // Update action item status
  async updateActionStatus(actionId: string, status: 'open' | 'in-progress' | 'completed' | 'blocked') {
    const action = await this.ctx.entityManager.getEntityByName(actionId);
    if (!action) throw new Error('Action not found');

    // Update status observation
    const observations = action.observations.filter(o => !o.startsWith('Status:'));
    observations.push(`Status: ${status}`);

    await this.ctx.entityManager.updateEntity(actionId, { observations });

    // Update tags
    await this.ctx.entityManager.removeTags(actionId, ['open', 'in-progress', 'completed', 'blocked']);
    await this.ctx.entityManager.addTags(actionId, [status]);
  }

  // Get open actions for person
  async getOpenActions(personName: string): Promise<Entity[]> {
    const personId = `person_${personName.toLowerCase().replace(/\s+/g, '_')}`;
    const { incoming } = await this.ctx.relationManager.getRelationsForEntity(personId);

    const actions: Entity[] = [];
    for (const rel of incoming.filter(r => r.relationType === 'assigned_to')) {
      const action = await this.ctx.entityManager.getEntityByName(rel.from);
      if (action && action.tags?.includes('open')) {
        actions.push(action);
      }
    }

    return actions;
  }

  // Get meeting history for person
  async getMeetingHistory(personName: string): Promise<Entity[]> {
    const personId = `person_${personName.toLowerCase().replace(/\s+/g, '_')}`;
    const { outgoing } = await this.ctx.relationManager.getRelationsForEntity(personId);

    const meetings: Entity[] = [];
    for (const rel of outgoing.filter(r => r.relationType === 'attended')) {
      const meeting = await this.ctx.entityManager.getEntityByName(rel.to);
      if (meeting) meetings.push(meeting);
    }

    return meetings.sort((a, b) => {
      const dateA = a.observations.find(o => o.startsWith('Date:'))?.replace('Date: ', '') || '';
      const dateB = b.observations.find(o => o.startsWith('Date:'))?.replace('Date: ', '') || '';
      return dateB.localeCompare(dateA);
    });
  }

  // Search across meetings and decisions
  async search(query: string): Promise<SearchResult[]> {
    return this.ctx.searchManager.searchRanked(query, {
      tags: ['meeting', 'decision', 'action'],
      limit: 20
    });
  }
}

// Usage
const meetings = new MeetingTracker('./meetings.jsonl');

const meetingId = await meetings.createMeeting({
  title: 'Q1 Planning',
  date: '2024-01-15',
  attendees: ['Alice Chen', 'Bob Smith', 'Carol Davis'],
  agenda: [
    'Review Q4 results',
    'Set Q1 OKRs',
    'Assign project leads'
  ],
  notes: [
    'Q4 exceeded targets by 15%',
    'Focus on mobile app this quarter'
  ]
});

await meetings.addDecision(meetingId, {
  description: 'Prioritize mobile app development',
  rationale: 'Mobile traffic up 40% YoY',
  owner: 'Alice Chen'
});

await meetings.addActionItem(meetingId, {
  description: 'Create mobile app RFC',
  assignee: 'Bob Smith',
  dueDate: '2024-01-22',
  priority: 'high'
});

// Get open actions for Bob
const bobActions = await meetings.getOpenActions('Bob Smith');
console.log('Bob\'s open actions:', bobActions.map(a => a.observations[0]));

// Search for mobile-related items
const mobileItems = await meetings.search('mobile app');
console.log('Mobile-related items:', mobileItems.map(r => r.entity.name));
```

---

## Summary

These use cases demonstrate the flexibility of MemoryJS for building various knowledge management applications:

| Use Case | Key Features Used |
|----------|------------------|
| Personal Knowledge Base | Hierarchy, Relations, Search |
| AI Chatbot Memory | Entity CRUD, Hybrid Search, Relations |
| RAG System | Semantic Search, Vector Store, Relations |
| Research Notes | Hierarchy, Relations, Graph Traversal |
| Documentation Hub | Hierarchy, Search, Export |
| Contact CRM | Relations, Search, Tags |
| Learning Tracker | Hierarchy, Relations, Analytics |
| Recommendations | Tags, Relations, Search |
| Codebase Graph | Hierarchy, Relations, Export |
| Meeting Tracker | Relations, Search, Tags |

Each implementation can be adapted and combined based on your specific requirements.

---

**Document Version**: 1.0
**Last Updated**: 2026-01-12
