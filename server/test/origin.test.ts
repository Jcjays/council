import { expect, test } from 'vitest';
import { isAllowedHost, isAllowedOrigin } from '../src/origin.js';

test('absent Origin (non-browser clients) is allowed', () => {
  expect(isAllowedOrigin(undefined)).toBe(true);
});

test('loopback origins on any port are allowed', () => {
  expect(isAllowedOrigin('http://localhost:4317')).toBe(true);
  expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
  expect(isAllowedOrigin('http://127.0.0.1:4317')).toBe(true);
  expect(isAllowedOrigin('http://[::1]:4317')).toBe(true);
});

test('any other origin is rejected, including look-alikes and garbage', () => {
  expect(isAllowedOrigin('http://evil.example')).toBe(false);
  expect(isAllowedOrigin('http://localhost.evil.example')).toBe(false);
  expect(isAllowedOrigin('http://evil.example/localhost')).toBe(false);
  expect(isAllowedOrigin('null')).toBe(false);
  expect(isAllowedOrigin('not a url')).toBe(false);
});

test('only a Host header naming loopback is answered', () => {
  expect(isAllowedHost('localhost:4317')).toBe(true);
  expect(isAllowedHost('127.0.0.1:4317')).toBe(true);
  expect(isAllowedHost('127.0.0.1')).toBe(true);
  expect(isAllowedHost('[::1]:4317')).toBe(true);
  // A domain that resolves to 127.0.0.1 is same-origin to the browser, so the
  // Origin check alone would let it read every GET.
  expect(isAllowedHost('rebind.example:4317')).toBe(false);
  expect(isAllowedHost('localhost.evil.example')).toBe(false);
  expect(isAllowedHost(undefined)).toBe(false);
});
