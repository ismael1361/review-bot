import { z } from 'zod';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { getSetting, setSetting } from '../db/settings';

const INSTANCE_KEY = 'instance';

export const InstanceSettings = z.object({
  publicUrl: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), 'Use http(s)')
    .optional(),
  trustProxy: z.boolean().default(false),
  allowPrivateUrls: z.boolean().default(false),
});

export type InstanceSettingsType = z.infer<typeof InstanceSettings>;

export function getInstanceSettings(db: Db): InstanceSettingsType {
  return InstanceSettings.parse(getSetting<Partial<InstanceSettingsType>>(db, INSTANCE_KEY) ?? {});
}

export function saveInstanceSettings(db: Db, input: InstanceSettingsType): InstanceSettingsType {
  const parsed = InstanceSettings.parse(input);
  setSetting(db, INSTANCE_KEY, parsed);
  return parsed;
}

export function effectiveTrustProxy(stored: InstanceSettingsType, env: NodeJS.ProcessEnv): boolean {
  const envTrust = env.TRUST_PROXY?.trim();
  return envTrust ? envTrust === 'true' : stored.trustProxy;
}

export function applyInstanceSettings(
  config: Config,
  stored: InstanceSettingsType,
  env: NodeJS.ProcessEnv,
): { trustProxyChanged: boolean } {
  const envPublicUrl = env.PUBLIC_URL?.trim() || undefined;
  const envAllowPrivate = env.ALLOW_PRIVATE_URLS?.trim();
  config.PUBLIC_URL = envPublicUrl ?? stored.publicUrl;
  config.ALLOW_PRIVATE_URLS = envAllowPrivate ? envAllowPrivate === 'true' : stored.allowPrivateUrls;
  return { trustProxyChanged: config.TRUST_PROXY !== effectiveTrustProxy(stored, env) };
}
