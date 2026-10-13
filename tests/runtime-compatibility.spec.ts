import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
it('loads the built plugin on unmodified official npm alpha.2 and restores its decisions', () => {
  const result = spawnSync(process.execPath, ['tooling/check-stock.mjs'], { cwd: process.cwd(), encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('STOCK npm alpha.2')
})
