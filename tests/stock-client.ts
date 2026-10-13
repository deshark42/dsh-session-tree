import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import * as JSX from 'react/jsx-runtime'
import * as ReactDom from 'react-dom'
import * as Cordis from '@deepseek-ai/cordis'
import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as Store from '@deepseek-ai/dsh-client-store'
import * as Slots from '@deepseek-ai/dsh-client-ui-slots'

/** Load the untouched npm browser class, without routing to patched source. */
export function stockConversation() {
  let module: typeof import('@deepseek-ai/dsh-client-ui-conversation/client') | undefined
  const shared = new Map<string, object>([
    ['react', React], ['react/jsx-runtime', JSX], ['react-dom', ReactDom],
    ['@deepseek-ai/cordis', Cordis], ['@deepseek-ai/dsh-client-ui-primitives', Primitives],
    ['@deepseek-ai/dsh-client-store', Store], ['@deepseek-ai/dsh-client-ui-slots', Slots],
  ])
  const filename = join(process.cwd(), '.artifacts/stock-runtime/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js')
  runInNewContext(readFileSync(filename, 'utf8'), {
    window: { __ModuleLoader__: { load({ factory }: { factory: (require: (name: string) => object) => typeof module }) {
      module = factory(name => {
        const value = shared.get(name)
        if (value === undefined) throw new Error(`Stock Conversation external missing: ${name}`)
        return value
      })
    } } }, console, setTimeout, clearTimeout, queueMicrotask,
  })
  if (module === undefined) throw new Error('Stock Conversation did not load')
  return module
}
