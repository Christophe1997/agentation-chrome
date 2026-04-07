import { storage } from 'wxt/utils/storage';
import type { Annotation, AnnotationSyncStatus, ExtensionSettings, RetryEntry, SessionInfo } from './types';
import { LIMITS } from './constants';

// Per-tab annotation store, keyed by `${tabId}-${url}`
const annotationsStore = storage.defineItem<Record<string, Annotation[]>>(
  'local:annotations',
  { fallback: {} },
);

// Sync status per annotation ID
const syncStatusStore = storage.defineItem<Record<string, AnnotationSyncStatus>>(
  'local:syncStatus',
  { fallback: {} },
);

// Session mapping: tabId (as string key) → SessionInfo; cleared on browser close
const sessionsStore = storage.defineItem<Record<string, SessionInfo>>(
  'session:sessions',
  { fallback: {} },
);

// Extension settings
const settingsStore = storage.defineItem<ExtensionSettings>('local:settings', {
  fallback: {
    serverUrl: 'http://localhost:14747',
    detailLevel: 'standard',
  },
});

// Retry queue for failed annotation syncs
const retryQueueStore = storage.defineItem<RetryEntry[]>('local:retryQueue', {
  fallback: [],
});

// --- Annotation CRUD ---

function storageKey(tabId: number, url: string): string {
  return `${tabId}-${url}`;
}

function isExpired(annotation: Annotation): boolean {
  const expiryMs = LIMITS.ANNOTATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - annotation.timestamp > expiryMs;
}

export async function loadAnnotations(tabId: number, url: string): Promise<Annotation[]> {
  const all = await annotationsStore.getValue();
  const key = storageKey(tabId, url);
  const annotations = all[key] ?? [];
  return annotations.filter((a) => !isExpired(a));
}

export async function saveAnnotation(tabId: number, url: string, annotation: Annotation): Promise<void> {
  const key = storageKey(tabId, url);
  const all = await annotationsStore.getValue();
  const existing = all[key] ?? [];
  // Replace if ID already exists, otherwise append
  const idx = existing.findIndex((a) => a.id === annotation.id);
  const updated = idx >= 0
    ? existing.map((a) => (a.id === annotation.id ? annotation : a))
    : [...existing, annotation];
  await annotationsStore.setValue({ ...all, [key]: updated });
}

export async function deleteAnnotation(tabId: number, url: string, annotationId: string): Promise<void> {
  const key = storageKey(tabId, url);
  const all = await annotationsStore.getValue();
  const existing = all[key] ?? [];
  await annotationsStore.setValue({ ...all, [key]: existing.filter((a) => a.id !== annotationId) });
}

export async function clearAnnotations(tabId: number, url: string): Promise<void> {
  const key = storageKey(tabId, url);
  const all = await annotationsStore.getValue();
  const { [key]: _removed, ...rest } = all;
  await annotationsStore.setValue(rest);
}

// --- Sync status ---

export async function getSyncStatus(annotationId: string): Promise<AnnotationSyncStatus> {
  const all = await syncStatusStore.getValue();
  return all[annotationId] ?? 'pending';
}

export async function setSyncStatus(annotationId: string, status: AnnotationSyncStatus): Promise<void> {
  const all = await syncStatusStore.getValue();
  await syncStatusStore.setValue({ ...all, [annotationId]: status });
}

// --- Sessions ---

export async function getSession(tabId: number): Promise<SessionInfo | undefined> {
  const all = await sessionsStore.getValue();
  return all[String(tabId)];
}

export async function saveSession(tabId: number, info: SessionInfo): Promise<void> {
  const all = await sessionsStore.getValue();
  await sessionsStore.setValue({ ...all, [String(tabId)]: info });
}

export async function removeSession(tabId: number): Promise<void> {
  const all = await sessionsStore.getValue();
  const { [String(tabId)]: _removed, ...rest } = all;
  await sessionsStore.setValue(rest);
}

// --- Settings ---

export async function loadSettings(): Promise<ExtensionSettings> {
  return settingsStore.getValue();
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await settingsStore.setValue(settings);
}

// --- Retry queue ---

export async function enqueueRetry(entry: RetryEntry): Promise<void> {
  const queue = await retryQueueStore.getValue();
  await retryQueueStore.setValue([...queue, entry]);
}

export async function dequeueRetry(): Promise<RetryEntry[]> {
  const queue = await retryQueueStore.getValue();
  const now = Date.now();
  const due = queue.filter((e) => e.nextRetryAt <= now);
  const remaining = queue.filter((e) => e.nextRetryAt > now);
  await retryQueueStore.setValue(remaining);
  return due;
}

export async function requeueRetry(entry: RetryEntry): Promise<void> {
  const queue = await retryQueueStore.getValue();
  await retryQueueStore.setValue([...queue, entry]);
}

export async function removeFromRetryQueue(annotationId: string): Promise<void> {
  const queue = await retryQueueStore.getValue();
  await retryQueueStore.setValue(queue.filter((e) => e.annotationId !== annotationId));
}

// --- Expiry cleanup ---

export async function runExpiryCleanup(): Promise<void> {
  const all = await annotationsStore.getValue();
  const cleaned: Record<string, Annotation[]> = {};
  for (const [key, annotations] of Object.entries(all)) {
    const live = annotations.filter((a) => !isExpired(a));
    if (live.length > 0) cleaned[key] = live;
  }
  await annotationsStore.setValue(cleaned);
}
