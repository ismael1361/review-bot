import { z } from "zod";

const BooleanFromEnv = z.enum(["true", "false"]).transform((value) => value === "true");

function emptyToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(7080),
  DATA_DIR: z.string().min(1).default("./data"),
  PUBLIC_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .url()
      .refine((value) => {
        try {
          const protocol = new URL(value).protocol;
          return protocol === "http:" || protocol === "https:";
        } catch {
          return false;
        }
      }, "PUBLIC_URL deve usar http ou https")
      .optional(),
  ),
  APP_ENCRYPTION_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SETUP_TOKEN: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  TRUST_PROXY: BooleanFromEnv.default("false"),
  ALLOW_PRIVATE_URLS: BooleanFromEnv.default("false"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  TZ: z.string().default("UTC"),
});

export type Config = z.infer<typeof EnvSchema> & { isProduction: boolean; isTest: boolean };

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Configuração inválida: ${details}`);
  }
  return {
    ...parsed.data,
    isProduction: parsed.data.NODE_ENV === "production",
    isTest: parsed.data.NODE_ENV === "test",
  };
}
