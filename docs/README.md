# Documentation index

Every Markdown file under `docs/` (154 files at the time of writing), grouped by folder. Start with
`architecture/OVERVIEW.md` for the project shape and `development/DEVELOPMENT_SETUP.md` to work on the code.
The roadmap is `roadmap/ROADMAP.md`. Descriptions are one line each; the file names are the source of truth.

## `docs/architecture/`

How the library is built: architecture, API surface, data flow and generated reference. (14 files)

- [`AGENT_MEMORY.md`](architecture/AGENT_MEMORY.md): Design of the agent memory system (short- and long-term memory).
- [`API.md`](architecture/API.md): API reference for the library surface and transaction primitives.
- [`ARCHITECTURE.md`](architecture/ARCHITECTURE.md): System architecture: layers, components and their interactions.
- [`COMPONENTS.md`](architecture/COMPONENTS.md): Component reference: what each major module does.
- [`DATAFLOW.md`](architecture/DATAFLOW.md): How data moves through reads, writes, search and persistence.
- [`DEPENDENCY_GRAPH.md`](architecture/DEPENDENCY_GRAPH.md): Generated module dependency graph and exports (from `repo-tools map`).
- [`FILE_INVENTORY.md`](architecture/FILE_INVENTORY.md): Generated inventory of every source file.
- [`KNOWLEDGE_GRAPH_CORE_FEASIBILITY.md`](architecture/KNOWLEDGE_GRAPH_CORE_FEASIBILITY.md): Feasibility study for making the knowledge graph the core of the library.
- [`OVERVIEW.md`](architecture/OVERVIEW.md): Short project overview for new readers.
- [`TEST_COVERAGE.md`](architecture/TEST_COVERAGE.md): Test coverage analysis by module.
- [`Toctou_and_Batch_Transaction_Design.md`](architecture/Toctou_and_Batch_Transaction_Design.md): Design for the TOCTOU race fix and BatchTransaction partial-save behaviour.
- [`duplicate-symbols.md`](architecture/duplicate-symbols.md): List of duplicate symbol names across the source tree.
- [`mmap-binding-decision-gate.md`](architecture/mmap-binding-decision-gate.md): Decision gate for adopting a native mmap binding.
- [`unused-analysis.md`](architecture/unused-analysis.md): Unused files and exports found by static analysis.

## `docs/development/`

Contributing: setup, testing, style, debugging, release, decisions and reviews. (12 files)

- [`ARCHITECTURE_DECISIONS.md`](development/ARCHITECTURE_DECISIONS.md): Architecture decision records (ADRs).
- [`AUDIT_2026-11-04.md`](development/AUDIT_2026-11-04.md): Optimization and completion audit of 2026-11-04.
- [`CLONES_REVIEW_2026-11-05.md`](development/CLONES_REVIEW_2026-11-05.md): Review of `repo-tools clones` output from 2026-11-05.
- [`CODE_STYLE.md`](development/CODE_STYLE.md): Code style conventions.
- [`DEBUGGING_GUIDE.md`](development/DEBUGGING_GUIDE.md): How to debug common failures in tests and storage.
- [`DESIGN_PASS_2026-11-04.md`](development/DESIGN_PASS_2026-11-04.md): Design pass of 2026-11-04 with owner decisions.
- [`DEVELOPMENT_SETUP.md`](development/DEVELOPMENT_SETUP.md): Setting up a development environment (Bun, Node, native addons).
- [`OPTIMIZATION_OPPORTUNITIES.md`](development/OPTIMIZATION_OPPORTUNITIES.md): Ranked list of speed and security optimisation opportunities.
- [`RECURSA_SPEC_2026-11-06.md`](development/RECURSA_SPEC_2026-11-06.md): Recursa spec and phase plan; §4.1 maps each phase and RS item to its shipped PR.
- [`RELEASE_PROCESS.md`](development/RELEASE_PROCESS.md): Steps to cut and publish a release.
- [`REVIEW-2026-09-12.md`](development/REVIEW-2026-09-12.md): Performance, stability and security review of 2026-09-12.
- [`TESTING_GUIDE.md`](development/TESTING_GUIDE.md): How the test suite is organised and how to run it.

