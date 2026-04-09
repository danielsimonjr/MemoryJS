### Changed
- `Entity` gains 6 optional fields. All backwards-compatible.
- `ManagerContext` constructor now accepts either a string path (legacy) or an options object.
- `SearchFilterChain` excludes superseded entity versions by default. Use `includeSuperseded: true` to see version history.
- `EntityManager.createEntities` throws `ValidationError` when a non-profile entity uses a `profile-*` name.
