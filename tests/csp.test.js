import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildPolicy } from '../config/vite-plugin-csp.js';

const directive = (policy, name) =>
  policy
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(name + ' '));

describe('CSP plugin', () => {
  it('хешує inline-скрипти і не дозволяє unsafe-inline/eval', () => {
    const code = "document.documentElement.dataset.theme = 'dark';";
    const html = `<head><script>${code}</script><script type="module" src="/app.js"></script></head>`;
    const policy = buildPolicy(html);
    const hash = createHash('sha256').update(code).digest('base64');
    expect(directive(policy, 'script-src')).toBe(`script-src 'self' 'sha256-${hash}'`);
    expect(policy).not.toMatch(/unsafe-(inline|eval)/);
  });

  it('за замовчуванням усе заборонено, мережа — лише self + Cloudflare', () => {
    const policy = buildPolicy('<html></html>');
    expect(directive(policy, 'default-src')).toBe("default-src 'none'");
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self' https://speed.cloudflare.com");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'none'");
  });
});