## `docs/guides/`

Using the library: configuration, API reference, recipes, migration and security. (10 files)

- [`AGENT_INTEGRATION.md`](guides/AGENT_INTEGRATION.md): Integrating an AI agent with the memory system.
- [`API_REFERENCE.md`](guides/API_REFERENCE.md): Method-by-method API reference.
- [`CONFIGURATION.md`](guides/CONFIGURATION.md): Every environment variable and configuration option.
- [`IMPLEMENTATION_GUIDE.md`](guides/IMPLEMENTATION_GUIDE.md): Implementation patterns for contributors.
- [`MIGRATION_GUIDE.md`](guides/MIGRATION_GUIDE.md): Upgrading between versions and migrating storage backends.
- [`PERFORMANCE_TUNING.md`](guides/PERFORMANCE_TUNING.md): Tuning SQLite, JSONL and search for speed.
- [`QUICK_REFERENCE.md`](guides/QUICK_REFERENCE.md): One-page reference of the most used calls.
- [`RECIPES.md`](guides/RECIPES.md): Short recipes for common tasks.
- [`SECURITY_GUIDE.md`](guides/SECURITY_GUIDE.md): Security model, input handling and access controls.
- [`USE_CASES.md`](guides/USE_CASES.md): Worked use cases with example code.

## `docs/planning/`

Implementation plans for phases and features that are being built. (7 files)

- [`CLI_Update_Plan.md`](planning/CLI_Update_Plan.md): Plan for updating the CLI commands.
- [`FUTURE_FEATURES_IMPLEMENTATION_PLAN.md`](planning/FUTURE_FEATURES_IMPLEMENTATION_PLAN.md): Implementation plan for future features.
- [`PHASE_1_FOUNDATION_IMPLEMENTATION_PLAN.md`](planning/PHASE_1_FOUNDATION_IMPLEMENTATION_PLAN.md): Phase 1 foundation implementation plan.
- [`PHASE_1_REFACTORING_PLAN.md`](planning/PHASE_1_REFACTORING_PLAN.md): Phase 1 refactoring plan.
- [`PHASE_3_AGENT_MEMORY_IMPLEMENTATION_PLAN.md`](planning/PHASE_3_AGENT_MEMORY_IMPLEMENTATION_PLAN.md): Agent memory system implementation plan.
- [`PHASE_TEST_COVERAGE_IMPLEMENTATION_PLAN.md`](planning/PHASE_TEST_COVERAGE_IMPLEMENTATION_PLAN.md): Test coverage implementation plan.
- [`PROCEDURAL_GRAPH_FEATURE_PLAN.md`](planning/PROCEDURAL_GRAPH_FEATURE_PLAN.md): Procedural graph feature plan (requirements PG-01 to PG-16).

## `docs/plans/`

Short fix and refactor plans for specific findings. (4 files)

- [`ALT_FINDINGS_FIX_PLAN.md`](plans/ALT_FINDINGS_FIX_PLAN.md): Fix plan for findings outside the clone refactor.
- [`CLONES_REFACTOR_PLAN.md`](plans/CLONES_REFACTOR_PLAN.md): Plan for refactoring duplicate clones.
- [`CLONES_REFACTOR_PLAN_ALT.md`](plans/CLONES_REFACTOR_PLAN_ALT.md): Alternative clone refactor plan (K001 to K051).
- [`EMMA_M1_M3_PLAN.md`](plans/EMMA_M1_M3_PLAN.md): EMMA research track, items M1 to M3.

## `docs/roadmap/`

What is planned next, gap analyses and idea backlogs. ROADMAP.md is the tracker. (19 files)

