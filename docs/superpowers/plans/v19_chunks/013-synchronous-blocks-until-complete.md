# Synchronous (blocks until complete)

MEMORY_FILE="${MEMORY_FILE_PATH:-$HOME/.memoryjs/memory.jsonl}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

memoryjs entity create \
  --name "precompact-save-${TIMESTAMP}" \
  --type "session-save" \
  --observation "Emergency save before compaction at ${TIMESTAMP}" \
  --tag "auto-save" --tag "precompact" \
  --storage "$MEMORY_FILE" || true
```

- [x] **Step 3: Create README**

Create `hooks/README.md`:

```markdown