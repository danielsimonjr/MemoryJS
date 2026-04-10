## Prerequisites

```bash
cd C:/Users/danie/Dropbox/Github/memoryjs
git checkout feature/mempalace-gap
npm run typecheck  # must pass
SKIP_BENCHMARKS=true npm test 2>&1 | tail -5  # ~5681 pass, 2 pre-existing failures OK
```

---
