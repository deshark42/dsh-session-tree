import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(process.env.DSH_SOURCE ?? join(workspace, '../deepseek-harness'))
const requireDsh = createRequire(join(source, 'package.json'))
const { build } = await import(pathToFileURL(requireDsh.resolve('tsdown')).href)
const { transform } = requireDsh('lightningcss')
const manifest = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8'))
const ts = requireDsh('typescript')
const paths = ts.readConfigFile(join(source, 'tsconfig.base.json'), ts.sys.readFile).config.compilerOptions.paths
const browserShared = new Set(['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-conversation/client'])
const hostShared = new Set(['@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session/types', '@deepseek-ai/dsh-session-format', '@deepseek-ai/dsh-session-format-catalog', '@deepseek-ai/dsh-compaction-image-offload/projection'])
function resolution(shared, browser = false) {
  return {
    name: 'shared-dsh-runtime',
    resolveId(name) {
      if (shared.has(name)) return { id: browser ? name.replace(/\/client$/, '') : name, external: true }
      if (!name.startsWith('@deepseek-ai/')) return null
      for (const [pattern, [target]] of Object.entries(paths)) {
        const [prefix, suffix] = pattern.split('*')
        if ((suffix === undefined && name === prefix) || (suffix !== undefined && name.startsWith(prefix) && name.endsWith(suffix))) {
          const resolved = resolve(source, target.replace('*', name.slice(prefix.length, suffix?.length ? -suffix.length : undefined)))
          return statSync(resolved).isDirectory() ? join(resolved, 'index.ts') : resolved
        }
      }
      return null
    },
  }
}
await mkdir(join(workspace, 'lib'), { recursive: true })
await build({
  config: false, cwd: workspace, entry: ['src/index.js'],
  outDir: 'lib', format: 'esm', platform: 'node', target: 'node22',
  dts: false, sourcemap: true, clean: false,
  deps: { neverBundle: name => hostShared.has(name) || name.startsWith('node:'), alwaysBundle: name => !hostShared.has(name) && !name.startsWith('node:') },
  plugins: [resolution(hostShared)], outputOptions: { entryFileNames: 'host.js' },
})
// dsh's browser loader expects a CJS closure factory, with shared modules supplied by require.
await build({
  config: false, cwd: workspace, entry: ['src/client/index.ts'],
  outDir: 'lib', format: 'cjs', platform: 'browser', target: 'es2022',
  dts: false, sourcemap: true, clean: false,
  deps: { neverBundle: name => browserShared.has(name), alwaysBundle: name => !browserShared.has(name) },
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'import.meta.env.MODE': JSON.stringify('production') },
  plugins: [resolution(browserShared, true), {
    name: 'delete-last-turn-css-text',
    async load(id) {
      const module = id.endsWith('.module.css?module')
      if (!module && !id.endsWith('.css?inline')) return null
      const filename = id.slice(0, -7)
      const { code, exports } = transform({ filename, code: await readFile(filename), minify: true, cssModules: module ? { pattern: 'dsh-delete-[name]-[local]' } : undefined })
      if (module) return `export const stylesheet = ${JSON.stringify(code.toString())}; export default ${JSON.stringify(Object.fromEntries(Object.entries(exports).map(([name, value]) => [name, value.name])))};`
      return `export default ${JSON.stringify(code.toString())};`
    },
  }],
  outputOptions: {
    paths: name => name.replace(/\/client$/, ''),
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (runtimeRequire) => { const require = name => { try { return runtimeRequire(name) } catch (error) { console.error('delete-last-turn: failed to require ' + name, error); throw error } };`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})
