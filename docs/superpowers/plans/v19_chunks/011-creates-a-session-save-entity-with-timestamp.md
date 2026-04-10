# Creates a session-save entity with timestamp

MEMORY_FILE="${MEMORY_FILE_PATH:-$HOME/.memoryjs/memory.jsonl}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

memoryjs entity create \
  --name "session-save-${TIMESTAMP}" \
  --type "session-save" \
  --observation "Auto-saved at ${TIMESTAMP}" \
  --tag "auto-save" \
  --storage "$MEMORY_FILE" 2>/dev/null || true
```

- [ ] **Step 2: Create precompact hook**

Create `hooks/memoryjs_precompact_hook.sh`:

```bash
#!/bin/bash