- [`CLAWVAULT_IDEAS.md`](roadmap/CLAWVAULT_IDEAS.md): Ideas taken from ClawVault.
- [`CLAWVAULT_IMPLEMENTATION_PLAN.md`](roadmap/CLAWVAULT_IMPLEMENTATION_PLAN.md): Review and implementation plan for the ClawVault ideas.
- [`CONTEXT_ENGINE_PRD.md`](roadmap/CONTEXT_ENGINE_PRD.md): Product requirements for the context engine.
- [`CONTEXT_ENGINE_WHITEPAPER.md`](roadmap/CONTEXT_ENGINE_WHITEPAPER.md): Essay on context engineering as an architecture.
- [`FEASIBILITY_REPORT.md`](roadmap/FEASIBILITY_REPORT.md): Feasibility report on paper-derived ideas.
- [`GAP_ANALYSIS_VS_MEMPALACE.md`](roadmap/GAP_ANALYSIS_VS_MEMPALACE.md): Gap analysis against MemPalace.
- [`GAP_ANALYSIS_VS_SUPERMEMORY.md`](roadmap/GAP_ANALYSIS_VS_SUPERMEMORY.md): Gap analysis against Supermemory.
- [`HEURISTIC_3B8_PLAN.md`](roadmap/HEURISTIC_3B8_PLAN.md): Minimum-viable plan for the heuristic guidelines manager (3B.8).
- [`IMPLEMENTATION_PLAN_MUST_HAVE.md`](roadmap/IMPLEMENTATION_PLAN_MUST_HAVE.md): Implementation plan for the must-have features.
- [`IMPLEMENTATION_PLAN_SHOULD_HAVE.md`](roadmap/IMPLEMENTATION_PLAN_SHOULD_HAVE.md): Implementation plan for the should-have features.
- [`MEMORILLA_LATENT_MEMORY_PLAN.md`](roadmap/MEMORILLA_LATENT_MEMORY_PLAN.md): Research note and plan for latent semantic memory (Memorilla).
- [`MEMORY_TYPES_EXPANSION.md`](roadmap/MEMORY_TYPES_EXPANSION.md): Gap analysis and design sketch for new memory types.
- [`MEMORY_TYPES_EXPANSION_PHASE_2.md`](roadmap/MEMORY_TYPES_EXPANSION_PHASE_2.md): Planning for memory-types expansion, phase 2.
- [`MEMORY_TYPES_EXPANSION_PHASE_3.md`](roadmap/MEMORY_TYPES_EXPANSION_PHASE_3.md): Plan for memory-types expansion, phase 3 (shipped).
- [`OBSERVATION_DEDUP_PLAN.md`](roadmap/OBSERVATION_DEDUP_PLAN.md): Plan for entity-level observation de-duplication.
- [`PAPER_IDEAS_ROADMAP.md`](roadmap/PAPER_IDEAS_ROADMAP.md): Roadmap v2.0 built from paper ideas.
- [`ROADMAP.md`](roadmap/ROADMAP.md): Forward-looking work tracker; shipped items are struck through.
- [`TOOL_AFFORDANCE_PLAN.md`](roadmap/TOOL_AFFORDANCE_PLAN.md): Plan for tool affordance memory.
- [`future_features.md`](roadmap/future_features.md): Short list of future feature ideas.

## `docs/analysis/`

One-off audits and reviews of the codebase. (5 files)

- [`CLONES_REMAINING.md`](analysis/CLONES_REMAINING.md): Clone-detection findings still open after the refactor pass.
- [`CODE_REVIEW.md`](analysis/CODE_REVIEW.md): Code review report with findings and their status.
- [`DUPLICATE_FUNCTION_AUDIT.md`](analysis/DUPLICATE_FUNCTION_AUDIT.md): Audit of duplicated functions and where they live.
- [`SIMPLIFICATION_AUDIT.md`](analysis/SIMPLIFICATION_AUDIT.md): Audit of code that can be simplified without behaviour change.
- [`optimization-review.md`](analysis/optimization-review.md): Speed, stability and security review of the codebase.

## `docs/superpowers/specs/`

Design documents written before the agent-driven plans. (8 files)

