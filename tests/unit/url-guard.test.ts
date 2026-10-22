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

  it('identifica IPv6 mapeado e faixas especiais', () => {
    for (const ip of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:0:0', '0:0:0:0:0:0:0:1', '64:ff9b::7f00:1', 'fec0::1', 'ff02::1', '2002:7f00:1::']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['::ffff:8.8.8.8', '2606:4700:4700::1111']) {
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

  it('rejeita IPv4 mapeado em IPv6', async () => {
    await expect(assertSafeUrl('http://[::ffff:127.0.0.1]/', { lookup: async () => ['8.8.8.8'] })).rejects.toThrow(/privado/);
    await expect(assertSafeUrl('http://[::ffff:169.254.169.254]/', { lookup: async () => ['8.8.8.8'] })).rejects.toThrow(/privado/);
  });

  it('rejeita lookup vazio', async () => {
    await expect(assertSafeUrl('https://exemplo.com', { lookup: async () => [] })).rejects.toThrow(/não resolvido/);
  });

  it('rejeita resolução com mistura de público e privado', async () => {
    await expect(assertSafeUrl('https://exemplo.com', { lookup: async () => ['8.8.8.8', '10.0.0.5'] })).rejects.toThrow(/privado/);
  });

  it('aceita IPv6 público literal sem consultar lookup', async () => {
    const url = await assertSafeUrl('https://[2606:4700:4700::1111]/', {
      lookup: async () => {
        throw new Error('lookup não deveria ser chamado');
      },
    });
    expect(url.hostname).toBe('[2606:4700:4700::1111]');
  });
});
