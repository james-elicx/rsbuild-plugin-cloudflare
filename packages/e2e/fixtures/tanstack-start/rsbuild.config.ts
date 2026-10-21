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
    cloudflare({ rsbuildEnvironment: { name: 'ssr' } }),
    tanstackStart({
      srcDirectory: 'src',
    }),
  ],
})
