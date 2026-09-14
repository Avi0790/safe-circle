import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Share one .env with the mobile app instead of duplicating
  // VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY per-package.
  envDir: '..',
})
