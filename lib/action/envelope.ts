import { z } from 'zod'
import { ActorTypeEnum, RoleEnum, ToolEnum } from '../db/schema'

export const RedactionPolicyEnum = z.enum(['none', 'summary', 'mask-private', 'metadata-only'])

export const AxActorSchema = z.object({
  type: ActorTypeEnum,
  userId: z.string().optional(),
  tool: ToolEnum.default('web-ui'),
  role: RoleEnum
})

export const AxScopeSchema = z.object({
  companyId: z.string().optional(),
  courseId: z.string().optional(),
  sessionId: z.string().optional()
})

export const AxActionEnvelopeSchema = z.object({
  action: z.string().min(1),
  actor: AxActorSchema,
  scope: AxScopeSchema.default({}),
  idempotencyKey: z.string().min(1),
  redactionPolicy: RedactionPolicyEnum.default('summary'),
  dryRun: z.boolean().default(false),
  input: z.unknown().default({})
})

export type AxActionEnvelope = z.infer<typeof AxActionEnvelopeSchema>
export type AxRedactionPolicy = z.infer<typeof RedactionPolicyEnum>

export type AxActionResult = {
  ok: boolean
  status: 'ok' | 'denied' | 'invalid' | 'blocked' | 'error' | 'dry_run' | 'cached'
  data?: unknown
  error?: string
  ledger_id?: string
  cached?: boolean
}
