### Task 8: Validação de URLs (SSRF)

**Files:**
- Create: `src/shared/url-guard.ts`
- Test: `tests/unit/url-guard.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `assertSafeUrl(rawUrl: string, options?: { allowPrivate?: boolean; lookup?: LookupFn }): Promise<URL>`; `isPrivateAddress(ip: string): boolean`; `type LookupFn = (hostname: string) => Promise<string[]>`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/unit/url-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertSafeUrl, isPrivateAddress } from '../../src/shared/url-guard';

describe('isPrivateAddress', () => {
  it('identifica faixas privadas e especiais', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.1.1', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe('assertSafeUrl', () => {
  it('aceita https público', async () => {
    const url = await assertSafeUrl('https://api.openai.com/v1', { lookup: async () => ['93.184.216.34'] });
    expect(url.hostname).toBe('api.openai.com');
  });

  it('rejeita esquema não http', async () => {
    await expect(assertSafeUrl('ftp://exemplo.com', { lookup: async () => ['93.184.216.34'] })).rejects.toThrow(/http/);
  });

  it('rejeita host privado literal', async () => {
    await expect(assertSafeUrl('http://127.0.0.1:8080', { lookup: async () => ['127.0.0.1'] })).rejects.toThrow(/privado/);
  });

  it('rejeita hostname que resolve para IP privado', async () => {
    await expect(assertSafeUrl('https://interno.exemplo.com', { lookup: async () => ['192.168.1.10'] })).rejects.toThrow(/privado/);
  });

  it('permite privados quando allowPrivate', async () => {
    const url = await assertSafeUrl('http://10.0.0.5:11434/v1', { allowPrivate: true, lookup: async () => ['10.0.0.5'] });
    expect(url.port).toBe('11434');
  });
});
```

- [ ] **Step 2: Rodar e verificar a falha**

Run: `yarn test tests/unit/url-guard.test.ts`
Expected: FAIL com módulo não encontrado.

- [ ] **Step 3: Implementar `src/shared/url-guard.ts`**

```ts
import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

export type LookupFn = (hostname: string) => Promise<string[]>;

function ipv4ToBytes(ip: string): number[] {
  return ip.split('.').map((part) => Number(part));
}

function inRange(bytes: number[], network: number[], bits: number): boolean {
  const value = (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!;
  const netValue = (network[0]! << 24) | (network[1]! << 16) | (network[2]! << 8) | network[3]!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (netValue & mask);
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const bytes = ipv4ToBytes(ip);
    return (
      inRange(bytes, [0, 0, 0, 0], 8) ||
      inRange(bytes, [10, 0, 0, 0], 8) ||
      inRange(bytes, [100, 64, 0, 0], 10) ||
      inRange(bytes, [127, 0, 0, 0], 8) ||
      inRange(bytes, [169, 254, 0, 0], 16) ||
      inRange(bytes, [172, 16, 0, 0], 12) ||
      inRange(bytes, [192, 0, 0, 0], 24) ||
      inRange(bytes, [192, 168, 0, 0], 16) ||
      inRange(bytes, [198, 18, 0, 0], 15) ||
      inRange(bytes, [224, 0, 0, 0], 4) ||
      inRange(bytes, [240, 0, 0, 0], 4)
    );
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') {
      return true;
    }
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) {
      return isPrivateAddress(mapped[1]);
    }
    return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb');
  }
  return true;
}

export async function assertSafeUrl(rawUrl: string, options: { allowPrivate?: boolean; lookup?: LookupFn } = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('URL inválida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Apenas URLs http/https são permitidas');
  }
  if (options.allowPrivate) {
    return url;
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [hostname] : await (options.lookup ?? defaultLookup)(hostname);
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`Endereço privado não permitido: ${address}`);
    }
  }
  return url;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}
```

- [ ] **Step 4: Rodar o teste**

Run: `yarn test tests/unit/url-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---
