import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`)
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true })

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey(),
  displayName: text('display_name'),
  locale: text('locale').notNull().default('id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.userId, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    label: text('label').notNull(),
    baseUrl: text('base_url'),
    model: text('model').notNull(),
    encryptedKey: text('encrypted_key').notNull(),
    keyIv: text('key_iv').notNull(),
    keyTag: text('key_tag').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'api_keys_provider_chk',
      sql`${t.provider} in ('gemini','openai_compat','anthropic_compat')`,
    ),
    index('api_keys_user_idx').on(t.userId),
  ],
)

export const sources = pgTable(
  'sources',
  {
    id: id(),
    kind: text('kind').notNull(),
    externalId: text('external_id').notNull(),
    isPublic: boolean('is_public').notNull(),
    ownerUserId: uuid('owner_user_id').references(() => profiles.userId, { onDelete: 'cascade' }),
    urlOriginal: text('url_original').notNull(),
    title: text('title'),
    channel: text('channel'),
    durationSec: integer('duration_sec'),
    thumbnailUrl: text('thumbnail_url'),
    audioR2Key: text('audio_r2_key'),
    audioSha256: text('audio_sha256'),
    status: text('status').notNull().default('pending'),
    errorCode: text('error_code'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('sources_kind_chk', sql`${t.kind} in ('youtube','tiktok','gdrive','other')`),
    check('sources_status_chk', sql`${t.status} in ('pending','ready','failed')`),
    check(
      'sources_owner_chk',
      sql`(${t.isPublic} = true and ${t.ownerUserId} is null)
          or (${t.isPublic} = false and ${t.ownerUserId} is not null)`,
    ),
    uniqueIndex('sources_public_uniq').on(t.kind, t.externalId).where(sql`is_public`),
    uniqueIndex('sources_private_uniq')
      .on(t.kind, t.externalId, t.ownerUserId)
      .where(sql`not is_public`),
    index('sources_sha_idx').on(t.audioSha256),
  ],
)

export const transcripts = pgTable(
  'transcripts',
  {
    id: id(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    language: text('language'),
    r2Key: text('r2_key').notNull(),
    wordCount: integer('word_count'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('transcripts_source_model_uniq').on(t.sourceId, t.model)],
)

export const llmRuns = pgTable(
  'llm_runs',
  {
    id: id(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    inputHash: text('input_hash').notNull(),
    output: jsonb('output').notNull(),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('llm_runs_input_hash_uniq').on(t.inputHash)],
)

export const projects = pgTable(
  'projects',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.userId, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    title: text('title').notNull(),
    settings: jsonb('settings').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('projects_user_idx').on(t.userId)],
)

export const clipCandidates = pgTable(
  'clip_candidates',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    llmRunId: uuid('llm_run_id').references(() => llmRuns.id),
    startSec: numeric('start_sec', { precision: 10, scale: 3 }).notNull(),
    endSec: numeric('end_sec', { precision: 10, scale: 3 }).notNull(),
    score: numeric('score', { precision: 4, scale: 3 }).notNull(),
    title: text('title').notNull(),
    hookText: text('hook_text').notNull(),
    reason: text('reason'),
    transcriptSlice: text('transcript_slice').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('clip_candidates_range_chk', sql`${t.endSec} > ${t.startSec}`),
    index('clip_candidates_project_idx').on(t.projectId),
  ],
)

export const mediaSegments = pgTable(
  'media_segments',
  {
    id: id(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    startSec: numeric('start_sec', { precision: 10, scale: 3 }).notNull(),
    endSec: numeric('end_sec', { precision: 10, scale: 3 }).notNull(),
    r2Key: text('r2_key').notNull(),
    bytes: bigint('bytes', { mode: 'number' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('media_segments_uniq').on(t.sourceId, t.startSec, t.endSec)],
)

export const clips = pgTable(
  'clips',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id').references(() => clipCandidates.id),
    editSpec: jsonb('edit_spec').notNull().default({}),
    renderStatus: text('render_status').notNull().default('draft'),
    outputR2Key: text('output_r2_key'),
    durationSec: numeric('duration_sec', { precision: 10, scale: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'clips_render_status_chk',
      sql`${t.renderStatus} in ('draft','rendering','done','failed')`,
    ),
  ],
)

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('queued'),
    priority: integer('priority').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    progress: integer('progress').notNull().default(0),
    errorCode: text('error_code'),
    errorMsg: text('error_msg'),
    userId: uuid('user_id').references(() => profiles.userId, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('jobs_type_chk', sql`${t.type} in ('ingest','transcribe','analyze','fetch_segments')`),
    check('jobs_status_chk', sql`${t.status} in ('queued','running','done','failed','dead')`),
    index('jobs_pick_idx').on(t.status, t.runAfter, t.priority),
  ],
)
