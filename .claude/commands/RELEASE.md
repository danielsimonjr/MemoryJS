Release workflow for memoryjs. Orchestrates version bump, build verification, and publish.

## Steps

1. Run `npm run typecheck` to verify types
2. Run `SKIP_BENCHMARKS=true npm test` to verify tests pass
3. Ask the user what version bump to apply (patch/minor/major) - default to patch
4. Run `npm version <bump>` to update package.json and create git tag
5. Run `npm run clean && npm run build` to create a fresh build
6. Show the user the new version and ask for confirmation before publishing
7. Run `npm publish --access public` to publish to npm
8. Run `git push && git push --tags` to push the version commit and tag
9. Report the published version

## Important

- Always run tests BEFORE bumping the version
- If any step fails, stop and report the error - do not continue
- The package is scoped as `@danielsimonjr/memoryjs`
- `prepublishOnly` script runs clean + build + test automatically, but we run them explicitly first for early failure detection
