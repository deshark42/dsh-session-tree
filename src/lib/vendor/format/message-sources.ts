/** Native source admission preserves unknown attribution and refuses retired plugin wrappers. */

import { SessionFormatError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent } from '@deepseek-ai/dsh-session-format'
import { mapEventMessages } from './sources.ts'

function source(message: Readonly<Record<string, unknown>>): void {
  const value = message['source']
  if (!isSessionFormatJsonObject(value) || typeof value['kind'] !== 'string' || value['kind'].length === 0 || value['kind'] === 'plugin') {
    throw new SessionFormatError('format v4 message requires a producer-owned source kind')
  }
}

/**
 * Validate producer attribution in every declared durable message slot.
 * @param event - complete native V4 event before Session adoption.
 */
export function assertV4MessageSources(event: SessionFormatEvent): void {
  mapEventMessages(event, (message) => {
    source(message)
    return message
  })
}