- [`2026-04-09-supermemory-gap-closing-design.md`](superpowers/specs/2026-04-09-supermemory-gap-closing-design.md): Design for the supermemory gap-closing sprint.
- [`2026-04-10-compress-for-context-design.md`](superpowers/specs/2026-04-10-compress-for-context-design.md): Design for `compressForContext()` on the context window manager.
- [`2026-04-10-mempalace-gap-closing-design.md`](superpowers/specs/2026-04-10-mempalace-gap-closing-design.md): Design for the MemPalace gap-closing release (v1.9.0).
- [`2026-04-16-memory-engine-core-design.md`](superpowers/specs/2026-04-16-memory-engine-core-design.md): Design for the memory engine core.
- [`2026-04-16-memory-engine-decay-extensions-design.md`](superpowers/specs/2026-04-16-memory-engine-decay-extensions-design.md): Design for memory engine decay extensions.
- [`2026-04-24-skip-inventory.md`](superpowers/specs/2026-04-24-skip-inventory.md): Inventory of skipped performance benchmarks.
- [`2026-04-24-storage-wireup-trace.md`](superpowers/specs/2026-04-24-storage-wireup-trace.md): Trace of how storage is wired up.
- [`_archived-2026-04-16-context-engine-memory-engine-design.md`](superpowers/specs/_archived-2026-04-16-context-engine-memory-engine-design.md): Archived, superseded design for the context engine (kept for history).

## `docs/superpowers/plans/`

Agent-driven implementation plans. (15 files)

- [`2026-04-09-supermemory-gap-closing.md`](superpowers/plans/2026-04-09-supermemory-gap-closing.md): Supermemory gap-closing (sprint 1) implementation plan.
- [`2026-04-10-mempalace-gap-closing.md`](superpowers/plans/2026-04-10-mempalace-gap-closing.md): MemPalace gap-closing (v1.9.0) implementation plan.
- [`2026-04-16-memory-engine-core-plan.md`](superpowers/plans/2026-04-16-memory-engine-core-plan.md): Memory engine core implementation plan.
- [`2026-04-24-backlog-execution-phases.md`](superpowers/plans/2026-04-24-backlog-execution-phases.md): Backlog execution phases, agent-driven plan.
- [`2026-04-24-task-dispatch-runbook.md`](superpowers/plans/2026-04-24-task-dispatch-runbook.md): Runbook for dispatching tasks to agents.
- [`2026-04-25-3b-memory-theory.md`](superpowers/plans/2026-04-25-3b-memory-theory.md): Memory theory extensions plan (§3B.4 to §3B.7).
- [`2026-04-25-eta-collaboration.md`](superpowers/plans/2026-04-25-eta-collaboration.md): Collaboration features plan (η.5.5).
- [`2026-04-25-eta-database-adapters.md`](superpowers/plans/2026-04-25-eta-database-adapters.md): Database adapters plan (η.4.1).
- [`2026-04-25-eta-enterprise.md`](superpowers/plans/2026-04-25-eta-enterprise.md): Enterprise features plan (η.6).
- [`2026-04-25-eta-graph-visualization.md`](superpowers/plans/2026-04-25-eta-graph-visualization.md): Graph visualisation expansion plan (η.4.6).
- [`2026-04-25-eta-ml-features.md`](superpowers/plans/2026-04-25-eta-ml-features.md): ML-powered features plan (η.5.3).
- [`2026-04-25-eta-rest-api.md`](superpowers/plans/2026-04-25-eta-rest-api.md): REST API generation plan (η.4.2).
- [`2026-04-25-eta-standards-compliance.md`](superpowers/plans/2026-04-25-eta-standards-compliance.md): Standards compliance plan: SPARQL, RDF and linked data (η.5.4).
- [`2026-04-25-eta-temporal-versioning.md`](superpowers/plans/2026-04-25-eta-temporal-versioning.md): Temporal versioning expansion plan (η.4.4).
- [`2026-09-10-procedural-graph-implementation.md`](superpowers/plans/2026-09-10-procedural-graph-implementation.md): Subagent-driven implementation plan for the procedural graph.

## `docs/superpowers/plans/task_chunks/`

Auto-split chunks of the supermemory gap-closing plan, one file per task. (41 files)

