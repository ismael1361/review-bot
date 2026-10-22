import { eq, ne } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { Db } from '../db/client';
import { aiProfileSkills, aiProfiles, jobs, skills } from '../db/schema';
import { decryptSecret, encryptSecret } from '../auth/crypto';
import { AppError } from '../api/errors';
import { assertSafeUrl } from '../shared/url-guard';
import { getAdapter } from './adapters';
import type { ProviderKind } from './adapters/types';

const MAX_PROMPT_TOTAL = 131072;

export const ProfileInput = z.object({
  name: z.string().min(1).max(80),
  provider: z.enum(['openai_compatible', 'anthropic']),
  baseUrl: z.string().url().refine((value) => /^https?:\/\//i.test(value), 'Use uma URL http(s)'),
  model: z.string().min(1).max(200),
  apiKey: z.string().min(1).max(500).optional(),
  temperature: z.number().min(0).max(2).default(0.2),
  maxOutputTokens: z.number().int().min(1).max(32000).default(4096),
  maxTurns: z.number().int().min(1).max(50).default(20),
  maxTotalTokens: z.number().int().min(1000).max(1000000).default(200000),
  maxDurationSec: z.number().int().min(60).max(3600).default(600),
  maxFindings: z.number().int().min(1).max(50).default(25),
  maxGithubCalls: z.number().int().min(1).max(500).default(80),
  prePrompt: z.string().max(16384).default(''),
  skillIds: z.array(z.string().min(1)).max(20).default([]).refine((ids) => new Set(ids).size === ids.length, 'Skill duplicada'),
});

export type ProfileInputType = z.infer<typeof ProfileInput>;

type ProfileRow = typeof aiProfiles.$inferSelect;

export type PublicProfile = Omit<ProfileRow, 'apiKeyEncrypted'> & { hasApiKey: boolean; skillIds: string[] };

export function toPublicProfile(db: Db, row: ProfileRow): PublicProfile {
  const { apiKeyEncrypted: _ignored, ...rest } = row;
  const linked = db.select().from(aiProfileSkills).where(eq(aiProfileSkills.profileId, row.id)).all();
  return {
    ...rest,
    hasApiKey: row.apiKeyEncrypted.length > 0,
    skillIds: linked.sort((a, b) => a.position - b.position).map((item) => item.skillId),
  };
}

export function listProfiles(db: Db): PublicProfile[] {
  return db.select().from(aiProfiles).all().map((row) => toPublicProfile(db, row));
}

export function getProfileRow(db: Db, id: string): ProfileRow {
  const row = db.select().from(aiProfiles).where(eq(aiProfiles.id, id)).get();
  if (!row) {
    throw new AppError('Perfil não encontrado', 'profile_not_found', 404);
  }
  return row;
}

function validateSkillSelection(db: Db, input: ProfileInputType): void {
  let total = input.prePrompt.length;
  for (const skillId of input.skillIds) {
    const skill = db.select().from(skills).where(eq(skills.id, skillId)).get();
    if (!skill) {
      throw new AppError(`Skill não encontrada: ${skillId}`, 'skill_not_found', 400);
    }
    total += skill.contentMd.length;
  }
  if (total > MAX_PROMPT_TOTAL) {
    throw new AppError('Pré-prompt e skills excedem o limite total de 128 KB', 'prompt_too_large', 400);
  }
}

export function createProfile(db: Db, encryptionKey: Buffer, input: ProfileInputType): PublicProfile {
  validateSkillSelection(db, input);
  if (!input.apiKey) {
    throw new AppError('Chave de API é obrigatória', 'api_key_required', 400);
  }
  const existing = db.select().from(aiProfiles).where(eq(aiProfiles.name, input.name)).get();
  if (existing) {
    throw new AppError('Já existe um perfil com esse nome', 'profile_name_taken', 409);
  }
  const now = Date.now();
  const id = uuidv7();
  db.transaction((tx) => {
    tx.insert(aiProfiles)
      .values({
        id,
        name: input.name,
        provider: input.provider,
        baseUrl: input.baseUrl,
        model: input.model,
        apiKeyEncrypted: encryptSecret(encryptionKey, input.apiKey!),
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
        maxTurns: input.maxTurns,
        maxTotalTokens: input.maxTotalTokens,
        maxDurationSec: input.maxDurationSec,
        maxFindings: input.maxFindings,
        maxGithubCalls: input.maxGithubCalls,
        prePrompt: input.prePrompt,
        isActive: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    input.skillIds.forEach((skillId, index) => {
      tx.insert(aiProfileSkills).values({ profileId: id, skillId, position: index }).run();
    });
  });
  return toPublicProfile(db, getProfileRow(db, id));
}

export function updateProfile(db: Db, encryptionKey: Buffer, id: string, input: ProfileInputType): PublicProfile {
  const row = getProfileRow(db, id);
  validateSkillSelection(db, input);
  const duplicate = db.select().from(aiProfiles).where(eq(aiProfiles.name, input.name)).all().find((item) => item.id !== id);
  if (duplicate) {
    throw new AppError('Já existe um perfil com esse nome', 'profile_name_taken', 409);
  }
  const apiKeyEncrypted = input.apiKey ? encryptSecret(encryptionKey, input.apiKey) : row.apiKeyEncrypted;
  db.transaction((tx) => {
    tx.update(aiProfiles)
      .set({
        name: input.name,
        provider: input.provider,
        baseUrl: input.baseUrl,
        model: input.model,
        apiKeyEncrypted,
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
        maxTurns: input.maxTurns,
        maxTotalTokens: input.maxTotalTokens,
        maxDurationSec: input.maxDurationSec,
        maxFindings: input.maxFindings,
        maxGithubCalls: input.maxGithubCalls,
        prePrompt: input.prePrompt,
        updatedAt: Date.now(),
      })
      .where(eq(aiProfiles.id, id))
      .run();
    tx.delete(aiProfileSkills).where(eq(aiProfileSkills.profileId, id)).run();
    input.skillIds.forEach((skillId, index) => {
      tx.insert(aiProfileSkills).values({ profileId: id, skillId, position: index }).run();
    });
  });
  return toPublicProfile(db, getProfileRow(db, id));
}

export function deleteProfile(db: Db, id: string): void {
  const row = getProfileRow(db, id);
  if (row.isActive) {
    throw new AppError('Não é possível remover o perfil ativo', 'active_profile', 409);
  }
  db.transaction((tx) => {
    tx.update(jobs).set({ profileId: null }).where(eq(jobs.profileId, id)).run();
    tx.delete(aiProfiles).where(eq(aiProfiles.id, id)).run();
  });
}

export function activateProfile(db: Db, id: string): void {
  getProfileRow(db, id);
  db.transaction((tx) => {
    tx.update(aiProfiles).set({ isActive: false, updatedAt: Date.now() }).where(ne(aiProfiles.id, id)).run();
    tx.update(aiProfiles).set({ isActive: true, updatedAt: Date.now() }).where(eq(aiProfiles.id, id)).run();
  });
}

export async function testProfile(
  db: Db,
  encryptionKey: Buffer,
  id: string,
  options: { overrideApiKey?: string; allowPrivate: boolean } = { allowPrivate: false },
  fetchImpl?: typeof fetch,
): Promise<{ ok: true }> {
  const row = getProfileRow(db, id);
  const apiKey = options.overrideApiKey ?? decryptSecret(encryptionKey, row.apiKeyEncrypted);
  try {
    await assertSafeUrl(row.baseUrl, { allowPrivate: options.allowPrivate });
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : 'URL de base inválida', 'invalid_base_url', 400);
  }
  return getAdapter(row.provider as ProviderKind).testConnection({ baseUrl: row.baseUrl, apiKey, model: row.model }, fetchImpl);
}

export function getActiveProfile(db: Db, encryptionKey: Buffer): (ProfileRow & { apiKey: string }) | undefined {
  const row = db.select().from(aiProfiles).where(eq(aiProfiles.isActive, true)).get();
  if (!row) {
    return undefined;
  }
  return { ...row, apiKey: decryptSecret(encryptionKey, row.apiKeyEncrypted) };
}
