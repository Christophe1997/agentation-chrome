import type { Annotation, ExtensionSettings, Session } from '../lib/types';

// Content → Background
export type ContentRequest =
  | { type: 'CREATE_SESSION'; requestId: string; url: string; domain: string }
  | { type: 'SYNC_ANNOTATION'; requestId: string; sessionId: string; annotation: Annotation }
  | { type: 'UPDATE_ANNOTATION'; requestId: string; serverId: string; changes: Partial<Annotation> }
  | { type: 'DELETE_ANNOTATION'; requestId: string; serverId: string }
  | { type: 'CLEAR_ANNOTATIONS'; requestId: string; sessionId: string }
  | { type: 'CHECK_SERVER_HEALTH'; requestId: string }
  | { type: 'GET_SETTINGS'; requestId: string }
  | { type: 'SAVE_SETTINGS'; requestId: string; settings: ExtensionSettings }
  | { type: 'TOOLBAR_ACTIVATED'; tabId: number }
  | { type: 'TOOLBAR_DEACTIVATED'; tabId: number }
  | { type: 'OPEN_OPTIONS' };

// Background → Content (responses)
export type BackgroundResponse =
  | { type: 'SESSION_CREATED'; requestId: string; session: Session }
  | { type: 'SYNC_SUCCESS'; requestId: string; annotationId: string; serverId: string }
  | { type: 'UPDATE_SUCCESS'; requestId: string; serverId: string }
  | { type: 'DELETE_SUCCESS'; requestId: string }
  | { type: 'CLEAR_SUCCESS'; requestId: string }
  | { type: 'ANNOTATION_RESOLVED'; requestId: string; annotationId: string; summary: string }
  | { type: 'ANNOTATION_DISMISSED'; requestId: string; annotationId: string; reason: string }
  | { type: 'SERVER_STATUS'; status: 'connected' | 'disconnected' | 'unknown' }
  | { type: 'SETTINGS'; requestId: string; settings: ExtensionSettings }
  | { type: 'ERROR'; requestId: string; code: ErrorCode; message: string };

// Background → Content (push events, no requestId)
export type BackgroundPush =
  | { type: 'TOGGLE_TOOLBAR' }
  | { type: 'TOGGLE_ANNOTATE' }
  | { type: 'TOGGLE_FREEZE' }
  | { type: 'COPY_MARKDOWN' }
  | { type: 'SERVER_STATUS'; status: 'connected' | 'disconnected' | 'unknown' };

export type ErrorCode =
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'VALIDATION_ERROR'
  | 'SESSION_NOT_FOUND'
  | 'SYNC_FAILED'
  | 'STORAGE_QUOTA'
  | 'UNKNOWN';

// Compile-time request→response correlation
type RequestTypeMap = {
  CREATE_SESSION: 'SESSION_CREATED';
  SYNC_ANNOTATION: 'SYNC_SUCCESS';
  UPDATE_ANNOTATION: 'UPDATE_SUCCESS';
  DELETE_ANNOTATION: 'DELETE_SUCCESS';
  CLEAR_ANNOTATIONS: 'CLEAR_SUCCESS';
  CHECK_SERVER_HEALTH: 'SERVER_STATUS';
  GET_SETTINGS: 'SETTINGS';
  SAVE_SETTINGS: 'SETTINGS';
};

export type ResponseFor<T extends ContentRequest> =
  T['type'] extends keyof RequestTypeMap
    ? Extract<BackgroundResponse, { type: RequestTypeMap[T['type']] }> | Extract<BackgroundResponse, { type: 'ERROR' }>
    : never;
