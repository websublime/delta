# @websublime/delta

**delta://** — Typed JSON model diffing for TypeScript.

Diff any two JSON values and get a structured, typed result with JSON Pointer paths. Apply it forward with `patch`, reverse it with `unpatch`, extract a sparse changes object with `changes`, or export it as an RFC 6902 patch.

```ts
import { diff, patch, unpatch } from '@websublime/delta'

const before = { users: [{ id: 1, role: 'admin' }, { id: 2, role: 'user' }] }
const after  = { users: [{ id: 2, role: 'mod'   }, { id: 1, role: 'admin' }] }

const result = diff(before, after, { arrayIdentity: 'id' })
// → { hasChanges: true, summary: { moved: 2, movedAndChanged: 1, ... }, operations: [...] }

const forward  = patch(before, result)    // === after
const backward = unpatch(after, result)   // === before

// Extract only what changed — ideal for PATCH payloads or audit logs
import { changes } from '@websublime/delta'
const { updated, removed } = changes(before, after, { arrayIdentity: 'id' })
// updated → sparse object with only added/replaced/moved values
// removed → ['/users/0/role'] (RFC 6901 paths that were deleted)
```

## Features

- **Zero runtime dependencies** — pure TypeScript
- **Typed operations** — `add | remove | replace | move`, each with the right shape
- **JSON Pointer paths** (RFC 6901) — `/users/0/role`, `~0` and `~1` escaping included
- **Identity-based array diffing** — track items by id across reorders, adds, removes; deterministic even with duplicate ids
- **Sparse changes** — `changes()` returns only what was added, replaced, moved, or removed — ready for PATCH payloads, form dirty tracking, or audit logs
- **Bidirectional** — `patch` and `unpatch` both work from the diff result alone; `oldValue` is always present on destructive ops
- **RFC 6902 adapter** — export any diff as a standard JSON Patch
- **Runtime validation** — `patch`/`unpatch` reject malformed inputs with a typed `DeltaError`
- **Cycle-safe** — circular references throw `DeltaError('CIRCULAR_REFERENCE')` instead of stack overflow
- **Prototype-safe** — handles `__proto__`/`constructor` as data without polluting `Object.prototype`

---

## Install

```bash
npm install @websublime/delta
```

---

## Usage

### Basic diff

```ts
import { diff } from '@websublime/delta'

const result = diff({ a: 1, b: 2 }, { a: 99, c: 3 })

result.hasChanges      // true
result.summary
// { added: 1, removed: 1, replaced: 1, moved: 0, movedAndChanged: 0, total: 3 }

result.operations
// [
//   { op: 'replace', path: '/a', value: 99, oldValue: 1 },
//   { op: 'remove',  path: '/b', oldValue: 2 },
//   { op: 'add',     path: '/c', value: 3 },
// ]

result.changedPaths    // Set<string> — { '/a', '/b', '/c' }
```

### patch / unpatch

```ts
import { diff, patch, unpatch } from '@websublime/delta'

const before = { x: 1 }
const after  = { x: 2 }

const result = diff(before, after)

patch(before, result)   // { x: 2 }
unpatch(after, result)  // { x: 1 }
```

Neither function mutates its inputs. `unpatch` only needs `after` + the diff result — it never needs `before` because `oldValue` is always stored on destructive operations.

### changes

Extract a sparse object containing only the values that changed — useful for HTTP PATCH payloads, form dirty tracking, optimistic UI updates, or audit logs.

```ts
import { changes } from '@websublime/delta'

const before = { name: 'Alice', age: 30, email: 'alice@example.com' }
const after  = { name: 'Bob',   age: 30, role: 'admin' }

const result = changes(before, after)

result.updated  // { name: 'Bob', role: 'admin' }
result.removed  // ['/email']
result.hasChanges // true
result.diff     // the full DiffResult for low-level access
```

Nested structure is preserved — only the branches that actually changed appear in `updated`:

```ts
const before = { user: { name: 'Alice', settings: { theme: 'dark', lang: 'en' } } }
const after  = { user: { name: 'Alice', settings: { theme: 'light', lang: 'en' } } }

const result = changes(before, after)
result.updated  // { user: { settings: { theme: 'light' } } }
```

When only removals exist (no additions or replacements), `updated` is `null`:

```ts
const result = changes({ a: 1, b: 2 }, { a: 1 })
result.updated  // null
result.removed  // ['/b']
```

All `DiffOptions` are supported — `arrayIdentity`, `ignore`, `maxDepth`, etc.:

```ts
const result = changes(before, after, {
  arrayIdentity: 'id',
  ignore: ['/meta/*'],
})
```

If you already have a `DiffResult`, use `changesFromDiff` to avoid re-diffing:

```ts
import { diff, changesFromDiff } from '@websublime/delta'

const diffResult = diff(before, after, options)
// ... inspect diffResult.operations ...
const sparse = changesFromDiff(diffResult)
```

### Identity-based array diffing

When your array items have a stable identifier, use `arrayIdentity` to track them across reorders, adds and removes:

```ts
const before = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob'   },
  { id: 3, name: 'Carol' },
]
const after = [
  { id: 3, name: 'Carol' },
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob'   },
]

const result = diff(before, after, { arrayIdentity: 'id' })
// summary: { moved: 3 }
// operations: 3 × { op: 'move', path: '', fromIndex, toIndex, value, oldValue }
```

Without `arrayIdentity`, the LCS algorithm would emit removes and adds for the reorder instead.

**Identity options:**

```ts
// Single key
{ arrayIdentity: 'id' }

// Composite key
{ arrayIdentity: ['namespace', 'name'] }

// Custom function
{ arrayIdentity: (item) => `${item.type}:${item.id}` }

// Per-path (different rules for different arrays)
{
  arrayIdentity: {
    '/users':   'id',
    '/tags':    'slug',
    '/matrix':  (item) => `${item.row}:${item.col}`,
  }
}
```

