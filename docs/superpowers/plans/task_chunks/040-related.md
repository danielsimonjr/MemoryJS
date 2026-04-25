### Related
- Design spec: `docs/superpowers/specs/2026-04-09-supermemory-gap-closing-design.md`
- Gap analysis: `docs/roadmap/GAP_ANALYSIS_VS_SUPERMEMORY.md`
```

- [x] **Step 3: Update gap analysis status**

In `docs/roadmap/GAP_ANALYSIS_VS_SUPERMEMORY.md`, update the "Recommended Implementation Order" table. For rows #1-#4 (Profile, Semantic Forget, Versioning, Project Scoping), change Status column from "Not started" to "✅ v1.8.0".

- [x] **Step 4: Final verification**

Run: `SKIP_BENCHMARKS=true npm test 2>&1 | tail -20 && npm run typecheck && npm run build`
Expected: all pass.

- [x] **Step 5: Commit**

Message:

```
chore(release): Bump version to 1.8.0

Sprint 1 supermemory gap-closing complete:
- Project Scoping
- Memory Versioning / Contradiction Resolution
- Semantic Forget
- User Profile (Entity-backed)
```

---
