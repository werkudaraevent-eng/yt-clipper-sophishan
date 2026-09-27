/** Mirrors the Postgres enums in supabase/migrations/0001_init.sql. */
export const PROJECT_STATUSES = ["queued", "processing", "ready", "failed", "expired"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Pipeline stages shown as progress on the project page, in order. */
export const PIPELINE_STAGES = ["download", "transcribe", "analyze", "render"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
