## [0.2.0] - 2026-04-17

### Features

- core types and DeltaError (8b5d035)
- utilities with cycle detection and prototype safety (e070c87)
- LCS-based array diffing (f3f6421)
- diff engine with identity arrays and move detection (dc4260f)
- patch and unpatch with DiffResult validation (0b00779)
- RFC 6902 adapter (2f18138)
- public API surface (cbf1b97)
- add nestedDiff to OpMove for granular moved+changed diffs (1954860)
- add changes() and changesFromDiff() for sparse change extraction (f9810ae)


### Bug Fixes

- look for .json changeset files (f7f0327)
- align release workflow with this package (22223a3)
- skip changeset check in CI environments (68da319)
- avoid running pre-push hook on CI (c4f1277)
- parentOf escaping, toRFC6902 move semantics, LCS size guard (871a48f)
- correct changeset command in hook and example (cdd70f4)


### Documentation

- README with semantics and examples (0938ddb)
- document changes() and changesFromDiff() API (20c3a2d)
- add comprehensive JSDoc to all public and internal functions (24b084b)


### Code Refactoring

- redesign API to return sparse object directly (8ea0f53)


### Build System

- pin node version via .node-version (db9c209)


### Continuous Integration

- convert CI workflow to npm and scope triggers (60740d8)


### Tests

- unit tests for diff, patch, and RFC 6902 adapter (e7d0f93)
- edge cases and runtime validation (1abcde9)
- property-based round-trip via fast-check (64ebf6e)
- RFC 6902 conformance against fast-json-patch (69289dc)
- add test suite for changes() and changesFromDiff() (773af4a)


### Other Changes

- project scaffolding (38d6ca1)
- npm manifest with dependencies (a31e1bf)
- add github actions workflows (d5c7b1b)
- add workspace-tools configuration (e66566e)
- pre-push changeset validation via githooks path (f4be60a)
- create changeset (6712804)
- add changeset (b285b8b)
- bump @websublime/delta to 0.1.1 (8da944e)
- changes() → snapshot() (f4d1821)
- changeset added (b13ed7e)



## [0.1.1] - 2026-04-16

### Features

- core types and DeltaError (8b5d035)
- utilities with cycle detection and prototype safety (e070c87)
- LCS-based array diffing (f3f6421)
- diff engine with identity arrays and move detection (dc4260f)
- patch and unpatch with DiffResult validation (0b00779)
- RFC 6902 adapter (2f18138)
- public API surface (cbf1b97)


### Bug Fixes

- align release workflow with this package (22223a3)
- look for .json changeset files (f7f0327)
- skip changeset check in CI environments (68da319)
- avoid running pre-push hook on CI (c4f1277)


### Documentation

- README with semantics and examples (0938ddb)


### Build System

- pin node version via .node-version (db9c209)


### Continuous Integration

- convert CI workflow to npm and scope triggers (60740d8)


### Tests

- unit tests for diff, patch, and RFC 6902 adapter (e7d0f93)
- edge cases and runtime validation (1abcde9)
- property-based round-trip via fast-check (64ebf6e)
- RFC 6902 conformance against fast-json-patch (69289dc)


### Other Changes

- project scaffolding (38d6ca1)
- npm manifest with dependencies (a31e1bf)
- add github actions workflows (d5c7b1b)
- add workspace-tools configuration (e66566e)
- create changeset (6712804)
- pre-push changeset validation via githooks path (f4be60a)
- add changeset (b285b8b)