**Duplicate ids.** Internally, each raw id is suffixed with an occurrence counter (`1:0`, `1:1`, …) so duplicates are matched positionally within the same id. No silent data loss.

### Options

```ts
diff(before, after, {
  // Ignore specific paths (exact or wildcard). `/meta/*` ignores every path
  // starting with `/meta/`, including new keys being added below it.
  ignore: ['/meta/updatedAt', '/meta/*'],

  // Stop recursing deeper than N levels. At depth N, emits a full `replace`.
  maxDepth: 5,

  // Custom equality (e.g. fuzzy number comparison)
  equal: (a, b) => Math.abs(a - b) < 0.001,

  // Disable move detection (emit remove+add instead)
  detectMoves: false,

  // Identity config (see above)
  arrayIdentity: 'id',

  // Skip deep-cloning values into operations. Reduces memory ~2× for large
  // diffs, but operations hold references into inputs. Default: true.
  cloneValues: false,
})
```

### RFC 6902 adapter

Export any diff result as a standard [RFC 6902 JSON Patch](https://datatracker.ietf.org/doc/html/rfc6902):

```ts
import { diff } from '@websublime/delta'
import { toRFC6902, toRFC6902JSON } from '@websublime/delta/rfc6902'

const result = diff({ a: 1 }, { a: 2, b: 3 })

toRFC6902(result)
// [
//   { op: 'replace', path: '/a', value: 2 },
//   { op: 'add',     path: '/b', value: 3 },
// ]

toRFC6902JSON(result)
// '[{"op":"replace","path":"/a","value":2},{"op":"add","path":"/b","value":3}]'
```

Tested against [`fast-json-patch`](https://www.npmjs.com/package/fast-json-patch) as the reference consumer.

### Error handling

`patch` and `unpatch` throw a typed `DeltaError` when handed a malformed
`DiffResult` or when the underlying traversal fails:

```ts
import { DeltaError, patch } from '@websublime/delta'

try {
  patch({}, untrustedPayload)
} catch (err) {
  if (err instanceof DeltaError) {
    console.error(err.code, err.path, err.message)
    // err.code is one of:
    //   'CIRCULAR_REFERENCE' | 'INVALID_DIFF_RESULT' | 'INVALID_OPERATION'
    //   | 'PATH_NOT_FOUND' | 'UNSUPPORTED_VALUE'
  }
}
```

---

## Types

```ts
type DiffOp = OpAdd | OpRemove | OpReplace | OpMove

interface OpAdd     { op: 'add';     path: string; value: JsonValue }
interface OpRemove  { op: 'remove';  path: string; oldValue: JsonValue }
interface OpReplace { op: 'replace'; path: string; value: JsonValue; oldValue: JsonValue }
interface OpMove    {
  op: 'move'
  path: string       // array root path (e.g. '/users')
  fromIndex: number  // original position
  toIndex: number    // final position
  value: JsonValue   // final value (may include nested changes)
  oldValue: JsonValue
}

interface DiffResult {
  hasChanges: boolean
  operations: DiffOp[]
  summary: DiffSummary
  changedPaths: Set<string>
}

interface DiffSummary {
  added: number
  removed: number
  replaced: number
  moved: number          // moved, content unchanged
  movedAndChanged: number
  total: number
}

interface ChangesResult {
  hasChanges: boolean
  updated: JsonValue | null  // sparse object with added/replaced/moved values; null when only removals
  removed: string[]          // RFC 6901 paths that were deleted
  diff: DiffResult           // full diff result for low-level access
}
```

---

## Semantics & edge cases

**Determinism.** Given the same inputs, `diff` always emits the same operation array. Covered by property tests.

**Equality.** The built-in `deepEqual`:
- Treats `NaN === NaN` as `true` (diverges from `===`, aligns with `Object.is`).
- Treats `+0 === -0` as `true` (standard `===` behavior).
- Treats `undefined` object values as the key being absent (JSON semantics).

**`undefined` values.** Since `undefined` is not a valid JSON value, it is stripped on clone and treated as "key absent" during diffing. `{ a: undefined }` ≡ `{}`.

**Array move ops use the final value.** When an item moves and its content also changed, the `move` op carries `value` (the final state) and `oldValue` (the original). There is no separate `replace` op emitted for the nested change — the move op is the full story. This is a trade-off: downstream consumers see "the whole moved item changed", not "field X inside moved item changed".

**LCS arrays (no identity).** Without `arrayIdentity`, arrays are diffed positionally using an LCS algorithm. An in-place value change like `[1, 2, 3] → [1, 99, 3]` emits a `remove` for `2` and an `add` for `99` (LCS sees `[1, 3]` as the common subsequence), not a `replace`.

**LCS size budget.** The LCS DP table uses `(m+1) × (n+1)` `Uint32` cells. For two arrays of `N` items each, memory is ~`4 × N²` bytes: 40 KB at `N=100`, 4 MB at `N=1000`, 400 MB at `N=10 000`. For very large arrays, either configure `arrayIdentity` (which uses hash-maps instead) or chunk the diff manually.

**Path escaping.** `/` in a key becomes `~1`, `~` becomes `~0` per RFC 6901.

**Circular references throw.** `diff`, `patch`, and `unpatch` detect cycles via a `WeakSet` and throw `DeltaError('CIRCULAR_REFERENCE')` rather than overflowing the stack.

**Prototype safety.** Keys named `__proto__`, `constructor`, or `prototype` are preserved as own data properties — they never trigger the `__proto__` setter, so `Object.prototype` is never polluted.

---

## License

MIT © [websublime](https://github.com/websublime)
