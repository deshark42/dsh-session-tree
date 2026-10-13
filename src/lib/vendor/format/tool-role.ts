/** First-class tool-role messages in the V4 representation. */

import { SessionFormatError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent } from '@deepseek-ai/dsh-session-format'

/**
 * Validate the native V4 first-class tool-role message of one tool/result row.
 * @param event - canonical V4 event.
 * @throws {SessionFormatError} when the row is not an exact first-class tool result.
 */
export function assertV4ToolResultMessage(event: SessionFormatEvent): void {
  if (event.type !== 'tool/result') return
  const subject = `format v4 ${event.type} at seq ${event.seq}`
  const data = event.data
  if (!isSessionFormatJsonObject(data)) throw new SessionFormatError(`${subject} data must be an object`)
  const message = data['message']
  if (!isSessionFormatJsonObject(message)) throw new SessionFormatError(`${subject} message must be an object`)
  const id = message['id']
  const role = message['role']
  const toolCallId = message['toolCallId']
  const source = message['source']
  const isError = message['isError']
  const content = message['content']
  const sourceCallId = isSessionFormatJsonObject(source) ? source['callId'] : undefined
  if (typeof id !== 'string' || id.length === 0) {
    throw new SessionFormatError(`${subject} requires a first-class message with a string id`)
  }
  if (role !== 'tool') throw new SessionFormatError(`${subject} requires a tool-role message`)
  if (typeof toolCallId !== 'string' || toolCallId.length === 0 || sourceCallId !== toolCallId) {
    throw new SessionFormatError(`${subject} requires toolCallId matching its tool source`)
  }
  if (!isSessionFormatJsonObject(source) || source['kind'] !== 'tool') {
    throw new SessionFormatError(`${subject} requires a tool source`)
  }
  if (!Array.isArray(content)) throw new SessionFormatError(`${subject} requires array content`)
  if (content.some(block => isSessionFormatJsonObject(block) && block['type'] === 'tool-result')) {
    throw new SessionFormatError(`${subject} content must not contain a released tool-result wrapper`)
  }
  if (isError !== undefined && typeof isError !== 'boolean') {
    throw new SessionFormatError(`${subject} isError must be boolean when present`)
  }
  if (data['error'] !== undefined && isError !== true) {
    throw new SessionFormatError(`${subject} carries error metadata for a non-error tool result`)
  }
}
