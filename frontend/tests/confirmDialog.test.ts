import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dialog = await readFile(new URL('../src/components/ui/ConfirmDialog.tsx', import.meta.url), 'utf8');
const modal = await readFile(new URL('../src/components/ui/Modal.tsx', import.meta.url), 'utf8');

test('Cancel and Confirm are controlled and disabled while work is active', () => {
  assert.match(dialog, /onConfirm: \(\) => void \| Promise<void>/);
  assert.match(dialog, /onCancel: \(\) => void/);
  assert.match(dialog, /disabled=\{locked\}[\s\S]*onClick=\{cancel\}/);
  assert.match(dialog, /disabled=\{locked\}[\s\S]*onClick=\{confirm\}/);
  assert.match(dialog, /if \(!locked\) onCancel\(\)/);
});

test('the confirmation guard blocks rapid repeated actions and permits a later retry', () => {
  assert.match(dialog, /if \(locked \|\| confirmLockedRef\.current\) return/);
  assert.match(dialog, /confirmLockedRef\.current = true/);
  assert.match(dialog, /await onConfirm\(\)/);
  assert.match(dialog, /window\.setTimeout/);
  assert.match(dialog, /confirmLockedRef\.current = false/);
});

test('busy state blocks Escape, backdrop, close button, and direct cancellation', () => {
  assert.match(dialog, /dismissible=\{!locked\}/);
  assert.match(modal, /if \(dismissible\) onClose\(\)/);
  assert.match(modal, /onClick=\{dismissible \? onClose : undefined\}/);
  assert.match(modal, /disabled=\{!dismissible\}/);
});

test('destructive dialogs initially focus Cancel and Modal restores prior focus', () => {
  assert.match(dialog, /initialFocusRef=\{destructive \? cancelRef : undefined\}/);
  assert.match(modal, /initialFocusRef\?\.current \|\| dialogRef\.current/);
  assert.match(modal, /previouslyFocused\?\.isConnected/);
  assert.match(modal, /previouslyFocused\.focus\(\)/);
});

test('keyboard accessibility and nested-modal handling remain in the shared Modal', () => {
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /event\.key !== 'Tab'/);
  assert.match(modal, /isTopModal\(portalHost\)/);
  assert.match(modal, /createPortal/);
});
