# MemoryJS Auto-Save Hooks

Shell scripts for Claude Code that automatically save memories during work.

## Setup

Add to your Claude Code `settings.json`:

```json
{
  "hooks": {
    "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "/path/to/hooks/memoryjs_save_hook.sh"}]}],
    "PreCompact": [{"matcher": "", "hooks": [{"type": "command", "command": "/path/to/hooks/memoryjs_precompact_hook.sh"}]}]
  }
}
```

## Hooks

- **Save Hook**: Fires on every Stop event. Creates a session-save entity.
- **PreCompact Hook**: Fires before context compression. Synchronous emergency save.

Both use `$MEMORY_FILE_PATH` env var (default: `~/.memoryjs/memory.jsonl`).
