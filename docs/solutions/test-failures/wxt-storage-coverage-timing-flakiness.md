---
title: Storage Test Suite Gaps and Flakiness in WXT Chrome Extension
category: test-failures
date: 2026-04-03
tags: [vitest, typescript, tdd, chrome-extension, wxt, fake-timers, storage, test-coverage]
components: [storage, background]
problem_type: test_failure
symptoms:
  - Missing test coverage for session storage functions (getSession, saveSession, removeSession)
  - Missing test coverage for settings functions (loadSettings, saveSettings)
  - Missing test coverage for retry queue mutation functions (requeueRetry, removeFromRetryQueue)
  - Missing edge case test for dequeueRetry on an empty queue
  - Timing flakiness in dequeueRetry test due to unfrozen clock when capturing Date.now() at setup time
  - Fragile clearAnnotations assertion using 'in' operator on a cast object instead of structural equality
  - Missing afterEach cleanup for vi.useFakeTimers(), leaving fake timers active across tests
related_files:
  - lib/__tests__/storage.test.ts
  - lib/storage.ts
---

# Storage Test Suite Gaps and Flakiness in WXT Chrome Extension

## Problem Description

The storage test file (`lib/__tests__/storage.test.ts`) had four distinct issues after the Phase 1
foundation was scaffolded:

1. **Missing test coverage** — Seven exported functions had zero tests: `getSession`, `saveSession`,
   `removeSession`, `loadSettings`, `saveSettings`, `requeueRetry`, and `removeFromRetryQueue`. The
   WXT storage mock was already wired for sessions and settings, but the corresponding test blocks
   were never written.

2. **Missing edge case** — `dequeueRetry` lacked a test for the empty-queue path.

3. **Timing flakiness in `dequeueRetry`** — The test constructed `nextRetryAt` timestamps using live
   `Date.now()` calls at setup time, while the function under test also calls `Date.now()` internally.
   A context switch between setup and execution could cause intermittent failures.

4. **Fragile `clearAnnotations` assertion** — The test used `'key' in obj` to verify deletion, which
   would throw rather than produce a clean failure if the implementation set the value to `undefined`
   instead of deleting the key.

---

## Root Cause Analysis

**Missing coverage:** The WXT storage mock was set up early to support future tests, but test blocks
for session, settings, and retry-queue mutation functions were deferred and never added. No coverage
enforcement gate existed to surface the gap.

**Missing edge case:** The empty-queue branch in `dequeueRetry` is a guard that returns `[]`. Without
a dedicated test, a regression (e.g., throwing instead of returning `[]`) would go undetected.

**Timing flakiness:** Using real `Date.now()` in both test setup and the function under test creates a
race between two independent clock reads. Even a sub-millisecond context switch can shift the boundary
between "past" and "future" relative timestamps.

**Fragile assertion:** The `'key' in obj` check depends on the implementation detail that the key is
physically removed from the object. A semantically equivalent implementation that sets the value to
`undefined` satisfies the function's contract but breaks the assertion with a thrown error, masking
the real failure reason.

---

## Working Solution

### Fix 1: Add missing describe blocks for untested exports

```ts
describe('getSession / saveSession / removeSession', () => {
  it('returns undefined for unknown tab', async () => {
    const result = await getSession(42);
    expect(result).toBeUndefined();
  });

  it('returns saved session for matching tab', async () => {
    await saveSession(1, { sessionId: 'sess-1', url: 'https://example.com' });
    const result = await getSession(1);
    expect(result).toEqual({ sessionId: 'sess-1', url: 'https://example.com' });
  });

  it('does not return session for different tab', async () => {
    await saveSession(1, { sessionId: 'sess-1', url: 'https://example.com' });
    expect(await getSession(2)).toBeUndefined();
  });

  it('removes session by tabId', async () => {
    await saveSession(1, { sessionId: 'sess-1', url: 'https://example.com' });
    await removeSession(1);
    expect(await getSession(1)).toBeUndefined();
  });
});

describe('loadSettings / saveSettings', () => {
  it('returns defaults when no settings stored', async () => {
    const result = await loadSettings();
    expect(result).toEqual({ serverUrl: 'http://localhost:4747', detailLevel: 'standard' });
  });

  it('returns saved settings', async () => {
    await saveSettings({ serverUrl: 'http://localhost:9999', detailLevel: 'detailed' });
    expect(await loadSettings()).toEqual({ serverUrl: 'http://localhost:9999', detailLevel: 'detailed' });
  });
});

describe('requeueRetry / removeFromRetryQueue', () => {
  it('requeueRetry appends an entry back to the queue', async () => {
    const entry = makeRetryEntry('ann-1', 0);
    await requeueRetry(entry);
    const queue = store['local:retryQueue'] as RetryEntry[];
    expect(queue).toHaveLength(1);
  });

  it('removeFromRetryQueue removes matching entry by annotationId', async () => {
    store['local:retryQueue'] = [makeRetryEntry('ann-1', 0), makeRetryEntry('ann-2', 0)];
    await removeFromRetryQueue('ann-1');
    const queue = store['local:retryQueue'] as RetryEntry[];
    expect(queue).toHaveLength(1);
    expect(queue[0].annotationId).toBe('ann-2');
  });

  it('removeFromRetryQueue is a no-op for unknown annotationId', async () => {
    store['local:retryQueue'] = [makeRetryEntry('ann-1', 0)];
    await removeFromRetryQueue('does-not-exist');
    expect((store['local:retryQueue'] as RetryEntry[])).toHaveLength(1);
  });
});
```

