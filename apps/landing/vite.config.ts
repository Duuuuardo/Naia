import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    tsConfigPaths({ projects: ['./tsconfig.json'] }),
    tanstackStart({ srcDirectory: 'app' }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: Number(process.env.NAIA_LANDING_PORT ?? 3301),
    strictPort: true,
  },
})
