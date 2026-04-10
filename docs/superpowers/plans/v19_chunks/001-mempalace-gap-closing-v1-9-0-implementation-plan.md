# MemPalace Gap-Closing (v1.9.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7 features from mempalace gap analysis to memoryjs v1.9.0, extending existing managers (Approach A — no new classes).

**Architecture:** All features are methods added to existing classes: `RelationManager` (temporal KG), `ContextWindowManager` (wake-up), `IOManager` (ingest), `AgentMemoryManager` (diary). Plus config changes (zero-config semantic) and tooling (hooks, benchmarks).

**Tech Stack:** TypeScript, Vitest, better-sqlite3, ChromaDB-compatible local embeddings (ONNX), Zod. Branch `feature/mempalace-gap` off master.

**Source spec:** `docs/superpowers/specs/2026-04-10-mempalace-gap-closing-design.md`

---
