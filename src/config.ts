import { z } from "zod";

const BooleanFromEnv = z.enum(["true", "false"]).transform((value) => value === "true");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().min(1).default("./data"),
  PUBLIC_URL: z.string().url().optional(),
  APP_ENCRYPTION_KEY: z.string().min(1),
  SETUP_TOKEN: z.string().min(16).optional(),
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
  if (parsed.data.NODE_ENV === "production" && !parsed.data.PUBLIC_URL) {
    throw new Error("PUBLIC_URL é obrigatória em produção");
  }
  return {
    ...parsed.data,
    isProduction: parsed.data.NODE_ENV === "production",
    isTest: parsed.data.NODE_ENV === "test",
  };
}
