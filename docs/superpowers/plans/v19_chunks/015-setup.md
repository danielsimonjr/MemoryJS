## Setup

Add to your Claude Code `settings.json`:

\`\`\`json
{
  "hooks": {
    "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "/path/to/hooks/memoryjs_save_hook.sh"}]}],
    "PreCompact": [{"matcher": "", "hooks": [{"type": "command", "command": "/path/to/hooks/memoryjs_precompact_hook.sh"}]}]
  }
}
\`\`\`
