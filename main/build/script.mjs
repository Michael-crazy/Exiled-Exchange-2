import child_process from 'child_process'
import fs from 'fs'
import electron from 'electron'
import esbuild from 'esbuild'

const isDev = !process.argv.includes('--prod')

const electronRunner = (() => {
  let handle = null
  return {
    restart () {
      console.info('Restarting Electron process.')

      if (handle) handle.kill()
      handle = child_process.spawn(electron, ['.'], {
        stdio: 'inherit'
      })
    }
  }
})()

const visionBuild = await esbuild.build({
  entryPoints: ['src/vision/link-worker.ts'],
  bundle: true,
  platform: 'node',
  outfile: 'dist/vision.js'
})

// PoE2 assistant M09b: the trade window's preload, and the extension's page
// script it runs (trade-preview/, copied from poe-trade2text; see SOURCE.md).
await esbuild.build({
  entryPoints: ['src/trade-preload.ts'],
  bundle: true,
  minify: !isDev,
  platform: 'node',
  external: ['electron'],
  outfile: 'dist/trade-preload.js'
})
fs.cpSync('trade-preview', 'dist/trade-preview', {
  recursive: true,
  filter: (src) => !src.endsWith('.md') && !src.endsWith('.mjs')
})

const mainContext = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: !isDev,
  platform: 'node',
  external: ['electron', 'uiohook-napi', 'electron-overlay-window'],
  outfile: 'dist/main.js',
  define: {
    'process.env.STATIC': (isDev) ? '"../build/icons"' : '"."',
    'process.env.VITE_DEV_SERVER_URL': (isDev) ? '"http://localhost:5173"' : 'null'
  },
  plugins: (isDev) ? [{
    name: 'electron-runner',
    setup (build) {
      build.onEnd((result) => {
        if (!result.errors.length) electronRunner.restart()
      })
    }
  }] : []
})

if (isDev) {
  await mainContext.watch()
} else {
  await mainContext.rebuild()
  mainContext.dispose()
}
