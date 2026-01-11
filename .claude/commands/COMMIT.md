---
description: Full project commit workflow - typecheck, test, version bump, changelog, and push to GitHub
allowed-tools: ["Bash", "Read", "Edit", "Write", "Glob", "Grep"]
argument-hint: "<major|minor|patch> <description>"
---

# Project Commit Workflow

Execute a complete commit workflow with quality checks and version management.

## Arguments

- **Version Type** (required): `major`, `minor`, or `patch`
  - `major` - Breaking changes, major features (1.0.0 → 2.0.0)
  - `minor` - New features, enhancements (1.0.0 → 1.1.0)
  - `patch` - Bug fixes, cleanup, debug (1.0.0 → 1.0.1)

- **Description** (required): Brief description of changes for changelog

## Workflow Steps

Execute these steps in order. **Stop immediately if any step fails.**

### Step 1: Pre-flight Checks

```bash
git status
```

Verify:
- Working directory is clean or has only expected changes
- On correct branch (usually `master`)

### Step 2: TypeScript Type Check

```bash
npm run typecheck
```

**STOP if typecheck fails.** Fix type errors before continuing.

### Step 3: Run Tests

```bash
npm test
```

**STOP if tests fail.** Fix failing tests before continuing.

### Step 4: Version Bump

Read current version from `package.json`, then increment based on version type:

| Type | Example |
|------|---------|
| major | 1.2.1 → 2.0.0 |
| minor | 1.2.1 → 1.3.0 |
| patch | 1.2.1 → 1.2.2 |

Update `package.json` with new version.

### Step 5: Update CHANGELOG.md

Add new section at top of changelog (after header):

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added/Changed/Fixed

- **Category**: Description of changes
  - Detail 1
  - Detail 2
```

Use appropriate section header:
- `### Added` - New features
- `### Changed` - Changes to existing features
- `### Fixed` - Bug fixes
- `### Removed` - Removed features

### Step 6: Update CLAUDE.md

Update test count if tests were added. Update version reference if present.

### Step 7: Git Commit

```bash
git add -A && git commit -m "$(cat <<'EOF'
<type>: v<version> - <description>

<detailed bullet points of changes>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

Commit type prefixes:
- `feat:` for major/minor (new features)
- `fix:` for patch (bug fixes)
- `chore:` for maintenance/cleanup
- `docs:` for documentation only

### Step 8: Push to GitHub

```bash
git push
```

### Step 9: Summary

Report final status:
- New version number
- Commit hash
- Number of files changed
- Test results summary

## Example Usage

```
/COMMIT minor "Add parallel processing for graph algorithms"
/COMMIT patch "Fix test report cleanup"
/COMMIT major "Breaking API changes for v2"
```

## Error Handling

If any step fails:
1. Report the failure clearly
2. Do NOT continue to subsequent steps
3. Suggest how to fix the issue
4. User must re-run `/COMMIT` after fixing
