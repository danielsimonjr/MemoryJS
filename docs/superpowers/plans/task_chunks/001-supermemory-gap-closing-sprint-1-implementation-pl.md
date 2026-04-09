# Supermemory Gap-Closing (Sprint 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four features to memoryjs that close the Sprint 1 MUST gap with supermemory: Project Scoping, Memory Versioning with Contradiction Resolution, Semantic Forget, and User Profile — while preserving memoryjs's local-first architecture.

**Architecture:** Feature-vertical approach (B). Each feature is implemented end-to-end in dependency order: Scoping → Versioning → Forget → Profile. All four features share Entity model additions that land first. Each feature is independently testable, committable, and releasable as a minor version bump.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, async-mutex, tsup, Zod. Target Node.js >=18. Base branch `feature/must-have-8`, target version v1.8.0.

**Source spec:** `docs/superpowers/specs/2026-04-09-supermemory-gap-closing-design.md`

---
