import { expect, test } from 'vitest';
import { shouldAskAboutStall, stallMessage } from './stall';

test('a stalled running tab asks until the developer answers, then stays quiet until the next stall', () => {
  expect(shouldAskAboutStall({ status: 'running', stalled: false }, 0, null)).toBe(false);
  expect(shouldAskAboutStall({ status: 'idle', stalled: true }, 1, null)).toBe(false);
  expect(shouldAskAboutStall({ status: 'running', stalled: true }, 1, null)).toBe(true);
  expect(shouldAskAboutStall({ status: 'running', stalled: true }, 1, 1)).toBe(false);
  expect(shouldAskAboutStall({ status: 'running', stalled: true }, 2, 1)).toBe(true);
});

test('stallMessage says how long the worker has been silent', () => {
  expect(stallMessage(1)).toBe('No output for 1 minute');
  expect(stallMessage(10)).toBe('No output for 10 minutes');
});
