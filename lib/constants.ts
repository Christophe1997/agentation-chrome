export const Z_INDEX = {
  MARKER: 2147483646,
  TOOLBAR: 2147483647,
  DIALOG: 2147483647,
  LIST_PANEL: 2147483645,
} as const;

export const SELECTORS = {
  ROOT: '[data-agt-root]',
  MARKER: '[data-agt-marker]',
  EXTENSION: '[data-agt-ext]',
  FREEZE_STYLE_ID: 'agt-ext-freeze-styles',
} as const;

export const LIMITS = {
  MAX_RETRIES: 10,
  RETRY_BASE_DELAY_MS: 1000,
  RETRY_MAX_DELAY_MS: 30000,
  HEALTH_CHECK_INTERVAL_MIN: 0.5,
  ANNOTATION_EXPIRY_DAYS: 7,
  FREEZE_QUEUE_CAP: 500,
  REACT_FIBER_DEPTH_LIMIT: 30,
  REACT_FIBER_TIME_BUDGET_MS: 10,
} as const;
