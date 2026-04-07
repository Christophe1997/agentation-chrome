import { loadSettings, saveSettings } from '../../lib/storage';
import type { ExtensionSettings, OutputDetailLevel } from '../../lib/types';

async function init(): Promise<void> {
  const settings = await loadSettings();
  renderForm(settings);
  attachHandlers();
  updateAnnotationCount();
}

function renderForm(settings: ExtensionSettings): void {
  const urlInput = document.getElementById('server-url') as HTMLInputElement;
  urlInput.value = settings.serverUrl;

  const radios = document.querySelectorAll<HTMLInputElement>('input[name="detailLevel"]');
  for (const radio of radios) {
    radio.checked = radio.value === settings.detailLevel;
  }
}

function attachHandlers(): void {
  const testBtn = document.getElementById('test-connection') as HTMLButtonElement;
  testBtn.addEventListener('click', () => void onTestConnection());

  const saveBtn = document.getElementById('save-settings') as HTMLButtonElement;
  saveBtn.addEventListener('click', () => void onSaveSettings());

  const clearBtn = document.getElementById('clear-all-data') as HTMLButtonElement;
  clearBtn.addEventListener('click', () => void onClearAll());
}

async function onSaveSettings(): Promise<void> {
  const urlInput = document.getElementById('server-url') as HTMLInputElement;
  const selectedRadio = document.querySelector<HTMLInputElement>('input[name="detailLevel"]:checked');

  const newSettings: ExtensionSettings = {
    serverUrl: urlInput.value.trim() || 'http://localhost:4747',
    detailLevel: (selectedRadio?.value ?? 'standard') as OutputDetailLevel,
  };

  await saveSettings(newSettings);
  showToast('Settings saved.');
}

async function onTestConnection(): Promise<void> {
  const urlInput = document.getElementById('server-url') as HTMLInputElement;
  const statusEl = document.getElementById('connection-status') as HTMLElement;
  const serverUrl = urlInput.value.trim() || 'http://localhost:4747';

  statusEl.textContent = 'Testing...';
  statusEl.className = 'connection-status connection-status--testing';
  statusEl.hidden = false;

  try {
    const response = await fetch(`${serverUrl}/health`);
    if (response.ok) {
      showConnectionStatus('Connected', 'connected');
    } else {
      showConnectionStatus('Unreachable', 'error');
    }
  } catch {
    showConnectionStatus('Unreachable', 'error');
  }
}

function showConnectionStatus(text: string, state: 'connected' | 'error' | 'testing'): void {
  const statusEl = document.getElementById('connection-status') as HTMLElement;
  statusEl.textContent = text;
  statusEl.className = `connection-status connection-status--${state}`;
  statusEl.hidden = false;
}

async function onClearAll(): Promise<void> {
  if (!window.confirm('Delete all Agentation annotations? This cannot be undone.')) return;
  // Clear via storage directly — clear all keys
  const { storage } = await import('wxt/utils/storage');
  const annotationsItem = storage.defineItem<Record<string, unknown>>('local:annotations', { fallback: {} });
  await annotationsItem.setValue({});
  updateAnnotationCount();
  showToast('All data cleared.');
}

async function updateAnnotationCount(): Promise<void> {
  const countEl = document.getElementById('annotation-count') as HTMLElement;
  try {
    const { storage } = await import('wxt/utils/storage');
    const annotationsItem = storage.defineItem<Record<string, unknown[]>>('local:annotations', { fallback: {} });
    const all = await annotationsItem.getValue();
    const total = Object.values(all).reduce((sum, arr) => sum + arr.length, 0);
    countEl.textContent = String(total);
  } catch {
    countEl.textContent = '—';
  }
}

function showToast(message: string): void {
  const toast = document.getElementById('save-toast') as HTMLElement;
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 2500);
}

void init();
