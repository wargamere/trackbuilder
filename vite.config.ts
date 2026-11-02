import { defineConfig } from 'vite';

/**
 * Build modes:
 *   vite build --mode web          -> dist/web
 *   vite build --mode crazygames   -> dist/crazygames
 *
 * The platform flag is baked in at build time as `__PLATFORM__` and is only
 * read inside src/platform/. Every asset path is relative (`base: './'`), which
 * CrazyGames requires because builds are served from a nested CDN folder.
 */
export default defineConfig(({ mode }) => {
  const platform = mode === 'crazygames' ? 'crazygames' : 'web';
  return {
    base: './',
    define: {
      __PLATFORM__: JSON.stringify(platform),
    },
    build: {
      outDir: `dist/${platform}`,
      emptyOutDir: true,
      target: 'es2020',
      // Inline every small asset so the build stays at index.html + one JS file.
      assetsInlineLimit: 1024 * 1024,
      modulePreload: { polyfill: false },
      // The CSS minifier drops the -moz-/-ms- user-select prefixes CrazyGames asks for.
      cssMinify: false,
      reportCompressedSize: false,
    },
    server: { host: true },
  };
});
