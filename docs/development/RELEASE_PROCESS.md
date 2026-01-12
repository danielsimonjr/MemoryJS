# Release Process

Guide to releasing new versions of MemoryJS.

## Table of Contents

1. [Versioning](#versioning)
2. [Release Checklist](#release-checklist)
3. [Version Bumping](#version-bumping)
4. [Changelog Management](#changelog-management)
5. [Publishing to npm](#publishing-to-npm)
6. [GitHub Releases](#github-releases)
7. [Post-Release](#post-release)
8. [Hotfix Process](#hotfix-process)

---

## Versioning

MemoryJS follows [Semantic Versioning](https://semver.org/):

```
MAJOR.MINOR.PATCH

Examples:
1.0.0 -> 1.0.1  (patch: bug fix)
1.0.1 -> 1.1.0  (minor: new feature, backward compatible)
1.1.0 -> 2.0.0  (major: breaking change)
```

### Version Guidelines

| Change Type | Version Bump | Examples |
|-------------|--------------|----------|
| Bug fixes | PATCH | Fix search returning wrong results |
| New features (backward compatible) | MINOR | Add new export format |
| Performance improvements | PATCH or MINOR | Optimize search algorithm |
| Documentation | PATCH | Fix typos, add examples |
| Breaking API changes | MAJOR | Rename method, change return type |
| Removing deprecated features | MAJOR | Remove old API |

### Pre-release Versions

```
1.2.0-alpha.1   # Alpha (unstable, incomplete)
1.2.0-beta.1    # Beta (feature complete, testing)
1.2.0-rc.1      # Release candidate (final testing)
1.2.0           # Stable release
```

---

## Release Checklist

### Before Release

- [ ] All tests passing: `npm test`
- [ ] Type check passing: `npm run typecheck`
- [ ] Build successful: `npm run build`
- [ ] No uncommitted changes: `git status`
- [ ] On main branch: `git branch --show-current`
- [ ] Main is up to date: `git pull origin main`

### Release Steps

- [ ] Update version in `package.json`
- [ ] Update `CHANGELOG.md`
- [ ] Commit version bump
- [ ] Create git tag
- [ ] Push to GitHub
- [ ] Publish to npm
- [ ] Create GitHub release

### After Release

- [ ] Verify npm package: `npm view @danielsimonjr/memoryjs`
- [ ] Test installation: `npm install @danielsimonjr/memoryjs@latest`
- [ ] Update documentation site (if applicable)
- [ ] Announce release (if significant)

---

## Version Bumping

### Using npm version

```bash
# Patch release (1.0.0 -> 1.0.1)
npm version patch

# Minor release (1.0.0 -> 1.1.0)
npm version minor

# Major release (1.0.0 -> 2.0.0)
npm version major

# Pre-release
npm version prerelease --preid=alpha  # 1.0.0 -> 1.0.1-alpha.0
npm version prerelease --preid=beta   # 1.0.1-alpha.0 -> 1.0.1-beta.0
```

### Manual Version Bump

```bash
# 1. Update package.json
# Change "version": "1.0.0" to "version": "1.1.0"

# 2. Commit
git add package.json package-lock.json
git commit -m "chore: bump version to 1.1.0"

# 3. Tag
git tag -a v1.1.0 -m "Release 1.1.0"

# 4. Push
git push origin main
git push origin v1.1.0
```

---

## Changelog Management

### CHANGELOG.md Format

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- New features not yet released

### Changed
- Changes to existing functionality

### Deprecated
- Features to be removed in future

### Removed
- Removed features

### Fixed
- Bug fixes

### Security
- Security fixes

## [1.1.0] - 2024-03-15

### Added
- BM25 search algorithm for improved ranking
- GraphML export format
- Entity archiving feature

### Changed
- Improved TF-IDF performance by 40%
- Updated better-sqlite3 to v9.4.0

### Fixed
- Fixed search pagination offset bug (#123)
- Fixed memory leak in fuzzy search (#125)

## [1.0.0] - 2024-01-15

### Added
- Initial release
- Entity and relation management
- Multiple search strategies
- JSONL and SQLite storage backends
```

### Writing Changelog Entries

**Good entries**:
```markdown
### Added
- Add `hybridSearch()` method combining semantic, lexical, and symbolic search
- Add support for Mermaid diagram export via `exportGraph('mermaid')`

### Fixed
- Fix `searchRanked()` returning unsorted results when limit exceeded (#123)
- Fix memory leak when creating many entities in a loop
```

**Bad entries**:
```markdown
### Added
- Added stuff
- New feature

### Fixed
- Fixed bug
- Updated code
```

---

## Publishing to npm

### First-time Setup

```bash
# Login to npm
npm login

# Verify login
npm whoami
```

### Publishing

```bash
# Ensure clean build
rm -rf dist/
npm run build

# Dry run (preview what will be published)
npm publish --dry-run

# Publish (public package)
npm publish --access public

# Publish with tag (for pre-releases)
npm publish --tag beta --access public
```

### Package Contents

Ensure `.npmignore` or `package.json` `files` field includes only necessary files:

```json
{
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ]
}
```

### Verify Published Package

```bash
# View package info
npm view @danielsimonjr/memoryjs

# Check versions
npm view @danielsimonjr/memoryjs versions

# Test installation
mkdir /tmp/test-install && cd /tmp/test-install
npm init -y
npm install @danielsimonjr/memoryjs
node -e "const m = require('@danielsimonjr/memoryjs'); console.log('OK')"
```

---

## GitHub Releases

### Creating a Release

1. Go to repository on GitHub
2. Click "Releases" → "Create a new release"
3. Choose tag (e.g., `v1.1.0`)
4. Set release title: `v1.1.0`
5. Write release notes (see template below)
6. Attach any binaries if applicable
7. Mark as pre-release if applicable
8. Publish release

### Release Notes Template

```markdown
# MemoryJS v1.1.0

## Highlights

Brief summary of the most important changes.

## Breaking Changes

- None in this release

## New Features

- **Hybrid Search**: New `hybridSearch()` method combining semantic, lexical,
  and symbolic search for better retrieval quality.
- **Mermaid Export**: Export graphs as Mermaid diagrams with
  `exportGraph('mermaid')`.

## Improvements

- TF-IDF search performance improved by 40%
- Reduced memory usage for large graphs

## Bug Fixes

- Fixed search pagination offset bug (#123)
- Fixed memory leak in fuzzy search (#125)

## Dependencies

- Updated better-sqlite3 to v9.4.0
- Updated zod to v3.22.0

## Migration Guide

No migration needed for this release.

---

**Full Changelog**: https://github.com/danielsimonjr/MemoryJS/compare/v1.0.0...v1.1.0
```

### Automating with GitHub Actions

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Test
        run: npm test

      - name: Publish to npm
        run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## Post-Release

### Verification

```bash
# 1. Check npm
npm view @danielsimonjr/memoryjs version
# Should show new version

# 2. Test installation
npm install @danielsimonjr/memoryjs@latest
node -e "console.log(require('@danielsimonjr/memoryjs').version)"

# 3. Check GitHub release
# Visit https://github.com/danielsimonjr/MemoryJS/releases

# 4. Verify CHANGELOG is accurate
```

### Communication

For significant releases:

1. **GitHub Discussions**: Post announcement
2. **README badges**: Ensure version badge updates
3. **Documentation**: Update any version references

### Start Next Cycle

```bash
# Add Unreleased section to CHANGELOG
## [Unreleased]

### Added

### Changed

### Fixed
```

---

## Hotfix Process

For urgent bug fixes in production:

### 1. Create Hotfix Branch

```bash
# From the release tag
git checkout v1.0.0
git checkout -b hotfix/critical-bug

# Or from main if recent
git checkout main
git checkout -b hotfix/critical-bug
```

### 2. Apply Fix

```bash
# Make minimal fix
# Add test for the bug
npm test

# Commit
git add .
git commit -m "fix: critical bug description (#issue)"
```

### 3. Release Hotfix

```bash
# Bump patch version
npm version patch  # 1.0.0 -> 1.0.1

# Push
git push origin hotfix/critical-bug
git push origin v1.0.1

# Publish
npm publish --access public
```

### 4. Merge Back

```bash
# Merge hotfix to main
git checkout main
git merge hotfix/critical-bug
git push origin main

# Delete hotfix branch
git branch -d hotfix/critical-bug
```

---

## Version Matrix

Track compatibility:

| MemoryJS | Node.js | better-sqlite3 | TypeScript |
|----------|---------|----------------|------------|
| 1.1.x    | 18+     | 9.4.x          | 5.0+       |
| 1.0.x    | 18+     | 9.2.x          | 5.0+       |

---

## Quick Reference

### Release Commands

```bash
# Full release process
npm run build
npm test
npm version minor  # or patch/major
git push origin main --tags
npm publish --access public
```

### Common Tasks

| Task | Command |
|------|---------|
| Bump patch | `npm version patch` |
| Bump minor | `npm version minor` |
| Bump major | `npm version major` |
| Publish | `npm publish --access public` |
| Dry run | `npm publish --dry-run` |
| Beta release | `npm publish --tag beta` |

### Rollback

If release has issues:

```bash
# Unpublish (within 72 hours)
npm unpublish @danielsimonjr/memoryjs@1.0.1

# Or deprecate
npm deprecate @danielsimonjr/memoryjs@1.0.1 "Critical bug, use 1.0.2"

# Publish fix
npm version patch
npm publish --access public
```
