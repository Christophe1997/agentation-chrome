export type AnnotationKind = 'feedback';

export type AnnotationStatus = 'pending' | 'acknowledged' | 'resolved' | 'dismissed';

export type OutputDetailLevel = 'compact' | 'standard' | 'detailed' | 'forensic';
export type ReactComponentMode = 'off' | 'all' | 'filtered' | 'smart';

export interface NearbyElement {
  tag: string;
  text?: string;
  class?: string;
}

export interface ThreadMessage {
  author: string;
  content: string;
  timestamp: string;
}

export interface AccessibilityInfo {
  role?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  tabIndex?: number;
  focusable: boolean;
}

export interface Annotation {
  id: string;                    // client-generated UUID
  serverId?: string;             // assigned by MCP server
  x: number;
  y: number;
  comment: string;
  element: string;               // human-readable name
  elementPath: string;           // CSS selector path
  timestamp: number;
  selectedText?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  nearbyText?: string;
  cssClasses?: string[];
  nearbyElements?: NearbyElement[];
  computedStyles?: Record<string, string>;
  fullPath?: string;
  accessibility?: AccessibilityInfo;
  reactComponents?: string[];
  sourceFile?: string;           // Phase 2: deferred
  // Protocol fields
  url?: string;
  intent?: string;
  severity?: string;
  status?: AnnotationStatus;
  thread?: ThreadMessage[];
  createdAt?: string;
  updatedAt?: string;
}

export interface Session {
  id: string;
  url: string;
  domain: string;
  createdAt: string;
}

export interface SessionInfo {
  sessionId: string;
  url: string;
  serverId?: string;
}

export type AnnotationSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export type ExtensionSettings = {
  serverUrl: string;
  detailLevel: OutputDetailLevel;
};

export type RetryEntry = {
  annotationId: string;
  sessionId: string;
  serverId?: string;
  operation: 'create' | 'update' | 'delete';
  annotation?: Annotation;
  retryCount: number;
  lastRetryAt: number;
  nextRetryAt: number;
};
