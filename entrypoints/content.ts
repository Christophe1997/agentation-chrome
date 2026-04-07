import { AgentationApp } from '../lib/app';

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',
  registration: 'runtime',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'agentation-toolbar',
      position: 'overlay',
      mode: 'open',
      isolateEvents: true,
      inheritStyles: false,

      onMount(container, shadow) {
        return new AgentationApp(container, shadow);
      },

      onRemove(app) {
        app?.destroy();
      },
    });

    browser.runtime.onMessage.addListener((msg: { type: string }, sender) => {
      // Only accept messages from background (no sender.tab)
      if (sender.tab) return;

      if (msg.type === 'TOGGLE_TOOLBAR') {
        // Resolve tab ID before sending activation messages
        const sendToggle = async (type: 'TOOLBAR_ACTIVATED' | 'TOOLBAR_DEACTIVATED') => {
          try {
            const tab = await browser.tabs.getCurrent();
            const tabId = tab?.id ?? -1;
            await browser.runtime.sendMessage({ type, tabId });
          } catch {
            // Extension context invalidated — ignore
          }
        };

        if (ui.mounted) {
          ui.remove();
          sendToggle('TOOLBAR_DEACTIVATED');
        } else {
          ui.mount();
          sendToggle('TOOLBAR_ACTIVATED');
        }
      }
    });

    // Do NOT auto-mount — wait for explicit activation via TOGGLE_TOOLBAR
  },
});
