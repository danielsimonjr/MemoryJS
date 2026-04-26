# MemoryJS Paper Ideas — Feasibility Report

Generated 2026-03-24 by 3 parallel code-explorer agents reviewing actual codebase.
**Last refreshed: 2026-04-25** — codebase has advanced significantly since this report. Items previously marked HARD or INFRASTRUCTURE may now be EASY because dependencies are now in place. See [`docs/superpowers/plans/2026-04-24-task-dispatch-runbook.md`](../superpowers/plans/2026-04-24-task-dispatch-runbook.md) for the current shipped/gated status of Phase η work.

## Summary

| Verdict | Count | Features |
|---------|-------|----------|
| IMPLEMENT | 21 | High feasibility, clear integration points |
| DEFER | 7 | Feasible but blocked or premature |
| CUT | 4 | Impractical or misaligned |

## MUST-HAVE Tier

| # | Feature | Feasibility | Effort | Verdict |
|---|---------|-------------|--------|---------|
| 1 | RL-Trained Memory Manager Agent | Hard | XL | DEFER — no reward signal exists |
| 2 | Memory Distillation Policy | Medium | M | IMPLEMENT — leverages existing SummarizationService + SearchFilterChain |
| 3 | Stable Index Dereferencing | Easy | S | IMPLEMENT — foundational, Entity.name already unique |
| 4 | Dual-Layer Memory Architecture | Easy | L | IMPLEMENT — already the intended WorkingMemory + Archive design |
| 5 | Artifact-Level Granularity | Easy | S | IMPLEMENT — depends on #3 |
| 6 | Spatial Coordinate Indexing | Hard | L | DEFER — no use case demonstrated |
| 7 | Temporal Range Queries | Easy | S-M | IMPLEMENT — add chrono-node for relative time parsing |
| 8 | Multi-modal Observation Storage | Hard | XL | DEFER — add discriminated union type stubs NOW |
| 9 | LLM Query Planner | Medium | M | IMPLEMENT — as optional module with API key |
| 10 | Dynamic Memory Governance Loop | Medium | M-L | IMPLEMENT foundation (transactions/rollback), defer full loop |
| 11 | Temporal Governance & Freshness | Easy-Medium | M | IMPLEMENT — alongside DecayEngine |
| 12 | Latent Vector Memory Encoding | Hard/Medium | L/XL | IMPLEMENT additive (text+vector), defer replacement |
| 13 | N-gram Hashing | Medium | M | IMPLEMENT — as FuzzySearch prefilter optimizer |

## SHOULD-HAVE Tier

| # | Feature | Feasibility | Effort | Verdict |
|---|---------|-------------|--------|---------|
| 1 | Collaborative Memory Synthesis | Medium | M | IMPLEMENT — GraphTraversal + SalienceEngine compose cleanly |
| 2 | Role-Aware Memory Customization | Easy | S | IMPLEMENT — config wiring on existing SalienceEngine weights |
| 3 | Shared Memory Visibility Hierarchies | Medium | L | IMPLEMENT — fix agent metadata persistence first |
| 4 | Entropy-Aware Filtering | Easy | S | IMPLEMENT — Shannon entropy on existing tokenizer |
| 5 | Recursive Memory Consolidation | Easy | S | IMPLEMENT — compose DecayScheduler pattern + ConsolidationPipeline |
| 6 | Failure-Driven Memory Distillation | Medium | M | IMPLEMENT — EpisodicMemoryManager causal relations already exist |
| 7 | Reasoning Strategy Abstraction | Medium-Hard | L | DEFER — needs procedural memory subsystem first |
| 8 | Visual Salience Budget Allocation | Easy | S | IMPLEMENT — MemoryFormatter proportional allocation |
| 9 | Visual Layout Hierarchy | Hard | XL | CUT — reframe as salience-weighted DOT/Mermaid export |
| 10 | Dual-Channel Evaluation | Hard | XL | DEFER — needs evaluation infrastructure |
| 11 | Cognitive Load Metrics | Medium | M | IMPLEMENT — token density + redundancy ratio |

## COULD-HAVE Tier

| # | Feature | Feasibility | Effort | Verdict |
|---|---------|-------------|--------|---------|
| 1 | Experience Card Schema | Medium | M | IMPLEMENT — procedural MemoryType + PipelineStage hooks ready |
| 2 | Dual-Layer Retrieval Protocol | Medium | M | DEFER — hard dependency on Experience Cards |
| 3 | Agentic Multi-Round Search | Easy | S | IMPLEMENT — ReflectionManager already does this, add interactive API |
| 4 | Async Graph Propagation | Hard | XL | CUT — unclear value, convergence concerns |
| 5 | Multi-Agent Utility Visibility | Medium | M | IMPLEMENT — simplified access-count version |
| 6 | Stability-Plasticity Dashboard | Medium | S | IMPLEMENT — snapshot report via DecayEngine |
| 7 | Information Density Metrics | Hard | XL | CUT — requires embeddings, repackages existing analytics |
| 8 | Memory Automation Framework | Impractical | XL | CUT — no feedback signal, ML research problem |
| 9 | Intent Classification Layer | Medium | M | IMPLEMENT — predefined TaskType taxonomy |

## Recommended Implementation Order

### Sprint 1: Quick Wins (S effort, 1-2 days each)
1. Stable Index Dereferencing (#M3)
2. Artifact-Level Granularity (#M5)
3. Temporal Range Queries (#M7)
4. Role-Aware Memory Customization (#S2)
5. Entropy-Aware Filtering (#S4)
6. Recursive Memory Consolidation (#S5)
7. Visual Salience Budget Allocation (#S8)
8. Agentic Multi-Round Search interactive API (#C3)
9. Stability-Plasticity Dashboard snapshot (#C6)

### Sprint 2: Medium Features (M effort, 3-5 days each)
10. Memory Distillation Policy (#M2)
11. Temporal Governance & Freshness (#M11)
12. N-gram Hashing (#M13)
13. LLM Query Planner (#M9)
14. Collaborative Memory Synthesis (#S1)
15. Failure-Driven Memory Distillation (#S6)
16. Cognitive Load Metrics (#S11)
17. Experience Card Schema (#C1)
18. Multi-Agent Utility Visibility (#C5)
19. Intent Classification Layer (#C9)

### Sprint 3: Large Features (L effort, 1-2 weeks each)
20. Dual-Layer Memory Architecture (#M4)
21. Dynamic Governance foundation (#M10)
22. Shared Memory Visibility Hierarchies (#S3)
23. Latent Vector Memory Encoding additive (#M12)

## Cross-Cutting Issues

1. **Multi-modal type stubs**: Add `Observation` discriminated union (`text | image | file`) to Entity type NOW, before any data migrates
2. **Agent metadata persistence**: `MultiAgentMemoryManager.agents` map is in-memory only — fix before Features S2, S3, S6
3. **Procedural memory type**: Exists in MemoryType enum but completely unimplemented — Features S6, S7, C1 all need it
