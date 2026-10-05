import { describe, it, expect } from 'vitest';
import { encodeResult, decodeResult, shareUrl, parseShareHash } from '../src/core/share.js';
import { precacheList } from '../config/vite-plugin-sw.js';

const result = {
  timestamp: 1_790_000_000_000,
  server: { name: 'Cloudflare' },
  download: { mbps: 353.456 },
  upload: { mbps: 237.04 },
  ping: { median: 25.83, jitter: 3.14, loss: 0 },
  stability: { score: 82.4, grade: 'B' },
};

describe('посилання на результат', () => {
  it('encode → decode зберігає дані (з округленням)', () => {
    expect(decodeResult(encodeResult(result))).toEqual({
      t: 1_790_000_000_000,
      d: 353.5,
      u: 237,
      p: 25.8,
      j: 3.1,
      l: 0,
      s: 82,
      g: 'B',
      n: 'Cloudflare',
    });
  });

  it('рядок безпечний для URL і короткий', () => {
    const s = encodeResult(result);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeLessThan(200);
  });

  it('кирилиця в назві сервера переживає кодування', () => {
    const r = { ...result, server: { name: 'Київ' } };
    expect(decodeResult(encodeResult(r)).n).toBe('Київ');
  });

  it('shareUrl зберігає шлях і замінює hash', () => {
    const url = shareUrl(result, 'https://vmmnick.github.io/speedtest/?x=1#old');
    expect(url).toMatch(/^https:\/\/vmmnick\.github\.io\/speedtest\/\?x=1#r=[A-Za-z0-9_-]+$/);
    expect(parseShareHash(new URL(url).hash).d).toBe(353.5);
  });

  it('parseShareHash: немає результату → undefined, зламаний → null', () => {
    expect(parseShareHash('')).toBeUndefined();
    expect(parseShareHash('#main')).toBeUndefined();
    expect(parseShareHash('#r=@@@')).toBeNull();
    expect(parseShareHash('#r=abc')).toBeNull();
  });

  it('відкидає підроблені/неправдоподібні дані', () => {
    const forge = (patch) =>
      btoa(JSON.stringify({ v: 1, t: 1_790_000_000_000, d: 1, u: 1, p: 1, j: 1, l: 0, s: 50, g: 'A', ...patch }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    expect(decodeResult(forge({}))).not.toBeNull();
    expect(decodeResult(forge({ g: '<script>' }))).toBeNull();
    expect(decodeResult(forge({ d: -5 }))).toBeNull();
    expect(decodeResult(forge({ d: 'fast' }))).toBeNull();
    expect(decodeResult(forge({ l: 150 }))).toBeNull();
    expect(decodeResult(forge({ v: 2 }))).toBeNull();
    expect(decodeResult(forge({ n: 'x'.repeat(100) })).n).toHaveLength(40);
    expect(decodeResult('x'.repeat(2000))).toBeNull();
  });
});

describe('service worker: список precache', () => {
  it('сторінка + статика, без шрифтів, карт, .md і самого sw.js', () => {
    const list = precacheList([
      'assets/index-abc.js',
      'assets/index-abc.css',
      'assets/inter-latin-wght-normal-x.woff2',
      'assets/index-abc.js.map',
      'assets/sounds/README.md',
      'sw.js',
      'manifest.webmanifest',
      'icons/icon-192.png',
    ]);
    expect(list).toEqual([
      './',
      'assets/index-abc.css',
      'assets/index-abc.js',
      'icons/icon-192.png',
      'manifest.webmanifest',
    ]);
  });
});
