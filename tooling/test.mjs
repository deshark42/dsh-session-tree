import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(process.env.DSH_SOURCE ?? join(workspace, '../deepseek-harness'))
const requireDsh = createRequire(join(source, 'package.json'))
const requireChat = createRequire(join(source, 'packages/client/ui-chat/package.json'))
const runtime = resolve(process.env.DSH_TEST_RUNTIME ?? join(workspace, '.artifacts/stock-runtime'))
const requireRuntime = createRequire(join(runtime, 'package.json'))
const ts = requireDsh('typescript')
const paths = ts.readConfigFile(join(source, 'tsconfig.base.json'), ts.sys.readFile).config.compilerOptions.paths
const aliases = Object.entries(paths).map(([key, [target]]) => {
  const find = '^' + key.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*)') + '$'
  return `{ find: new RegExp(${JSON.stringify(find)}), replacement: ${JSON.stringify(resolve(source, target).replaceAll('\\', '/').replace('*', '$1'))} }`
})
const stockAliases = Object.keys(paths).filter(key => !key.includes('*') && !key.includes('/client') && !key.startsWith('@deepseek-ai/dsh-client-')).flatMap(key => {
  try { return [`{ find: new RegExp(${JSON.stringify('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')}), replacement: ${JSON.stringify(requireRuntime.resolve(key).replaceAll('\\', '/'))} }`] }
  catch { return [] }
})
const config = join(workspace, '.artifacts/vitest.config.mjs')
await mkdir(dirname(config), { recursive: true })
await writeFile(config, `
import { defineConfig } from ${JSON.stringify(pathToFileURL(requireDsh.resolve('vitest/config')).href)};
import { standardDecoratorPlugin } from ${JSON.stringify(pathToFileURL(join(source, 'vitest.shared.ts')).href)};
export default defineConfig({
  root: ${JSON.stringify(workspace)},
  plugins: [standardDecoratorPlugin()],
  resolve: { alias: [
    { find: 'react/jsx-runtime', replacement: ${JSON.stringify(requireChat.resolve('react/jsx-runtime'))} },
    { find: 'react/jsx-dev-runtime', replacement: ${JSON.stringify(requireChat.resolve('react/jsx-dev-runtime'))} },
    { find: 'react', replacement: ${JSON.stringify(requireChat.resolve('react'))} },
    { find: 'react-dom/client', replacement: ${JSON.stringify(requireChat.resolve('react-dom/client'))} },
    { find: 'react-dom', replacement: ${JSON.stringify(requireChat.resolve('react-dom'))} },
    { find: '@testing-library/react', replacement: ${JSON.stringify(requireDsh.resolve('@testing-library/react'))} },
    { find: '@dsh-test/chat-snapshot-fixture', replacement: ${JSON.stringify(join(source, 'packages/client/ui-chat/tests/chat-snapshot-fixture.client.ts').replaceAll('\\', '/'))} },
    { find: /^vitest$/, replacement: ${JSON.stringify(join(dirname(requireDsh.resolve('vitest/package.json')), 'dist/index.js'))} },
    { find: new RegExp('^@deepseek-ai/dsh-client-ui-chat/src/(.*)$'), replacement: ${JSON.stringify(join(source, 'packages/client/ui-chat/src/$1').replaceAll('\\', '/'))} },
    { find: new RegExp('^@deepseek-ai/dsh-client-locale/src/(.*)$'), replacement: ${JSON.stringify(join(source, 'packages/client/locale/src/$1').replaceAll('\\', '/'))} },
    { find: '@dsh-test/mock-adapter', replacement: ${JSON.stringify(join(source, 'packages/core/agent-loop/tests/mock-adapter.ts').replaceAll('\\', '/'))} },
    ${stockAliases.join(',\n')},
    ${aliases.join(',\n')}
  ] },
  test: { include: ['tests/**/*.spec.{ts,tsx}'], testTimeout: 15000, pool: 'forks' }
});
`)
const child = spawn(process.execPath, [join(source, 'node_modules/vitest/vitest.mjs'), 'run', '--configLoader', 'native', '--config', config, ...process.argv.slice(2)], {
  cwd: workspace, stdio: 'inherit', env: { ...process.env, DSH_SOURCE: source },
})
child.on('error', error => { console.error(error); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
