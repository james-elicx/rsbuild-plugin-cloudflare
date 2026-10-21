import { tanstackStart } from '@tanstack/react-start/plugin/rsbuild'
import { defineConfig } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss'
import { cloudflare } from 'rsbuild-plugin-cloudflare'

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    pluginTailwindcss(),
    pluginReact(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart({
      srcDirectory: 'src',
      // The Worker serves the app in workerd, rather than Rsbuild's dev server
      // in Node.js.
      rsbuild: { installDevServerMiddleware: false },
    }),
  ],
})
