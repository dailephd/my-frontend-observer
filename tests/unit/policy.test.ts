import { describe, expect, it } from 'vitest';
import { classifyDownload, classifyPopup, classifyRedirect, classifySubresource, classifyUrl } from '../../src/safety/policy.js';

describe('classifyUrl', () => {
  it('TST-035: accepts the loopback allowlist forms', () => {
    expect(classifyUrl('http://localhost:3000/').allowed).toBe(true);
    expect(classifyUrl('https://127.0.0.1/').allowed).toBe(true);
    expect(classifyUrl('http://[::1]:8080/').allowed).toBe(true);
    expect(classifyUrl('http://127.5.5.5/').allowed).toBe(true);
  });

  it('TST-036: rejects remote hosts, disallowed schemes, and credential-bearing URLs', () => {
    for (const url of ['https://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@localhost/']) {
      const decision = classifyUrl(url);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.diagnostic.code).toBe('unsafe-url');
    }
  });
});

describe('classifyRedirect', () => {
  it('TST-037: reuses classifyUrl policy for the redirect target', () => {
    const remote = classifyRedirect('http://localhost/', 'https://example.com/');
    const local = classifyRedirect('http://localhost/a', 'http://localhost/b');
    expect(remote.allowed).toBe(false);
    if (!remote.allowed) expect(remote.diagnostic.code).toBe('prohibited-redirect');
    expect(local.allowed).toBe(true);
  });
});

describe('classifySubresource', () => {
  it('TST-038: reuses classifyUrl policy for the subresource target', () => {
    const remote = classifySubresource('https://cdn.example.com/app.js');
    const local = classifySubresource('http://127.0.0.1/app.js');
    expect(remote.allowed).toBe(false);
    if (!remote.allowed) expect(remote.diagnostic.code).toBe('prohibited-subresource-request');
    expect(local.allowed).toBe(true);
  });
});

describe('classifyPopup / classifyDownload', () => {
  it('TST-039: both are non-fatal warnings, never errors', () => {
    expect(classifyPopup()).toMatchObject({ code: 'unsupported-configuration', severity: 'warning' });
    expect(classifyDownload()).toMatchObject({ code: 'unsupported-configuration', severity: 'warning' });
  });
});
