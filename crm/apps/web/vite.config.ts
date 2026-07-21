import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    tsConfigPaths({ projects: ['./tsconfig.json'] }),
    tanstackStart({ srcDirectory: 'app', server: { preset: 'bun' } }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: Number(process.env.CRM_WEB_PORT ?? 3302),
    strictPort: true,
  },
})
