import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../../src/shared/redact';

const redacted = '[REDACTED]';

describe('redactSecrets', () => {
  it('redige tokens clássicos do GitHub', () => {
    for (const prefix of ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_']) {
      const token = `${prefix}${'a'.repeat(36)}`;
      const result = redactSecrets(`token ${token} fim`);
      expect(result.redacted, token).toBe(true);
      expect(result.text, token).toBe(`token ${redacted} fim`);
      expect(result.text, token).not.toContain(token);
    }
  });

  it('redige token fine-grained do GitHub', () => {
    const token = `github_pat_${'A1b2_'.repeat(6)}`;
    const result = redactSecrets(`token ${token} fim`);
    expect(result.redacted).toBe(true);
    expect(result.text).toBe(`token ${redacted} fim`);
    expect(result.text).not.toContain(token);
  });

  it('redige chaves AWS', () => {
    for (const token of ['AKIAIOSFODNN7EXAMPLE', 'ASIAIOSFODNN7EXAMPLE']) {
      const result = redactSecrets(`chave ${token} fim`);
      expect(result.redacted, token).toBe(true);
      expect(result.text, token).toBe(`chave ${redacted} fim`);
    }
  });

  it('redige tokens do Slack', () => {
    for (const prefix of ['xoxb-', 'xoxa-', 'xoxp-', 'xoxr-', 'xoxs-']) {
      const token = `${prefix}1234567890-abcdefghijkl`;
      const result = redactSecrets(token);
      expect(result.redacted, token).toBe(true);
      expect(result.text, token).toBe(redacted);
    }
  });

  it('redige chaves do Google', () => {
    const token = `AIza${'a'.repeat(35)}`;
    const result = redactSecrets(`chave ${token} fim`);
    expect(result.redacted).toBe(true);
    expect(result.text).toBe(`chave ${redacted} fim`);
  });

  it('redige chaves sk- clássicas e com hífen', () => {
    for (const token of [`sk-${'a'.repeat(26)}`, `sk-proj-${'a'.repeat(40)}`, `sk-ant-api03-${'b'.repeat(40)}`]) {
      const result = redactSecrets(token);
      expect(result.redacted, token).toBe(true);
      expect(result.text, token).toBe(redacted);
    }
  });

  it('não redige texto comum que contém sk-', () => {
    const text = 'sk-learn-machine-learning-pipeline';
    const result = redactSecrets(text);
    expect(result.redacted).toBe(false);
    expect(result.text).toBe(text);
  });

  it('redige tokens precedidos por sublinhado', () => {
    const github = `ghp_${'a'.repeat(36)}`;
    const aws = 'AKIAIOSFODNN7EXAMPLE';
    const openai = `sk-${'b'.repeat(20)}`;
    const result = redactSecrets(`token_${github} key_${aws} secret_${openai}`);
    expect(result.redacted).toBe(true);
    expect(result.text).toBe(`token_${redacted} key_${redacted} secret_${redacted}`);
  });

  it('redige blocos PEM de várias linhas', () => {
    const body = 'MIIEowIBAAKCAQEA1234567890abcdef\nabcdefghijklmnopqrstuvwxyz';
    for (const label of ['RSA', 'OPENSSH', 'EC', 'ENCRYPTED']) {
      const pem = `-----BEGIN ${label} PRIVATE KEY-----\n${body}\n-----END ${label} PRIVATE KEY-----`;
      const result = redactSecrets(`antes\n${pem}\ndepois`);
      expect(result.redacted, label).toBe(true);
      expect(result.text, label).toBe(`antes\n${redacted}\ndepois`);
      expect(result.text, label).not.toContain('MIIEow');
      expect(result.text, label).not.toContain('PRIVATE KEY');
    }
  });

  it('redige bloco PEM truncado até o fim do texto', () => {
    const result = redactSecrets(`antes\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234567890abcdef`);
    expect(result.redacted).toBe(true);
    expect(result.text).toBe(`antes\n${redacted}`);
    expect(result.text).not.toContain('MIIEow');
    expect(result.text).not.toContain('PRIVATE KEY');
  });

  it('redige múltiplos blocos PEM', () => {
    const first = `-----BEGIN RSA PRIVATE KEY-----\nAAA\n-----END RSA PRIVATE KEY-----`;
    const second = `-----BEGIN EC PRIVATE KEY-----\nBBB\n-----END EC PRIVATE KEY-----`;
    const result = redactSecrets(`inicio ${first} meio ${second} fim`);
    expect(result.redacted).toBe(true);
    expect(result.text).toBe(`inicio ${redacted} meio ${redacted} fim`);
  });

  it('redige múltiplas ocorrências preservando o restante', () => {
    const github = `ghp_${'a'.repeat(36)}`;
    const aws = 'AKIAIOSFODNN7EXAMPLE';
    const result = redactSecrets(`primeiro ${github}, segundo ${aws} e fim`);
    expect(result.redacted).toBe(true);
    expect(result.text).toBe(`primeiro ${redacted}, segundo ${redacted} e fim`);
    expect(result.text.match(/\[REDACTED\]/g)).toHaveLength(2);
    expect(result.text).not.toContain(github);
    expect(result.text).not.toContain(aws);
  });

  it('redige famílias diferentes no mesmo texto', () => {
    const input = [
      `ghp_${'a'.repeat(36)}`,
      `github_pat_${'B'.repeat(30)}`,
      'AKIAIOSFODNN7EXAMPLE',
      'xoxb-1234567890-abcdefghijkl',
      `AIza${'c'.repeat(35)}`,
      `sk-proj-${'d'.repeat(30)}`,
    ].join(' ');
    const result = redactSecrets(input);
    expect(result.redacted).toBe(true);
    expect(result.text).toBe(new Array<string>(6).fill(redacted).join(' '));
  });

  it('não altera texto comum', () => {
    for (const text of ['a sessão expira em 12 h', 'task-runner', 'sk-abc', 'AKIA123', 'ghp_curto', 'risk-management-plano']) {
      const result = redactSecrets(text);
      expect(result.redacted, text).toBe(false);
      expect(result.text, text).toBe(text);
    }
  });

  it('substitui exatamente por [REDACTED]', () => {
    const token = `ghp_${'z'.repeat(36)}`;
    const result = redactSecrets(token);
    expect(result.text).toBe('[REDACTED]');
    expect(result.text).toHaveLength(10);
    expect(result.text).not.toContain(token);
  });
});
