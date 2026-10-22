import { expect, test } from 'vitest';
import type { PermissionItemData, Tab, TranscriptItem } from '../types';
import { askModeNote, pendingPermission, permissionVerb, ruleLabel } from './permissions';

function item(data: Partial<PermissionItemData>, id = 'i1'): TranscriptItem {
  return {
    id,
    ts: '2026-10-22T00:00:00Z',
    kind: 'permission',
    data: { id: `p-${id}`, toolName: 'Bash', input: { command: 'npm test' }, rule: 'Bash(npm test:*)', action: 'run a command', detail: 'npm test', status: 'pending', ...data },
  };
}

test('the pending request is the one still waiting, if any', () => {
  const tab = { transcript: [item({ status: 'allowed' }, 'a'), item({}, 'b')] } as Pick<Tab, 'transcript'>;
  expect(pendingPermission(tab)?.id).toBe('p-b');
  expect(pendingPermission({ transcript: [item({ status: 'denied' })] })).toBeNull();
});

test('a rule reads as what Allow for this tab covers', () => {
  expect(ruleLabel('Bash(npm test:*)')).toBe('npm test …');
  expect(ruleLabel('PowerShell(Get-ChildItem:*)')).toBe('Get-ChildItem …');
  expect(ruleLabel('Bash(cat a > b)')).toBe('this exact command');
  expect(ruleLabel('WebFetch')).toBe('WebFetch');
});

test('an answered request reads as a short past-tense line', () => {
  expect(permissionVerb('allowed')).toBe('Allowed once');
  expect(permissionVerb('allowed-tab')).toBe('Allowed for this tab');
  expect(permissionVerb('denied')).toBe('Denied');
  expect(permissionVerb('pending')).toBe('Waiting for you');
});

test('Ask me means something different per CLI, and the note says so', () => {
  expect(askModeNote('claude')).toMatch(/asks you/i);
  expect(askModeNote('codex')).toMatch(/workspace-write sandbox/i);
  expect(askModeNote('gemini')).toMatch(/edits/i);
});
