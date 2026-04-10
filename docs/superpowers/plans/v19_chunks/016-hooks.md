## Hooks

- **Save Hook**: Fires on every Stop event. Creates a session-save entity.
- **PreCompact Hook**: Fires before context compression. Synchronous emergency save.

Both use `$MEMORY_FILE_PATH` env var (default: `~/.memoryjs/memory.jsonl`).
```

- [ ] **Step 4: Make scripts executable**

```bash
chmod +x hooks/memoryjs_save_hook.sh hooks/memoryjs_precompact_hook.sh
```

- [ ] **Step 5: Commit**

```
feat(hooks): Add auto-save hooks for Claude Code

Save hook (Stop event) and PreCompact hook for automatic
session memory preservation. Shell scripts calling memoryjs CLI.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

---