### Fix 2: Add empty-queue edge case

```ts
it('returns empty array when queue is empty', async () => {
  const result = await dequeueRetry();
  expect(result).toEqual([]);
});
```

### Fix 3: Freeze the clock in time-dependent tests

Add `vi.useFakeTimers()` / `vi.useRealTimers()` as a matched pair, and pin time with
`vi.setSystemTime()` before constructing timestamps:

```ts
// In beforeEach (file-level or describe-level)
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// In the test body, before constructing relative timestamps:
it('dequeues entries where nextRetryAt <= now', async () => {
  vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  const now = Date.now(); // frozen — same value the function will see

  const due = makeRetryEntry('ann-1', now - 1000);
  const notYet = makeRetryEntry('ann-2', now + 60000);
  store['local:retryQueue'] = [due, notYet];

  const result = await dequeueRetry();
  expect(result).toHaveLength(1);
  expect(result[0].annotationId).toBe('ann-1');
});
```

### Fix 4: Replace fragile key-existence check with value equality

```ts
// Before — throws instead of failing cleanly if key is undefined instead of absent
const saved = store['local:annotations'] as Record<string, unknown>;
expect('1-https://example.com' in saved).toBe(false);

// After — produces a readable diff on failure
expect(saved).toEqual({});
```

---

## Prevention Strategies

### Checklist: Adding a New Exported Function to `lib/`

- [ ] A test case exists for the happy path
- [ ] A test case exists for at least one error/edge case (empty input, unknown id, etc.)
- [ ] If the function uses `Date.now()`, `setTimeout`, or `setInterval`, the test uses `vi.useFakeTimers()` with a matching `afterEach` cleanup
- [ ] Assertions use `toEqual` / `toBe` / `objectContaining` — not the `'in'` operator
- [ ] `npx vitest run` passes with all tests green

### Canonical Time-Dependent Test Pattern

```ts
describe('MyModule (time-dependent)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('records the correct timestamp', () => {
    const result = myFunction();
    expect(result.createdAt).toEqual(new Date('2024-01-01T00:00:00Z').getTime());
  });
});
```

Always use a hardcoded ISO 8601 string as the frozen time anchor — never `Date.now()` or
`new Date()` without arguments inside test setup.

### WXT Mock Hoisting Discipline

Per AGENTS.md: always declare mock variables inside `vi.hoisted()` and reference them only via the
returned object. Never assign module-level `let mockFn` and reference it inside a `vi.mock()` factory
— Vitest hoists `vi.mock()` calls above variable declarations, making the reference `undefined`:

```ts
// Correct
const { mockGetValue } = vi.hoisted(() => ({
  mockGetValue: vi.fn(async () => ({})),
}));

vi.mock('wxt/utils/storage', () => ({
  storage: { defineItem: vi.fn(() => ({ getValue: mockGetValue })) },
}));
```

### Storage Round-Trip Assertion Pattern

When testing functions from `lib/storage.ts`, assert the full stored shape with `toEqual`, not key
existence:

```ts
// Good — fails with a readable diff
expect(savedAnnotations).toEqual({ 'tab-1-https://example.com': [expectedAnnotation] });

// Bad — passes even if values are undefined
expect('tab-1-https://example.com' in savedAnnotations).toBe(true);
```

---

## Related Documentation

- `AGENTS.md` — Testing commands and the `vi.hoisted()` requirement
- `lib/__tests__/event-emitter.test.ts` — Canonical example of isolated, synchronous Vitest tests
- `lib/__tests__/storage.test.ts` — Canonical example of async WXT storage tests with hoisted mocks
- `docs/plans/2026-04-03-002-feat-phase-1-foundation-scaffolding-storage-background.md` — Phase 1 acceptance criteria
