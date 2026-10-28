import { count } from "drizzle-orm";
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Db } from "../db/client";
import { aiProfiles, githubCredentials, webhooks } from "../db/schema";
import { loadEncryptionKey } from "../auth/crypto";

const KEY_FILE = ".encryption-key";

function hasEncryptedSecrets(db: Db): boolean {
  const credentials = db.select({ value: count() }).from(githubCredentials).get()?.value ?? 0;
  const profiles = db.select({ value: count() }).from(aiProfiles).get()?.value ?? 0;
  const webhookRows = db.select({ value: count() }).from(webhooks).get()?.value ?? 0;
  return credentials > 0 || profiles > 0 || webhookRows > 0;
}

export function resolveEncryptionKey(db: Db, dataDir: string, envKey?: string): Buffer {
  if (envKey?.trim()) {
    return loadEncryptionKey(envKey.trim());
  }
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, KEY_FILE);
  try {
    return loadEncryptionKey(readFileSync(path, "utf8").trim());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(
        `Falha ao carregar a chave de criptografia em ${path}; restaure .encryption-key ou defina APP_ENCRYPTION_KEY com a chave original`,
        { cause: error },
      );
    }
  }
  if (hasEncryptedSecrets(db)) {
    throw new Error(
      "Chave de criptografia ausente em DATA_DIR; restaure .encryption-key ou defina APP_ENCRYPTION_KEY antes de iniciar",
    );
  }
  const key = randomBytes(32);
  try {
    const fd = openSync(path, "wx", 0o600);
    try {
      writeSync(fd, key.toString("base64"));
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    return loadEncryptionKey(readFileSync(path, "utf8").trim());
  }
  return key;
}
