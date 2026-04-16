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


