## Self-Review Checklist

- [ ] **Spec coverage:** Every section of the design spec has a task. Phase 0 = Entity model. Phase 1 = Project Scoping. Phase 2 = Memory Versioning. Phase 3 = Semantic Forget. Phase 4 = User Profile. Phase 5 = Release prep.
- [ ] **No placeholders:** Every code step has actual code. No "TBD" or "TODO".
- [ ] **Type consistency:** `Contradiction[]` in Task 2.1 matches usage in 2.2 and 2.4. `ForgetResult` stable from 3.1. `ProfileResponse` stable from 4.3.
- [ ] **TDD:** Every task has Test → Fail → Implement → Pass → Commit.
- [ ] **Frequent commits:** ~20 commits across the plan, one per task.
- [ ] **YAGNI:** No features beyond the spec.
- [ ] **Feature-vertical:** Phases 1-4 each independently shippable as v1.8.0-alpha.N.

