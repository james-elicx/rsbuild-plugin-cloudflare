import { bindings, defineConfig } from 'cf/config'

export default defineConfig({
  worker: {
    name: 'tanstack-start-app',
    entrypoint: '@tanstack/react-start/server-entry',
    compatibilityDate: '2025-09-24',
    compatibilityFlags: ['nodejs_compat'],
    env: {
      MY_VAR: bindings.text('Hello from Cloudflare'),
    },
  },
})