- [`001-supermemory-gap-closing-sprint-1-implementation-pl.md`](superpowers/plans/task_chunks/001-supermemory-gap-closing-sprint-1-implementation-pl.md): Task chunk 001 of the Supermemory gap-closing (sprint 1) plan: Supermemory gap closing sprint 1 implementation pl.
- [`002-prerequisites.md`](superpowers/plans/task_chunks/002-prerequisites.md): Task chunk 002 of the Supermemory gap-closing (sprint 1) plan: Prerequisites.
- [`003-phase-0-entity-model-foundation.md`](superpowers/plans/task_chunks/003-phase-0-entity-model-foundation.md): Task chunk 003 of the Supermemory gap-closing (sprint 1) plan: Phase 0 entity model foundation.
- [`004-task-0-1-add-version-scoping-fields-to-entity-type.md`](superpowers/plans/task_chunks/004-task-0-1-add-version-scoping-fields-to-entity-type.md): Task chunk 004 of the Supermemory gap-closing (sprint 1) plan: Task 0 1 add version scoping fields to entity type.
- [`005-task-0-2-update-graphstorage-jsonl-to-persist-new-.md`](superpowers/plans/task_chunks/005-task-0-2-update-graphstorage-jsonl-to-persist-new-.md): Task chunk 005 of the Supermemory gap-closing (sprint 1) plan: Task 0 2 update graphstorage jsonl to persist new.
- [`006-task-0-3-update-sqlitestorage-to-persist-new-field.md`](superpowers/plans/task_chunks/006-task-0-3-update-sqlitestorage-to-persist-new-field.md): Task chunk 006 of the Supermemory gap-closing (sprint 1) plan: Task 0 3 update sqlitestorage to persist new field.
- [`007-phase-1-feature-1-project-scoping.md`](superpowers/plans/task_chunks/007-phase-1-feature-1-project-scoping.md): Task chunk 007 of the Supermemory gap-closing (sprint 1) plan: Phase 1 feature 1 project scoping.
- [`008-task-1-1-add-projectid-to-searchfilterchain.md`](superpowers/plans/task_chunks/008-task-1-1-add-projectid-to-searchfilterchain.md): Task chunk 008 of the Supermemory gap-closing (sprint 1) plan: Task 1 1 add projectid to searchfilterchain.
- [`009-task-1-2-wire-defaultprojectid-into-managercontext.md`](superpowers/plans/task_chunks/009-task-1-2-wire-defaultprojectid-into-managercontext.md): Task chunk 009 of the Supermemory gap-closing (sprint 1) plan: Task 1 2 wire defaultprojectid into managercontext.
- [`010-task-1-3-auto-stamp-projectid-on-entity-creation.md`](superpowers/plans/task_chunks/010-task-1-3-auto-stamp-projectid-on-entity-creation.md): Task chunk 010 of the Supermemory gap-closing (sprint 1) plan: Task 1 3 auto stamp projectid on entity creation.
- [`011-task-1-4-propagate-projectid-through-searchmanager.md`](superpowers/plans/task_chunks/011-task-1-4-propagate-projectid-through-searchmanager.md): Task chunk 011 of the Supermemory gap-closing (sprint 1) plan: Task 1 4 propagate projectid through searchmanager.
- [`012-task-1-5-add-listprojects-method-to-entitymanager.md`](superpowers/plans/task_chunks/012-task-1-5-add-listprojects-method-to-entitymanager.md): Task chunk 012 of the Supermemory gap-closing (sprint 1) plan: Task 1 5 add listprojects method to entitymanager.
- [`013-task-1-6-phase-1-verification-gate.md`](superpowers/plans/task_chunks/013-task-1-6-phase-1-verification-gate.md): Task chunk 013 of the Supermemory gap-closing (sprint 1) plan: Task 1 6 phase 1 verification gate.
- [`014-phase-2-feature-2-memory-versioning-contradiction-.md`](superpowers/plans/task_chunks/014-phase-2-feature-2-memory-versioning-contradiction-.md): Task chunk 014 of the Supermemory gap-closing (sprint 1) plan: Phase 2 feature 2 memory versioning contradiction.
- [`015-task-2-1-create-contradictiondetector-class-detect.md`](superpowers/plans/task_chunks/015-task-2-1-create-contradictiondetector-class-detect.md): Task chunk 015 of the Supermemory gap-closing (sprint 1) plan: Task 2 1 create contradictiondetector class detect.
- [`016-task-2-2-implement-contradictiondetector-supersede.md`](superpowers/plans/task_chunks/016-task-2-2-implement-contradictiondetector-supersede.md): Task chunk 016 of the Supermemory gap-closing (sprint 1) plan: Task 2 2 implement contradictiondetector supersede.
- [`017-task-2-3-filter-superseded-entities-by-default.md`](superpowers/plans/task_chunks/017-task-2-3-filter-superseded-entities-by-default.md): Task chunk 017 of the Supermemory gap-closing (sprint 1) plan: Task 2 3 filter superseded entities by default.
- [`018-task-2-4-hook-contradictiondetector-into-observati.md`](superpowers/plans/task_chunks/018-task-2-4-hook-contradictiondetector-into-observati.md): Task chunk 018 of the Supermemory gap-closing (sprint 1) plan: Task 2 4 hook contradictiondetector into observati.
- [`019-task-2-5-add-version-chain-navigation-methods.md`](superpowers/plans/task_chunks/019-task-2-5-add-version-chain-navigation-methods.md): Task chunk 019 of the Supermemory gap-closing (sprint 1) plan: Task 2 5 add version chain navigation methods.
- [`020-task-2-6-guard-compressionmanager-against-merging-.md`](superpowers/plans/task_chunks/020-task-2-6-guard-compressionmanager-against-merging-.md): Task chunk 020 of the Supermemory gap-closing (sprint 1) plan: Task 2 6 guard compressionmanager against merging.
- [`021-task-2-7-phase-2-verification-gate.md`](superpowers/plans/task_chunks/021-task-2-7-phase-2-verification-gate.md): Task chunk 021 of the Supermemory gap-closing (sprint 1) plan: Task 2 7 phase 2 verification gate.
- [`022-phase-3-feature-3-semantic-forget.md`](superpowers/plans/task_chunks/022-phase-3-feature-3-semantic-forget.md): Task chunk 022 of the Supermemory gap-closing (sprint 1) plan: Phase 3 feature 3 semantic forget.
- [`023-task-3-1-create-semanticforget-class-exact-match-p.md`](superpowers/plans/task_chunks/023-task-3-1-create-semanticforget-class-exact-match-p.md): Task chunk 023 of the Supermemory gap-closing (sprint 1) plan: Task 3 1 create semanticforget class exact match p.
- [`024-task-3-2-implement-semantic-fallback-path.md`](superpowers/plans/task_chunks/024-task-3-2-implement-semantic-fallback-path.md): Task chunk 024 of the Supermemory gap-closing (sprint 1) plan: Task 3 2 implement semantic fallback path.
- [`025-task-3-3-wire-semanticforget-into-managercontext.md`](superpowers/plans/task_chunks/025-task-3-3-wire-semanticforget-into-managercontext.md): Task chunk 025 of the Supermemory gap-closing (sprint 1) plan: Task 3 3 wire semanticforget into managercontext.
- [`026-task-3-4-phase-3-verification-gate.md`](superpowers/plans/task_chunks/026-task-3-4-phase-3-verification-gate.md): Task chunk 026 of the Supermemory gap-closing (sprint 1) plan: Task 3 4 phase 3 verification gate.
- [`027-phase-4-feature-4-user-profile-entity-backed.md`](superpowers/plans/task_chunks/027-phase-4-feature-4-user-profile-entity-backed.md): Task chunk 027 of the Supermemory gap-closing (sprint 1) plan: Phase 4 feature 4 user profile entity backed.
- [`028-task-4-1-add-profileentity-type-and-guards.md`](superpowers/plans/task_chunks/028-task-4-1-add-profileentity-type-and-guards.md): Task chunk 028 of the Supermemory gap-closing (sprint 1) plan: Task 4 1 add profileentity type and guards.
- [`029-task-4-2-reserve-profile-namespace-in-entitymanage.md`](superpowers/plans/task_chunks/029-task-4-2-reserve-profile-namespace-in-entitymanage.md): Task chunk 029 of the Supermemory gap-closing (sprint 1) plan: Task 4 2 reserve profile namespace in entitymanage.
- [`030-task-4-3-create-profilemanager-getprofile-addfact-.md`](superpowers/plans/task_chunks/030-task-4-3-create-profilemanager-getprofile-addfact-.md): Task chunk 030 of the Supermemory gap-closing (sprint 1) plan: Task 4 3 create profilemanager getprofile addfact.
- [`031-task-4-4-add-session-based-fact-extraction.md`](superpowers/plans/task_chunks/031-task-4-4-add-session-based-fact-extraction.md): Task chunk 031 of the Supermemory gap-closing (sprint 1) plan: Task 4 4 add session based fact extraction.
- [`032-task-4-5-wire-profilemanager-into-agentmemorymanag.md`](superpowers/plans/task_chunks/032-task-4-5-wire-profilemanager-into-agentmemorymanag.md): Task chunk 032 of the Supermemory gap-closing (sprint 1) plan: Task 4 5 wire profilemanager into agentmemorymanag.
- [`033-task-4-6-phase-4-verification-gate.md`](superpowers/plans/task_chunks/033-task-4-6-phase-4-verification-gate.md): Task chunk 033 of the Supermemory gap-closing (sprint 1) plan: Task 4 6 phase 4 verification gate.
- [`034-phase-5-release-prep.md`](superpowers/plans/task_chunks/034-phase-5-release-prep.md): Task chunk 034 of the Supermemory gap-closing (sprint 1) plan: Phase 5 release prep.
- [`035-task-5-1-update-changelog-and-bump-version.md`](superpowers/plans/task_chunks/035-task-5-1-update-changelog-and-bump-version.md): Task chunk 035 of the Supermemory gap-closing (sprint 1) plan: Task 5 1 update changelog and bump version.
- [`036-1-8-0-2026-04-09.md`](superpowers/plans/task_chunks/036-1-8-0-2026-04-09.md): Task chunk 036 of the Supermemory gap-closing (sprint 1) plan: 1 8 0 2026 04 09.
- [`037-added.md`](superpowers/plans/task_chunks/037-added.md): Task chunk 037 of the Supermemory gap-closing (sprint 1) plan: Added.
- [`038-changed.md`](superpowers/plans/task_chunks/038-changed.md): Task chunk 038 of the Supermemory gap-closing (sprint 1) plan: Changed.
- [`039-storage.md`](superpowers/plans/task_chunks/039-storage.md): Task chunk 039 of the Supermemory gap-closing (sprint 1) plan: Storage.
- [`040-related.md`](superpowers/plans/task_chunks/040-related.md): Task chunk 040 of the Supermemory gap-closing (sprint 1) plan: Related.
- [`041-self-review-checklist.md`](superpowers/plans/task_chunks/041-self-review-checklist.md): Task chunk 041 of the Supermemory gap-closing (sprint 1) plan: Self review checklist.

