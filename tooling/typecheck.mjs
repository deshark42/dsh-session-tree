import { createRequire } from 'node:module'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(process.env.DSH_SOURCE ?? join(workspace, '../deepseek-harness'))
const ts = createRequire(join(source, 'package.json'))('typescript')
const runtime = resolve(process.env.DSH_TEST_RUNTIME ?? join(workspace, '.artifacts/stock-runtime'))
const requireRuntime = createRequire(join(runtime, 'package.json'))
const config = ts.readConfigFile(join(source, 'tsconfig.base.json'), ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, source)
const declarationPaths = Object.fromEntries(Object.entries(parsed.options.paths).map(([key, targets]) => [key, targets.map(target => {
  const packageName = key.split('/').slice(0, 2).join('/')
  try {
    const manifestPath = requireRuntime.resolve(`${packageName}/package.json`)
    const suffix = key.slice(packageName.length)
    const manifest = requireRuntime(manifestPath)
    if (suffix === '') return join(dirname(manifestPath), manifest.types)
    return join(dirname(manifestPath), 'lib/types', suffix.slice(1).replace(/\.(?:ts|tsx)$/, '.d.ts'))
  } catch { return resolve(source, target.replace(/\/src(?=\/|$)/, '/lib/types').replace(/\.(?:ts|tsx)$/, '.d.ts')) }
})]))
declarationPaths.react = [join(source, 'packages/client/ui-chat/node_modules/@types/react/index.d.ts')]
declarationPaths['react/*'] = [join(source, 'packages/client/ui-chat/node_modules/@types/react/*.d.ts')]
declarationPaths['react-dom'] = [join(source, 'packages/client/ui-chat/node_modules/@types/react-dom/index.d.ts')]
const options = {
  ...parsed.options,
  // This external package consumes the built Host declarations, as an installed plugin does.
  paths: declarationPaths,
  jsx: ts.JsxEmit.ReactJSX,
  lib: ['lib.es2024.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts', 'lib.esnext.disposable.d.ts'],
  allowJs: true, checkJs: true, noEmit: true, composite: false, incremental: false,
  noUnusedLocals: true, noUnusedParameters: true,
  typeRoots: [join(source, 'node_modules/@types')],
}
// Host and Client have distinct Context service merges and compile as separate programs.
const diagnostics = [
  [join(workspace, 'src/index.js')],
  [join(workspace, 'src/client/index.ts'), join(workspace, 'src/client/assets.d.ts')],
].flatMap(roots => ts.getPreEmitDiagnostics(ts.createProgram(roots, options)))
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => workspace, getCanonicalFileName: name => name, getNewLine: () => '\n',
  }))
  process.exitCode = 1
} else console.log('Plugin typecheck passed.')
