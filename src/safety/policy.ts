import type { Diagnostic } from '../domain/diagnostics.js';

export type SafetyDecision = { allowed: true } | { allowed: false; diagnostic: Diagnostic };

const ALLOWED_SCHEMES = ['http', 'https'] as const;

/**
 * v0.1 loopback allowlist: literal localhost/127.0.0.1/::1 and any 127.x.x.x
 * form only. No DNS resolution, no arbitrary named "local dev host" support -
 * an explicit conservative reading recorded in behavior-model.txt.
 */
function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}

/** Pure classification: scheme + loopback rules only. Never performs DNS resolution or network I/O. */
export function classifyUrl(url: string): SafetyDecision {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      allowed: false,
      diagnostic: { code: 'invalid-request', severity: 'error', message: `malformed URL: ${url}` },
    };
  }

  const scheme = parsed.protocol.replace(/:$/, '');
  if (!(ALLOWED_SCHEMES as readonly string[]).includes(scheme)) {
    return {
      allowed: false,
      diagnostic: { code: 'unsafe-url', severity: 'error', message: `scheme "${scheme}" is not allowed`, details: { url } },
    };
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return {
      allowed: false,
      diagnostic: { code: 'unsafe-url', severity: 'error', message: 'credential-bearing URLs are rejected', details: { url } },
    };
  }

  if (!isLoopbackHost(parsed.hostname)) {
    return {
      allowed: false,
      diagnostic: { code: 'unsafe-url', severity: 'error', message: `host "${parsed.hostname}" is not a loopback host`, details: { url } },
    };
  }

  return { allowed: true };
}

export function classifyRedirect(fromUrl: string, toUrl: string): SafetyDecision {
  const decision = classifyUrl(toUrl);
  if (decision.allowed) return decision;
  return {
    allowed: false,
    diagnostic: {
      code: 'prohibited-redirect',
      severity: 'error',
      message: 'redirect target failed safety policy',
      details: { from: fromUrl, to: toUrl },
    },
  };
}

export function classifySubresource(url: string): SafetyDecision {
  const decision = classifyUrl(url);
  if (decision.allowed) return decision;
  return {
    allowed: false,
    diagnostic: {
      code: 'prohibited-subresource-request',
      severity: 'error',
      message: 'subresource target failed safety policy',
      details: { url },
    },
  };
}

/** Popups and downloads are never followed/saved in v0.1; both are non-fatal (warning) notices, not errors. */
export function classifyPopup(): Diagnostic {
  return { code: 'unsupported-configuration', severity: 'warning', message: 'popups are not followed in v0.1' };
}

export function classifyDownload(): Diagnostic {
  return { code: 'unsupported-configuration', severity: 'warning', message: 'downloads are not followed in v0.1' };
}
