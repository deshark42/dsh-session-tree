/** Declared message traversal for native V4 validation. */

import { SessionFormatError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatJsonObject, SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'

/**
 * Visit only messages carried by first-party event payloads.
 * @param event - source or target logical event.
 * @param transform - message transform preserving unchanged identity.
 * @returns the event sharing all untouched payloads.
 */
export function mapEventMessages(
  event: SessionFormatEvent,
  transform: (message: SessionFormatJsonObject) => SessionFormatJsonObject,
): SessionFormatEvent {
  const data = event.data
  if (!isSessionFormatJsonObject(data)) return event
  if (event.type === 'user/message') {
    const message = transform(data)
    return message === data ? event : { ...event, data: message }
  }
  if (event.type === 'developer/message' || event.type === 'system/message' || event.type === 'assistant/message' || event.type === 'tool/result') {
    if (!isSessionFormatJsonObject(data['message'])) throw new SessionFormatError(event.type + ' requires a message')
    const message = transform(data['message'])
    return message === data['message'] ? event : { ...event, data: { ...data, message } }
  }
  const key = event.type === 'agent/inbox/spliced' ? 'inserted' : event.type === 'session/title-llm-request' ? 'messages' : undefined
  if (key === undefined) return event
  const messages = data[key]
  if (!Array.isArray(messages)) throw new SessionFormatError(event.type + ' requires message array')
  const mapped = (messages as readonly SessionFormatJsonValue[]).map((message) => {
    if (!isSessionFormatJsonObject(message)) throw new SessionFormatError(event.type + ' requires message objects')
    return transform(message)
  })
  return mapped.every((message, index) => message === messages[index]) ? event : { ...event, data: { ...data, [key]: mapped } }
}
