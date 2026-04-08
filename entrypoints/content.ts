import { AgentationApp } from '../lib/app';
import '../ui/shared.css';
import '../ui/toolbox/toolbox.css';
import '../ui/dialog/dialog.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',
  registration: 'runtime',

  async main(ctx) {
    let app: AgentationApp | null = null;

    const ui = await createShadowRootUi(ctx, {
      name: 'agentation-toolbar',
      position: 'overlay',
      mode: 'open',
      isolateEvents: true,
      inheritStyles: false,

      onMount(container, shadow) {
        const instance = new AgentationApp(container, shadow);
        app = instance;
        return instance;
      },

      onRemove(instance) {
        instance?.destroy();
        app = null;
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
        return;
      }

      // Commands that require the toolbar to be mounted
      if (!ui.mounted || !app) return;

      if (msg.type === 'TOGGLE_ANNOTATE') {
        app.toggleAnnotateMode();
      } else if (msg.type === 'TOGGLE_FREEZE') {
        app.toggleFreeze();
      } else if (msg.type === 'COPY_MARKDOWN') {
        app.copyMarkdown();
      }
    });

    // Do NOT auto-mount — wait for explicit activation via TOGGLE_TOOLBAR
  },
});