## `docs/superpowers/plans/v19_chunks/`

Auto-split chunks of the MemPalace gap-closing plan, one file per task. (19 files)

- [`001-mempalace-gap-closing-v1-9-0-implementation-plan.md`](superpowers/plans/v19_chunks/001-mempalace-gap-closing-v1-9-0-implementation-plan.md): Task chunk 001 of the MemPalace gap-closing (v1.9.0) plan: Mempalace gap closing v1 9 0 implementation plan.
- [`002-prerequisites.md`](superpowers/plans/v19_chunks/002-prerequisites.md): Task chunk 002 of the MemPalace gap-closing (v1.9.0) plan: Prerequisites.
- [`003-task-1-add-invalidaterelation-to-relationmanager.md`](superpowers/plans/v19_chunks/003-task-1-add-invalidaterelation-to-relationmanager.md): Task chunk 003 of the MemPalace gap-closing (v1.9.0) plan: Task 1 add invalidaterelation to relationmanager.
- [`004-task-2-add-queryasof-and-timeline-to-relationmanag.md`](superpowers/plans/v19_chunks/004-task-2-add-queryasof-and-timeline-to-relationmanag.md): Task chunk 004 of the MemPalace gap-closing (v1.9.0) plan: Task 2 add queryasof and timeline to relationmanag.
- [`005-task-3-add-wakeup-to-contextwindowmanager.md`](superpowers/plans/v19_chunks/005-task-3-add-wakeup-to-contextwindowmanager.md): Task chunk 005 of the MemPalace gap-closing (v1.9.0) plan: Task 3 add wakeup to contextwindowmanager.
- [`006-task-4-add-ingest-to-iomanager.md`](superpowers/plans/v19_chunks/006-task-4-add-ingest-to-iomanager.md): Task chunk 006 of the MemPalace gap-closing (v1.9.0) plan: Task 4 add ingest to iomanager.
- [`007-task-5-add-writediary-and-readdiary-to-agentmemory.md`](superpowers/plans/v19_chunks/007-task-5-add-writediary-and-readdiary-to-agentmemory.md): Task chunk 007 of the MemPalace gap-closing (v1.9.0) plan: Task 5 add writediary and readdiary to agentmemory.
- [`008-task-6-zero-config-semantic-search.md`](superpowers/plans/v19_chunks/008-task-6-zero-config-semantic-search.md): Task chunk 008 of the MemPalace gap-closing (v1.9.0) plan: Task 6 zero config semantic search.
- [`009-task-7-auto-save-hooks.md`](superpowers/plans/v19_chunks/009-task-7-auto-save-hooks.md): Task chunk 009 of the MemPalace gap-closing (v1.9.0) plan: Task 7 auto save hooks.
- [`010-auto-save-hook-for-claude-code-fires-on-stop-event.md`](superpowers/plans/v19_chunks/010-auto-save-hook-for-claude-code-fires-on-stop-event.md): Task chunk 010 of the MemPalace gap-closing (v1.9.0) plan: Auto save hook for claude code fires on stop event.
- [`011-creates-a-session-save-entity-with-timestamp.md`](superpowers/plans/v19_chunks/011-creates-a-session-save-entity-with-timestamp.md): Task chunk 011 of the MemPalace gap-closing (v1.9.0) plan: Creates a session save entity with timestamp.
- [`012-emergency-save-hook-fires-before-context-compressi.md`](superpowers/plans/v19_chunks/012-emergency-save-hook-fires-before-context-compressi.md): Task chunk 012 of the MemPalace gap-closing (v1.9.0) plan: Emergency save hook fires before context compressi.
- [`013-synchronous-blocks-until-complete.md`](superpowers/plans/v19_chunks/013-synchronous-blocks-until-complete.md): Task chunk 013 of the MemPalace gap-closing (v1.9.0) plan: Synchronous blocks until complete.
- [`014-memoryjs-auto-save-hooks.md`](superpowers/plans/v19_chunks/014-memoryjs-auto-save-hooks.md): Task chunk 014 of the MemPalace gap-closing (v1.9.0) plan: Memoryjs auto save hooks.
- [`015-setup.md`](superpowers/plans/v19_chunks/015-setup.md): Task chunk 015 of the MemPalace gap-closing (v1.9.0) plan: Setup.
- [`016-hooks.md`](superpowers/plans/v19_chunks/016-hooks.md): Task chunk 016 of the MemPalace gap-closing (v1.9.0) plan: Hooks.
- [`017-task-8-release-prep-v1-9-0.md`](superpowers/plans/v19_chunks/017-task-8-release-prep-v1-9-0.md): Task chunk 017 of the MemPalace gap-closing (v1.9.0) plan: Task 8 release prep v1 9 0.
- [`018-1-9-0-2026-04-10.md`](superpowers/plans/v19_chunks/018-1-9-0-2026-04-10.md): Task chunk 018 of the MemPalace gap-closing (v1.9.0) plan: 1 9 0 2026 04 10.
- [`019-self-review.md`](superpowers/plans/v19_chunks/019-self-review.md): Task chunk 019 of the MemPalace gap-closing (v1.9.0) plan: Self review.
