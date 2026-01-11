# File Size Policy

## Strict File Size Limits

This project enforces strict file size limits to maintain code quality, readability, and maintainability.

### Rules

1. **ALL implementation files MUST be under 500 lines**
   - No exceptions
   - Includes imports, exports, comments, and whitespace
   - If approaching limit, split into multiple files

2. **Test files MUST be under 400 lines**
   - Split large test suites into multiple files
   - Group related tests logically
   - Use `describe` blocks for organization

3. **Type definition files SHOULD be under 200 lines**
   - Organize by domain
   - One file per major feature area

4. **Target average file size: 200-250 lines**
   - Smaller files are better
   - Easier to review and understand
   - Better for git diffs and merge conflicts

### Why These Limits?

- **Code Review**: Files under 500 lines can be reviewed in one sitting
- **Understanding**: Smaller files are easier to comprehend
- **Testing**: Focused modules are easier to test
- **Navigation**: Quick to find and jump between code
- **Maintenance**: Changes are localized and less risky
- **Merge Conflicts**: Smaller files reduce conflict probability

### How to Stay Under the Limit

#### Strategy 1: Extract Utilities
If you have helper functions, extract them to a separate utility file:
```typescript
// Before: MyManager.ts (550 lines)
class MyManager {
  private helperA() { ... }
  private helperB() { ... }
  // ... main logic
}

// After: MyManager.ts (300 lines) + utils/myHelpers.ts (200 lines)
import { helperA, helperB } from '../utils/myHelpers.js';
class MyManager {
  // ... main logic using imported helpers
}
```

#### Strategy 2: Split by Responsibility
Large managers should be split by functional area:
```typescript
// Before: ImportExportManager.ts (850 lines)
class ImportExportManager {
  exportJSON() { ... }
  exportCSV() { ... }
  exportGraphML() { ... }
  importJSON() { ... }
  importCSV() { ... }
}

// After: Split into multiple files (each <200 lines)
// import-export/ExportManager.ts
// import-export/ImportManager.ts
// import-export/formats/JSONExporter.ts
// import-export/formats/CSVExporter.ts
// import-export/formats/GraphMLExporter.ts
// etc.
```

#### Strategy 3: Split by Feature
Large feature files should be split into sub-features:
```typescript
// Before: HierarchyManager.ts (600 lines)
class HierarchyManager {
  setParent() { ... }
  getChildren() { ... }
  getAncestors() { ... }
  getDescendants() { ... }
  moveEntity() { ... }
  validateHierarchy() { ... }
}

// After: Split into focused modules
// hierarchy/ParentChildManager.ts (200 lines)
// hierarchy/AncestryManager.ts (200 lines)
// hierarchy/HierarchyValidator.ts (150 lines)
// hierarchy/HierarchyManager.ts (100 lines) - facade
```

#### Strategy 4: Split Test Files
Large test files should be organized by feature area:
```typescript
// Before: HierarchyManager.test.ts (600 lines)
describe('HierarchyManager', () => {
  describe('setParent', () => { ... })
  describe('getChildren', () => { ... })
  describe('getAncestors', () => { ... })
  // ... many more tests
})

// After: Split into multiple test files
// HierarchyManager.parent.test.ts (200 lines)
// HierarchyManager.ancestry.test.ts (250 lines)
// HierarchyManager.validation.test.ts (150 lines)
```

### Enforcement

#### Pre-commit Hook
```bash
#!/bin/bash
# Check all TypeScript files for line count

max_lines=500
max_test_lines=400
violations=0

for file in $(git diff --cached --name-only --diff-filter=ACM | grep '\.ts$'); do
  if [ -f "$file" ]; then
    lines=$(wc -l < "$file")

    if [[ $file == *".test.ts" ]]; then
      if [ $lines -gt $max_test_lines ]; then
        echo "❌ $file has $lines lines (max $max_test_lines for tests)"
        violations=$((violations + 1))
      fi
    else
      if [ $lines -gt $max_lines ]; then
        echo "❌ $file has $lines lines (max $max_lines)"
        violations=$((violations + 1))
      fi
    fi
  fi
done

if [ $violations -gt 0 ]; then
  echo ""
  echo "❌ File size policy violation: $violations file(s) exceed the line limit"
  echo "Please split large files into smaller modules."
  echo "See .github/FILE_SIZE_POLICY.md for guidance"
  exit 1
fi

echo "✅ All files comply with file size policy"
```

#### CI/CD Check
Add to GitHub Actions workflow:
```yaml
- name: Check file sizes
  run: |
    find src -name "*.ts" -not -name "*.test.ts" -exec sh -c '
      lines=$(wc -l < "$1")
      if [ $lines -gt 500 ]; then
        echo "::error file=$1::File has $lines lines (max 500)"
        exit 1
      fi
    ' sh {} \;

    find src -name "*.test.ts" -exec sh -c '
      lines=$(wc -l < "$1")
      if [ $lines -gt 400 ]; then
        echo "::error file=$1::Test file has $lines lines (max 400)"
        exit 1
      fi
    ' sh {} \;
```

### Review Checklist

When reviewing PRs, check:
- [ ] All new/modified files are under the size limit
- [ ] Large files are appropriately split
- [ ] Split files maintain logical cohesion
- [ ] No artificial splitting (e.g., splitting one function across files)
- [ ] Clear module boundaries and responsibilities

### Exceptions

**There are NO exceptions to this policy.**

If you believe you have a legitimate case for exceeding the limit:
1. First, try harder to split the file appropriately
2. Review the splitting strategies above
3. Consult with the team for alternative approaches
4. Consider if the file is doing too much (violating Single Responsibility)

### Examples of Good Splits

#### Example 1: Tool Definitions
```
# Before (750 lines)
mcp/tools/all-tools.ts

# After (3 files, each ~250 lines)
mcp/tools/entity.tools.ts
mcp/tools/search.tools.ts
mcp/tools/hierarchy.tools.ts
```

#### Example 2: Complex Algorithm
```
# Before (600 lines)
search/BooleanSearch.ts

# After (3 files)
search/BooleanSearch.ts (150 lines) - main orchestrator
search/boolean/QueryParser.ts (250 lines) - parsing logic
search/boolean/QueryEvaluator.ts (200 lines) - evaluation logic
```

#### Example 3: Format Handlers
```
# Before (850 lines)
features/ImportExportManager.ts

# After (12 files, each 100-200 lines)
features/import-export/ImportExportManager.ts (orchestrator)
features/import-export/ExportManager.ts
features/import-export/ImportManager.ts
features/import-export/formats/JSONExporter.ts
features/import-export/formats/CSVExporter.ts
features/import-export/formats/GraphMLExporter.ts
# ... etc
```

## Summary

**Keep files small. Your future self (and your teammates) will thank you.**

- ✅ Implementation files: < 500 lines
- ✅ Test files: < 400 lines
- ✅ Target average: 200-250 lines
- ✅ Split files when approaching limits
- ✅ Maintain logical cohesion
- ❌ No exceptions

Questions? See REFACTORING_PLAN.md or ask the team.
