import { describe, expect, it } from 'vitest';
import { detectMusl } from '../src/libc.js';

describe('detectMusl', () => {
  it('returns false on darwin', () => {
    expect(detectMusl({ platform: 'darwin' })).toEqual({ isMusl: false });
  });

  it('returns false on win32', () => {
    expect(detectMusl({ platform: 'win32' })).toEqual({ isMusl: false });
  });

  it('returns false on linux when glibc runtime is reported', () => {
    const result = detectMusl({
      platform: 'linux',
      getReport: () => ({ header: { glibcVersionRuntime: '2.35' } }),
      readFile: () => undefined,
      exists: () => false,
    });
    expect(result.isMusl).toBe(false);
  });

  it('detects musl when process.report has no glibc runtime', () => {
    const result = detectMusl({
      platform: 'linux',
      getReport: () => ({ header: {} }),
      readFile: () => undefined,
      exists: () => false,
    });
    expect(result.isMusl).toBe(true);
    expect(result.reason).toMatch(/no glibc runtime/);
  });

  it('detects Alpine via /etc/os-release', () => {
    const result = detectMusl({
      platform: 'linux',
      getReport: () => undefined,
      readFile: (p) =>
        p === '/etc/os-release' ? 'NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.19' : undefined,
      exists: () => false,
    });
    expect(result.isMusl).toBe(true);
    expect(result.reason).toMatch(/Alpine/);
  });

  it('detects musl via dynamic loader on disk', () => {
    const result = detectMusl({
      platform: 'linux',
      getReport: () => undefined,
      readFile: () => undefined,
      exists: (p) => p === '/lib/ld-musl-x86_64.so.1',
    });
    expect(result.isMusl).toBe(true);
    expect(result.reason).toMatch(/musl/);
  });

  it('returns false on linux + glibc with no Alpine markers', () => {
    const result = detectMusl({
      platform: 'linux',
      getReport: () => ({ header: { glibcVersionRuntime: '2.39' } }),
      readFile: (p) =>
        p === '/etc/os-release' ? 'NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="24.04"' : undefined,
      exists: () => false,
    });
    expect(result.isMusl).toBe(false);
  });
});
