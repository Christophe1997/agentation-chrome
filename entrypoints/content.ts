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
        if (ui.mounted) {
          ui.remove();
          browser.runtime.sendMessage({ type: 'TOOLBAR_DEACTIVATED', tabId: -1 }).catch(() => {});
        } else {
          ui.mount();
          browser.runtime.sendMessage({ type: 'TOOLBAR_ACTIVATED', tabId: -1 }).catch(() => {});
        }
      }
    });

    // Do NOT auto-mount — wait for explicit activation via TOGGLE_TOOLBAR
  },
});
