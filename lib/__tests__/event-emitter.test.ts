import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../event-emitter';
import type { Annotation } from '../types';

function makeAnnotation(id: string): Annotation {
  return {
    id,
    x: 10,
    y: 20,
    comment: 'test',
    element: 'button',
    elementPath: 'body > button',
    timestamp: Date.now(),
  };
}

describe('EventEmitter', () => {
  it('calls listener when event is emitted', () => {
    const ee = new EventEmitter();
    const fn = vi.fn();
    ee.on('annotate-mode', fn);
    ee.emit('annotate-mode', true);
    expect(fn).toHaveBeenCalledWith(true);
  });

  it('calls multiple listeners for the same event', () => {
    const ee = new EventEmitter();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    ee.on('freeze-toggle', fn1);
    ee.on('freeze-toggle', fn2);
    ee.emit('freeze-toggle', false);
    expect(fn1).toHaveBeenCalledWith(false);
    expect(fn2).toHaveBeenCalledWith(false);
  });

  it('does not call listener after off()', () => {
    const ee = new EventEmitter();
    const fn = vi.fn();
    ee.on('list-toggle', fn);
    ee.off('list-toggle', fn);
    ee.emit('list-toggle', true);
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe function from on()', () => {
    const ee = new EventEmitter();
    const fn = vi.fn();
    const unsub = ee.on('annotate-mode', fn);
    unsub();
    ee.emit('annotate-mode', true);
    expect(fn).not.toHaveBeenCalled();
  });

  it('removeAllListeners() stops all events', () => {
    const ee = new EventEmitter();
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    ee.on('annotate-mode', fn1);
    ee.on('freeze-toggle', fn2);
    ee.removeAllListeners();
    ee.emit('annotate-mode', true);
    ee.emit('freeze-toggle', true);
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).not.toHaveBeenCalled();
  });

  it('emits multi-arg events correctly', () => {
    const ee = new EventEmitter();
    const fn = vi.fn();
    ee.on('sync-status-changed', fn);
    ee.emit('sync-status-changed', 'abc123', 'synced');
    expect(fn).toHaveBeenCalledWith('abc123', 'synced');
  });

  it('emits annotation objects', () => {
    const ee = new EventEmitter();
    const fn = vi.fn();
    const annotation = makeAnnotation('ann-1');
    ee.on('annotation-submit', fn);
    ee.emit('annotation-submit', annotation);
    expect(fn).toHaveBeenCalledWith(annotation);
  });

  it('does not throw when emitting to event with no listeners', () => {
    const ee = new EventEmitter();
    expect(() => ee.emit('popup-close')).not.toThrow();
  });
});
