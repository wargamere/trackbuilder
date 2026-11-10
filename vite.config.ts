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
 * CrazyGames build: one self-contained index.html, as the Developer Portal
 * takes a single file. The game's code goes inline in it (as a module script,
 * so it still runs after the SDK, which loads first in <head>), and the
 * third-party notices in a comment at the top, so they ship in every copy.
 */
function singleFile(): Plugin {
  return {
    name: 'single-file',
    enforce: 'post',
    generateBundle(_, bundle) {
      const page = bundle['index.html'];
      if (!page || page.type !== 'asset') throw new Error('single-file: no index.html');
      let html = String(page.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type !== 'chunk') continue;
        const tag = new RegExp(`<script[^>]*src="\\./${file.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*></script>`);
        if (!tag.test(html)) throw new Error(`single-file: no script tag for ${file.fileName}`);
        // (A "</script" inside the code would end the tag early; written "<\/script" it means the same.)
        const code = file.code.replace(/<\/script/gi, '<\\/script');
        html = html.replace(tag, () => `<script type="module">${code}</script>`);
        delete bundle[name];
      }
      const notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8').replace(/-->/g, '- ->');
      html = html.replace(/^(<!doctype html>\s*)/i, `$1<!--\n${notices}\n-->\n`);
      page.source = html;
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
    // (The CrazyGames build is one file: its notices go inside it.)
    plugins: platform === 'crazygames' ? [crazyGamesSdk(), singleFile()] : [thirdPartyNotices()],
    define: {
      __PLATFORM__: JSON.stringify(platform),
      __ADS__: JSON.stringify(platform === 'crazygames' && process.env.ADS === '1'),
    },
    build: {
      outDir: `dist/${platform}`,
      emptyOutDir: true,
      target: 'es2020',
      // Inline every asset: the web build is index.html + one JS file, the CrazyGames build index.html alone.
      assetsInlineLimit: 1024 * 1024,
      modulePreload: { polyfill: false },
      // The CSS minifier drops the -moz-/-ms- user-select prefixes CrazyGames asks for.
      cssMinify: false,
      reportCompressedSize: false,
    },
    server: { host: true },
  };
});
