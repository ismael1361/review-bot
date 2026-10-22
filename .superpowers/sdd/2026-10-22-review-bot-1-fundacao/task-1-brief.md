### Task 1: Scaffold do projeto e /healthz

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`
- Create: `src/api/app.ts`, `src/api/routes/health.ts`
- Test: `tests/integration/health.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `buildApp(): FastifyInstance` em `src/api/app.ts`.

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "review-bot",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "dev:web": "vite",
    "build": "pnpm build:web && pnpm build:server",
    "build:web": "vite build",
    "build:server": "tsup src/server.ts --format esm --platform node --target node22 --out-dir dist/server --external better-sqlite3 --external @node-rs/argon2",
    "start": "node dist/server/server.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@fastify/cookie": "^11.0.0",
    "@fastify/helmet": "^13.0.0",
    "@fastify/rate-limit": "^10.0.0",
    "@fastify/static": "^8.0.0",
    "@node-rs/argon2": "^2.0.0",
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-tabs": "^1.1.0",
    "@tanstack/react-query": "^5.0.0",
    "better-sqlite3": "^11.0.0",
    "drizzle-orm": "^0.44.0",
    "fastify": "^5.0.0",
    "pino": "^9.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "uuid": "^11.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "drizzle-kit": "^0.31.0",
    "eslint": "^9.0.0",
    "jsdom": "^25.0.0",
    "pino-pretty": "^13.0.0",
    "tailwindcss": "^4.0.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.0.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "drizzle.config.ts", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Criar `vitest.config.ts`, `eslint.config.js` e `.gitignore`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
});
```

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'drizzle', 'node_modules'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
```

```
node_modules/
dist/
data/
.env
coverage/
```

- [ ] **Step 4: Criar `tests/setup.ts`**

```ts
process.env.APP_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.NODE_ENV = 'test';
```

- [ ] **Step 5: Escrever o teste que falha**

`tests/integration/health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app';

describe('GET /healthz', () => {
  it('responde ok', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
```

- [ ] **Step 6: Rodar e verificar a falha**

Run: `pnpm install; pnpm test tests/integration/health.test.ts`
Expected: FAIL com "Cannot find module '../../src/api/app'".

- [ ] **Step 7: Implementar `src/api/app.ts` e `src/api/routes/health.ts`**

`src/api/routes/health.ts`:

```ts
import type { FastifyInstance } from 'fastify';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => ({ status: 'ok' }));
}
```

`src/api/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { registerHealthRoutes } from './routes/health';

export function buildApp(): FastifyInstance {
  const app = Fastify();
  registerHealthRoutes(app);
  return app;
}
```

- [ ] **Step 8: Rodar o teste**

Run: `pnpm test tests/integration/health.test.ts`
Expected: PASS.

- [ ] **Step 9: Checkpoint**

Run: `pnpm typecheck; pnpm lint; pnpm test`
Expected: todos verdes.

---
