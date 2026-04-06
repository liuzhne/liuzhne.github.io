// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://liuzhne.github.io',
  base: '/blog',
  trailingSlash: 'always',
  vite: {
    plugins: [tailwindcss()]
  }
});