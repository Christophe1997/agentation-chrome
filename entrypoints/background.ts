import type { ContentRequest, BackgroundResponse } from '../shared/messages';
import type { Annotation, RetryEntry } from '../lib/types';
import {
  loadSettings,
  saveSettings,
  saveSession,
  enqueueRetry,
  dequeueRetry,
  requeueRetry,
  removeFromRetryQueue,
  runExpiryCleanup,
} from '../lib/storage';
import { LIMITS } from '../lib/constants';

export default defineBackground(() => {
  // --- In-memory state (lost on service worker restart — restored from storage) ---
  const activeToolbarTabs = new Set<number>();
  let sseConnection: EventSource | null = null;
  let sseReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let sseReconnectDelay = 1000;

  // --- Message routing ---

  browser.runtime.onMessage.addListener(
    (msg: ContentRequest, sender, sendResponse: (r: BackgroundResponse) => void) => {
      // Only accept messages from content scripts (sender.tab present) or alarm handlers
      if (msg.type === 'TOOLBAR_ACTIVATED' || msg.type === 'TOOLBAR_DEACTIVATED' || msg.type === 'OPEN_OPTIONS') {
        handleFireAndForget(msg);
        return false;
      }

      handleMessage(msg, sender)
        .then(sendResponse)
        .catch((err: Error) => {
          sendResponse({
            type: 'ERROR',
            requestId: (msg as { requestId?: string }).requestId ?? '',
            code: 'UNKNOWN',
            message: err.message,
          });
        });
      return true; // keep channel open for async response
    },
  );

  // --- Extension icon click → toggle toolbar in active tab ---

  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    await ensureContentScriptRegistered();
    await sendToggleWithRetry(tab.id);
  });

  // --- Keyboard command → toggle toolbar ---

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-toolbar') return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await ensureContentScriptRegistered();
    await sendToggleWithRetry(tab.id);
  });

  // --- Alarms: health check + retry queue (every 30s) ---

  browser.alarms.create('health-check', { periodInMinutes: LIMITS.HEALTH_CHECK_INTERVAL_MIN });
  browser.alarms.create('retry-sync', { periodInMinutes: LIMITS.HEALTH_CHECK_INTERVAL_MIN });
  browser.alarms.create('expiry-cleanup', { periodInMinutes: 60 });

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'health-check') {
      const status = await checkServerHealth();
      broadcastToActiveTabs({ type: 'SERVER_STATUS', status });
    }
    if (alarm.name === 'retry-sync') {
      await processRetryQueue();
    }
    if (alarm.name === 'expiry-cleanup') {
      await runExpiryCleanup();
    }
  });

  // --- Message handlers ---

  async function handleMessage(
    msg: ContentRequest,
    sender: Browser.runtime.MessageSender,
  ): Promise<BackgroundResponse> {
    switch (msg.type) {
      case 'CREATE_SESSION':
        return createSession(msg.requestId, msg.url, msg.domain, sender.tab?.id);
      case 'SYNC_ANNOTATION':
        return syncAnnotation(msg.requestId, msg.sessionId, msg.annotation);
      case 'UPDATE_ANNOTATION':
        return updateAnnotation(msg.requestId, msg.serverId, msg.changes);
      case 'DELETE_ANNOTATION':
        return deleteAnnotation(msg.requestId, msg.serverId);
      case 'CLEAR_ANNOTATIONS':
        return clearAnnotations(msg.requestId, msg.sessionId);
      case 'CHECK_SERVER_HEALTH': {
        const status = await checkServerHealth();
        return { type: 'SERVER_STATUS', status };
      }
      case 'GET_SETTINGS': {
        const settings = await loadSettings();
        return { type: 'SETTINGS', requestId: msg.requestId, settings };
      }
      case 'SAVE_SETTINGS': {
        await saveSettings(msg.settings);
        return { type: 'SETTINGS', requestId: msg.requestId, settings: msg.settings };
      }
      default:
        return {
          type: 'ERROR',
          requestId: (msg as { requestId?: string }).requestId ?? '',
          code: 'UNKNOWN',
          message: 'Unhandled message type',
        };
    }
  }

  function handleFireAndForget(msg: ContentRequest): void {
    if (msg.type === 'TOOLBAR_ACTIVATED') {
      activeToolbarTabs.add(msg.tabId);
      connectSSE();
    } else if (msg.type === 'TOOLBAR_DEACTIVATED') {
      activeToolbarTabs.delete(msg.tabId);
      if (activeToolbarTabs.size === 0) disconnectSSE();
    } else if (msg.type === 'OPEN_OPTIONS') {
      browser.runtime.openOptionsPage();
    }
  }

  // --- Session management ---

  async function createSession(
    requestId: string,
    url: string,
    domain: string,
    tabId?: number,
  ): Promise<BackgroundResponse> {
    const settings = await loadSettings();
    try {
      const response = await fetch(`${settings.serverUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, domain }),
      });
      if (!response.ok) {
        return { type: 'ERROR', requestId, code: 'SERVER_ERROR', message: `HTTP ${response.status}` };
      }
      const session = await response.json();
      if (tabId !== undefined) {
        await saveSession(tabId, { sessionId: session.id, url });
      }
      return { type: 'SESSION_CREATED', requestId, session };
    } catch (err) {
      return { type: 'ERROR', requestId, code: 'NETWORK_ERROR', message: (err as Error).message };
    }
  }

  // --- Annotation CRUD ---

  async function syncAnnotation(
    requestId: string,
    sessionId: string,
    annotation: Annotation,
  ): Promise<BackgroundResponse> {
    const settings = await loadSettings();
    try {
      const response = await fetch(`${settings.serverUrl}/sessions/${sessionId}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(annotation),
      });
      if (!response.ok) {
        await scheduleRetry({ annotationId: annotation.id, sessionId, operation: 'create', annotation, retryCount: 0, lastRetryAt: Date.now(), nextRetryAt: retryDelay(0) });
        return { type: 'ERROR', requestId, code: 'SYNC_FAILED', message: `HTTP ${response.status}` };
      }
      const data = await response.json();
      return { type: 'SYNC_SUCCESS', requestId, annotationId: annotation.id, serverId: data.id };
    } catch (err) {
      await scheduleRetry({ annotationId: annotation.id, sessionId, operation: 'create', annotation, retryCount: 0, lastRetryAt: Date.now(), nextRetryAt: retryDelay(0) });
      return { type: 'ERROR', requestId, code: 'NETWORK_ERROR', message: (err as Error).message };
    }
  }

  async function updateAnnotation(
    requestId: string,
    serverId: string,
    changes: Partial<Annotation>,
  ): Promise<BackgroundResponse> {
    const settings = await loadSettings();
    try {
      const response = await fetch(`${settings.serverUrl}/annotations/${serverId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      if (!response.ok) {
        return { type: 'ERROR', requestId, code: 'SERVER_ERROR', message: `HTTP ${response.status}` };
      }
      return { type: 'UPDATE_SUCCESS', requestId, serverId };
    } catch (err) {
      return { type: 'ERROR', requestId, code: 'NETWORK_ERROR', message: (err as Error).message };
    }
  }

  async function deleteAnnotation(requestId: string, serverId: string): Promise<BackgroundResponse> {
    const settings = await loadSettings();
    try {
      const response = await fetch(`${settings.serverUrl}/annotations/${serverId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        return { type: 'ERROR', requestId, code: 'SERVER_ERROR', message: `HTTP ${response.status}` };
      }
      return { type: 'DELETE_SUCCESS', requestId };
    } catch (err) {
      return { type: 'ERROR', requestId, code: 'NETWORK_ERROR', message: (err as Error).message };
    }
  }

  async function clearAnnotations(requestId: string, sessionId: string): Promise<BackgroundResponse> {
    const settings = await loadSettings();
    try {
      const response = await fetch(`${settings.serverUrl}/sessions/${sessionId}/annotations`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        return { type: 'ERROR', requestId, code: 'SERVER_ERROR', message: `HTTP ${response.status}` };
      }
      return { type: 'CLEAR_SUCCESS', requestId };
    } catch (err) {
      return { type: 'ERROR', requestId, code: 'NETWORK_ERROR', message: (err as Error).message };
    }
  }

  // --- Server health ---

  async function checkServerHealth(): Promise<'connected' | 'disconnected' | 'unknown'> {
    const settings = await loadSettings();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${settings.serverUrl}/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response.ok ? 'connected' : 'disconnected';
    } catch {
      return 'disconnected';
    }
  }

  // --- SSE connection ---

  async function connectSSE(): Promise<void> {
    if (sseConnection) return; // already connected
    const settings = await loadSettings();
    const url = `${settings.serverUrl}/events?agent=true`;

    sseConnection = new EventSource(url);

    sseConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleSSEEvent(data);
      } catch {
        // ignore malformed events
      }
    };

    sseConnection.onerror = () => {
      sseConnection?.close();
      sseConnection = null;
      scheduleSSEReconnect();
    };

    sseConnection.onopen = () => {
      sseReconnectDelay = 1000; // reset backoff on successful connection
    };
  }

  function disconnectSSE(): void {
    if (sseReconnectTimeout) {
      clearTimeout(sseReconnectTimeout);
      sseReconnectTimeout = null;
    }
    sseConnection?.close();
    sseConnection = null;
    sseReconnectDelay = 1000;
  }

  function scheduleSSEReconnect(): void {
    if (activeToolbarTabs.size === 0) return; // no active tabs — don't reconnect
    if (sseReconnectTimeout) return;

    sseReconnectTimeout = setTimeout(() => {
      sseReconnectTimeout = null;
      connectSSE();
    }, sseReconnectDelay);

    // Exponential backoff: 1s → 2s → 4s → ... → 30s max
    sseReconnectDelay = Math.min(sseReconnectDelay * 2, LIMITS.RETRY_MAX_DELAY_MS);
  }

  function handleSSEEvent(data: Record<string, unknown>): void {
    const eventType = data.type as string | undefined;
    if (!eventType) return;

    if (eventType === 'annotation.resolved' && data.annotationId) {
      broadcastToActiveTabs({
        type: 'ANNOTATION_RESOLVED' as const,
        requestId: '',
        annotationId: data.annotationId as string,
        summary: (data.summary as string) ?? '',
      } as BackgroundResponse);
    } else if (eventType === 'annotation.dismissed' && data.annotationId) {
      broadcastToActiveTabs({
        type: 'ANNOTATION_DISMISSED' as const,
        requestId: '',
        annotationId: data.annotationId as string,
        reason: (data.reason as string) ?? '',
      } as BackgroundResponse);
    }
  }

  // --- Retry queue ---

  function retryDelay(retryCount: number): number {
    return Date.now() + Math.min(
      LIMITS.RETRY_BASE_DELAY_MS * Math.pow(2, retryCount),
      LIMITS.RETRY_MAX_DELAY_MS,
    );
  }

  async function scheduleRetry(entry: RetryEntry): Promise<void> {
    await enqueueRetry(entry);
  }

  async function processRetryQueue(): Promise<void> {
    const due = await dequeueRetry();
    for (const entry of due) {
      if (entry.retryCount >= LIMITS.MAX_RETRIES) continue; // drop exhausted entries

      const settings = await loadSettings();
      try {
        let response: Response;
        if (entry.operation === 'create' && entry.annotation) {
          response = await fetch(`${settings.serverUrl}/sessions/${entry.sessionId}/annotations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry.annotation),
          });
        } else if (entry.operation === 'delete' && entry.serverId) {
          response = await fetch(`${settings.serverUrl}/annotations/${entry.serverId}`, {
            method: 'DELETE',
          });
        } else {
          continue; // unsupported operation in retry queue
        }

        if (response.ok) {
          await removeFromRetryQueue(entry.annotationId);
        } else {
          await requeueRetry({
            ...entry,
            retryCount: entry.retryCount + 1,
            lastRetryAt: Date.now(),
            nextRetryAt: retryDelay(entry.retryCount + 1),
          });
        }
      } catch {
        await requeueRetry({
          ...entry,
          retryCount: entry.retryCount + 1,
          lastRetryAt: Date.now(),
          nextRetryAt: retryDelay(entry.retryCount + 1),
        });
      }
    }
  }

  // --- Helpers ---

  async function ensureContentScriptRegistered(): Promise<void> {
    try {
      await browser.scripting.registerContentScripts([
        {
          id: 'agentation-content',
          matches: ['<all_urls>'],
          js: ['content-scripts/content.js'],
          runAt: 'document_idle',
        },
      ]);
    } catch {
      // Already registered — DOMException is expected on second call
    }
  }

  async function sendToggleWithRetry(tabId: number): Promise<void> {
    for (let i = 0; i < 3; i++) {
      try {
        await browser.tabs.sendMessage(tabId, { type: 'TOGGLE_TOOLBAR' });
        return;
      } catch {
        if (i < 2) await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  async function broadcastToActiveTabs(msg: BackgroundResponse): Promise<void> {
    const promises = Array.from(activeToolbarTabs).map((tabId) =>
      browser.tabs.sendMessage(tabId, msg).catch(() => {
        // Tab may have been closed — remove from active set
        activeToolbarTabs.delete(tabId);
      }),
    );
    await Promise.allSettled(promises);
  }
});
