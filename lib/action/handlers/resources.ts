import { z } from 'zod'
import { resources } from '@/lib/db/repo'
import { envelopeToCtx } from '../context'
import type { Handler } from './types'

const UploadInput = z.object({
  sessionId: z.string(),
  fileRef: z.string(),
  resourceType: z.enum(['pdf', 'md', 'xlsx', 'image', 'link', 'html', 'prompt', 'code']),
  visibility: z.enum(['public', 'session', 'private', 'admin_only']).default('session'),
  title: z.string().optional(),
  tags: z.array(z.string()).optional()
})

export const uploadResource: Handler = async ({ envelope }) => {
  const input = UploadInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await resources.insert(ctx, {
    session_id: input.sessionId,
    type: input.resourceType,
    title: input.title ?? input.fileRef,
    url_or_storage_path: input.fileRef,
    visibility: input.visibility,
    stage_tags: [],
    audience_tags: input.tags ?? []
  })
  return { data: { id: row.id }, summary: `resource ${row.id}` }
}

const LinkInput = z.object({
  sessionId: z.string(),
  url: z.string().url(),
  title: z.string(),
  visibility: z.enum(['public', 'session', 'private', 'admin_only']).default('session'),
  tags: z.array(z.string()).optional()
})

export const attachLink: Handler = async ({ envelope }) => {
  const input = LinkInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await resources.insert(ctx, {
    session_id: input.sessionId,
    type: 'link',
    title: input.title,
    url_or_storage_path: input.url,
    visibility: input.visibility,
    stage_tags: [],
    audience_tags: input.tags ?? []
  })
  return { data: { id: row.id }, summary: `link ${row.id}` }
}
