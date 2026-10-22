### Task 2: Configuração e logger

**Files:**
- Create: `src/config.ts`, `src/logger.ts`
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config`; `createLogger(config: Config): Logger`. `Config` tem os campos do env mais `isProduction` e `isTest`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/unit/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';

const base = {
  APP_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  NODE_ENV: 'test',
} as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('aplica padrões', () => {
    const config = loadConfig(base);
    expect(config.PORT).toBe(3000);
    expect(config.DATA_DIR).toBe('./data');
    expect(config.TRUST_PROXY).toBe(false);
    expect(config.isTest).toBe(true);
  });

  it('converte booleanos textuais corretamente', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
  });

  it('exige chave de criptografia', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it('exige PUBLIC_URL em produção', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/PUBLIC_URL/);
  });
});
```

- [ ] **Step 2: Rodar e verificar a falha**

Run: `pnpm test tests/unit/config.test.ts`
Expected: FAIL com "Cannot find module '../../src/config'".

- [ ] **Step 3: Implementar `src/config.ts`**

```ts
import { z } from 'zod';

const BooleanFromEnv = z.enum(['true', 'false']).transform((value) => value === 'true');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().min(1).default('./data'),
  PUBLIC_URL: z.string().url().optional(),
  APP_ENCRYPTION_KEY: z.string().min(1),
  SETUP_TOKEN: z.string().min(16).optional(),
  TRUST_PROXY: BooleanFromEnv.default('false'),
  ALLOW_PRIVATE_URLS: BooleanFromEnv.default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TZ: z.string().default('UTC'),
});

export type Config = z.infer<typeof EnvSchema> & { isProduction: boolean; isTest: boolean };

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Configuração inválida: ${details}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.PUBLIC_URL) {
    throw new Error('PUBLIC_URL é obrigatória em produção');
  }
  return {
    ...parsed.data,
    isProduction: parsed.data.NODE_ENV === 'production',
    isTest: parsed.data.NODE_ENV === 'test',
  };
}
```

- [ ] **Step 4: Implementar `src/logger.ts`**

```ts
import { pino, type Logger } from 'pino';
import type { Config } from './config';

export function createLogger(config: Config): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      '*.apiKey',
      '*.token',
      '*.password',
    ],
  });
}
```

- [ ] **Step 5: Rodar o teste**

Run: `pnpm test tests/unit/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: todos verdes.

---
