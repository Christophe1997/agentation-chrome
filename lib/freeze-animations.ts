import { LIMITS, SELECTORS } from './constants';

// ---------------------------------------------------------------------------
// Saved originals — exported so toolbar code can schedule its own animations
// without going through the patched versions during a freeze.
// ---------------------------------------------------------------------------
export const originalSetTimeout: typeof setTimeout = globalThis.setTimeout.bind(globalThis);
export const originalSetInterval: typeof setInterval = globalThis.setInterval.bind(globalThis);
export const originalRAF: typeof requestAnimationFrame =
  globalThis.requestAnimationFrame.bind(globalThis);

// ---------------------------------------------------------------------------
// Module-closure state (NOT on window — avoids collision with React Agentation)
// ---------------------------------------------------------------------------
let frozen = false;
let jsPatchActive = false;

interface QueuedCallback {
  fn: (...args: unknown[]) => void;
  args: unknown[];
}
const callbackQueue: QueuedCallback[] = [];

// WAAPI-paused animations
let pausedAnimations: Animation[] = [];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isFrozen(): boolean {
  return frozen;
}

export function freeze(opts: { patchJS?: boolean } = {}): void {
  if (frozen) return;
  frozen = true;

  _injectFreezeCSS();
  _pauseWAAPIAnimations();
  _pauseVideos();

  if (opts.patchJS) {
    _patchJSTimers();
  }
}

export function unfreeze(): void {
  if (!frozen) return;
  frozen = false;

  if (jsPatchActive) {
    _restoreJSTimers();
    _replayQueuedCallbacks();
  }

  _resumeVideos();
  _resumeWAAPIAnimations();
  _removeFreezeCSS();
}

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------

function _injectFreezeCSS(): void {
  if (document.getElementById(SELECTORS.FREEZE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SELECTORS.FREEZE_STYLE_ID;
  style.textContent = `
:not([data-agt-ext]) {
  animation-play-state: paused !important;
  transition: none !important;
}
`;
  document.head.appendChild(style);
}

function _removeFreezeCSS(): void {
  document.getElementById(SELECTORS.FREEZE_STYLE_ID)?.remove();
}

// ---------------------------------------------------------------------------
// WAAPI
// ---------------------------------------------------------------------------

function _pauseWAAPIAnimations(): void {
  if (typeof document.getAnimations !== 'function') return;
  pausedAnimations = document.getAnimations().filter((a) => {
    const el = (a as { effect?: { target?: Element } }).effect?.target;
    return !el?.closest('[data-agt-ext]');
  });
  pausedAnimations.forEach((a) => a.pause());
}

function _resumeWAAPIAnimations(): void {
  pausedAnimations.forEach((a) => a.play());
  pausedAnimations = [];
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

function _pauseVideos(): void {
  document.querySelectorAll<HTMLVideoElement>('video:not([data-agt-ext])').forEach((v) => v.pause());
}

function _resumeVideos(): void {
  document.querySelectorAll<HTMLVideoElement>('video:not([data-agt-ext])').forEach((v) => {
    try { v.play(); } catch { /* user gesture required; ignore */ }
  });
}

// ---------------------------------------------------------------------------
// JS timer patch
// ---------------------------------------------------------------------------

function _makeQueueingTimeout(): typeof setTimeout {
  return function patchedSetTimeout(handler: TimerHandler, _delay?: number, ...args: unknown[]) {
    if (typeof handler === 'function') {
      if (callbackQueue.length >= LIMITS.FREEZE_QUEUE_CAP) {
        callbackQueue.shift(); // drop oldest
        console.warn('[Agentation] freeze queue cap reached; oldest callback dropped');
      }
      callbackQueue.push({ fn: handler as (...a: unknown[]) => void, args });
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  } as unknown as typeof setTimeout;
}

function _patchJSTimers(): void {
  if (jsPatchActive) return;
  jsPatchActive = true;
  globalThis.setTimeout = _makeQueueingTimeout();
  // setInterval and rAF: simply no-op during freeze (they'd loop anyway)
  globalThis.setInterval = (() => 0) as unknown as typeof setInterval;
  globalThis.requestAnimationFrame = (() => 0) as unknown as typeof requestAnimationFrame;
}

function _restoreJSTimers(): void {
  if (!jsPatchActive) return;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.setInterval = originalSetInterval;
  globalThis.requestAnimationFrame = originalRAF;
  jsPatchActive = false;
}

function _replayQueuedCallbacks(): void {
  const toReplay = callbackQueue.splice(0, callbackQueue.length);
  for (const { fn, args } of toReplay) {
    fn(...args);
  }
}
