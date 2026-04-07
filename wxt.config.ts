import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Agentation',
    version: '0.1.0',
    description: 'Visual feedback toolbar for any website',
    action: {},
    permissions: ['storage', 'activeTab', 'scripting', 'alarms'],
    host_permissions: ['<all_urls>', 'http://localhost:4747/*', 'http://localhost:14747/*'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';",
    },
    commands: {
      'toggle-toolbar': {
        suggested_key: { default: 'Ctrl+Shift+A', mac: 'Command+Shift+A' },
        description: 'Toggle Agentation toolbar',
      },
    },
  },
});
