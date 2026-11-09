import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** The CrazyGames SDK must load in <head>, before the game code (CrazyGames build only). */
const CRAZYGAMES_SDK = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

function crazyGamesSdk(): Plugin {
  return {
    name: 'crazygames-sdk',
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { src: CRAZYGAMES_SDK }, injectTo: 'head-prepend' }];
    },
  };
}

/**
 * Ships the third-party notices (the MIT licence of the real-circuit outlines)
 * with every build, as a plain text file beside index.html: the licence asks
 * for its notice in all copies, and a file needs no link in the game.
 */
function thirdPartyNotices(): Plugin {
  return {
    name: 'third-party-notices',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: readFileSync('THIRD_PARTY_NOTICES.md', 'utf8') });
    },
  };
}

/**
 * Build modes:
 *   vite build --mode web          -> dist/web
 *   vite build --mode crazygames   -> dist/crazygames
 * Set ADS=1 to enable video ads (CrazyGames Full Launch; ads are disabled in Basic Launch).
 *
 * The platform flag is baked in at build time as `__PLATFORM__` and is only
 * read inside src/platform/. Every asset path is relative (`base: './'`), which
 * CrazyGames requires because builds are served from a nested CDN folder.
 */
export default defineConfig(({ mode }) => {
  const platform = mode === 'crazygames' ? 'crazygames' : 'web';
  return {
    base: './',
    plugins: platform === 'crazygames' ? [crazyGamesSdk(), thirdPartyNotices()] : [thirdPartyNotices()],
    define: {
      __PLATFORM__: JSON.stringify(platform),
      __ADS__: JSON.stringify(platform === 'crazygames' && process.env.ADS === '1'),
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
