import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store, mockAnnotations, mockSyncStatus, mockSessions, mockSettings, mockRetryQueue } =
  vi.hoisted(() => {
    const store: Record<string, unknown> = {};

    function makeItem<T>(key: string, fallback: T) {
      return {
        getValue: vi.fn(async () => (key in store ? (store[key] as T) : fallback)),
        setValue: vi.fn(async (val: T) => {
          store[key] = val;
        }),
      };
    }

    return {
      store,
      mockAnnotations: makeItem<Record<string, unknown[]>>('local:annotations', {}),
      mockSyncStatus: makeItem<Record<string, string>>('local:syncStatus', {}),
      mockSessions: makeItem<Record<string, unknown>>('session:sessions', {}),
      mockSettings: makeItem('local:settings', { serverUrl: 'http://localhost:4747', detailLevel: 'standard' }),
      mockRetryQueue: makeItem<unknown[]>('local:retryQueue', []),
    };
  });

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: vi.fn((key: string) => {
      if (key === 'local:annotations') return mockAnnotations;
      if (key === 'local:syncStatus') return mockSyncStatus;
      if (key === 'session:sessions') return mockSessions;
      if (key === 'local:settings') return mockSettings;
      if (key === 'local:retryQueue') return mockRetryQueue;
      throw new Error(`Unexpected storage key: ${key}`);
    }),
  },
}));

import {
  loadAnnotations,
  saveAnnotation,
  deleteAnnotation,
  clearAnnotations,
  getSyncStatus,
  setSyncStatus,
  enqueueRetry,
  dequeueRetry,
  runExpiryCleanup,
} from '../storage';
import type { Annotation, RetryEntry } from '../types';

function makeAnnotation(id: string, daysAgo = 0): Annotation {
  return {
    id,
    x: 10,
    y: 20,
    comment: 'test comment',
    element: 'button',
    elementPath: 'body > button',
    timestamp: Date.now() - daysAgo * 24 * 60 * 60 * 1000,
  };
}

function makeRetryEntry(annotationId: string, nextRetryAt = 0): RetryEntry {
  return {
    annotationId,
    sessionId: 'session-1',
    operation: 'create',
    annotation: makeAnnotation(annotationId),
    retryCount: 0,
    lastRetryAt: Date.now(),
    nextRetryAt,
  };
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  vi.clearAllMocks();
});

describe('loadAnnotations', () => {
  it('returns empty array when no annotations stored', async () => {
    const result = await loadAnnotations(1, 'https://example.com');
    expect(result).toEqual([]);
  });

  it('returns annotations for matching tab+url key', async () => {
    const ann = makeAnnotation('ann-1');
    store['local:annotations'] = { '1-https://example.com': [ann] };
    const result = await loadAnnotations(1, 'https://example.com');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ann-1');
  });

  it('filters out expired annotations (older than 7 days)', async () => {
    const expired = makeAnnotation('old', 8);
    const fresh = makeAnnotation('new', 1);
    store['local:annotations'] = { '1-https://example.com': [expired, fresh] };
    const result = await loadAnnotations(1, 'https://example.com');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('new');
  });
});

describe('saveAnnotation', () => {
  it('appends a new annotation', async () => {
    const ann = makeAnnotation('ann-1');
    await saveAnnotation(1, 'https://example.com', ann);
    const saved = store['local:annotations'] as Record<string, Annotation[]>;
    expect(saved['1-https://example.com']).toHaveLength(1);
    expect(saved['1-https://example.com'][0].id).toBe('ann-1');
  });

  it('replaces annotation with same id', async () => {
    const ann = makeAnnotation('ann-1');
    store['local:annotations'] = { '1-https://example.com': [ann] };
    const updated = { ...ann, comment: 'updated' };
    await saveAnnotation(1, 'https://example.com', updated);
    const saved = store['local:annotations'] as Record<string, Annotation[]>;
    expect(saved['1-https://example.com']).toHaveLength(1);
    expect(saved['1-https://example.com'][0].comment).toBe('updated');
  });
});

describe('deleteAnnotation', () => {
  it('removes annotation by id', async () => {
    const ann = makeAnnotation('ann-1');
    store['local:annotations'] = { '1-https://example.com': [ann] };
    await deleteAnnotation(1, 'https://example.com', 'ann-1');
    const saved = store['local:annotations'] as Record<string, Annotation[]>;
    expect(saved['1-https://example.com']).toHaveLength(0);
  });
});

describe('clearAnnotations', () => {
  it('removes the key entirely', async () => {
    store['local:annotations'] = { '1-https://example.com': [makeAnnotation('ann-1')] };
    await clearAnnotations(1, 'https://example.com');
    const saved = store['local:annotations'] as Record<string, unknown>;
    expect('1-https://example.com' in saved).toBe(false);
  });
});

describe('getSyncStatus / setSyncStatus', () => {
  it('returns pending for unknown annotation', async () => {
    const status = await getSyncStatus('unknown-id');
    expect(status).toBe('pending');
  });

  it('returns the set status', async () => {
    await setSyncStatus('ann-1', 'synced');
    const status = await getSyncStatus('ann-1');
    expect(status).toBe('synced');
  });
});

describe('enqueueRetry / dequeueRetry', () => {
  it('enqueues an entry', async () => {
    const entry = makeRetryEntry('ann-1', 0);
    await enqueueRetry(entry);
    const queue = store['local:retryQueue'] as RetryEntry[];
    expect(queue).toHaveLength(1);
  });

  it('dequeues entries where nextRetryAt <= now', async () => {
    const due = makeRetryEntry('ann-1', Date.now() - 1000);
    const notYet = makeRetryEntry('ann-2', Date.now() + 60000);
    store['local:retryQueue'] = [due, notYet];
    const result = await dequeueRetry();
    expect(result).toHaveLength(1);
    expect(result[0].annotationId).toBe('ann-1');
    const remaining = store['local:retryQueue'] as RetryEntry[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].annotationId).toBe('ann-2');
  });
});

describe('runExpiryCleanup', () => {
  it('removes keys with only expired annotations', async () => {
    const expired = makeAnnotation('old', 8);
    const fresh = makeAnnotation('new', 1);
    store['local:annotations'] = {
      'tab1-url1': [expired],
      'tab2-url2': [fresh],
    };
    await runExpiryCleanup();
    const saved = store['local:annotations'] as Record<string, unknown>;
    expect('tab1-url1' in saved).toBe(false);
    expect('tab2-url2' in saved).toBe(true);
  });
});
