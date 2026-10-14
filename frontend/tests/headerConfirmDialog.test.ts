import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const header = await readFile(
  new URL('../src/components/layout/Header.tsx', import.meta.url),
  'utf8'
);

test('notification deletion uses the shared danger confirmation dialog', () => {
  assert.doesNotMatch(header, /window\.confirm|(?<![\w.])confirm\s*\(/);
  assert.match(header, /<ConfirmDialog[\s\S]*variant="danger"/);
  assert.match(header, /confirmLabel="Delete all"/);
  assert.match(header, /cancelLabel="Cancel"/);
  assert.match(header, /permanently deletes every notification/);
});

test('Cancel only closes the dialog and never invokes deletion', () => {
  assert.match(
    header,
    /onCancel=\{\(\) =>\s*setDeleteNotificationsOpen\(false\)\s*\}/
  );
  assert.match(header, /onConfirm=\{deleteAllNotifications\}/);
});

test('successful deletion preserves the endpoint and refreshes notification state once', () => {
  assert.match(header, /api\.delete<[\s\S]*?>\(\s*'\/api\/notifications'\s*\)/);
  assert.match(
    header,
    /setNotifications\(\[\]\);\s*setUnreadCount\(0\);\s*setDeleteNotificationsOpen\(false\);/
  );
  assert.match(header, /toast\(\s*'All notifications deleted\.'[\s\S]*?'success'/);
});

test('failure keeps the dialog available and uses existing error feedback', () => {
  const deleteFunction = header.slice(
    header.indexOf('async function deleteAllNotifications'),
    header.indexOf('PATCH HELPER')
  );
  const failureBlock = deleteFunction.match(
    /catch \(error\) \{([\s\S]*?)\r?\n\s{2}\} finally \{/
  )?.[1];

  assert.ok(failureBlock, 'delete failure handler must remain present');
  assert.match(failureBlock, /console\.error\(/);
  assert.match(failureBlock, /toast\(/);
  assert.match(failureBlock, /'Failed to delete notifications\.'/);
  assert.doesNotMatch(failureBlock, /setDeleteNotificationsOpen\(false\)/);
});

test('busy state and a synchronous guard prevent duplicate deletion requests', () => {
  assert.match(header, /deletingNotificationsRef\.current/);
  assert.match(
    header,
    /notifications\.length === 0 \|\|\s*deletingNotificationsRef\.current/
  );
  assert.match(header, /deletingNotificationsRef\.current = true/);
  assert.match(header, /busy=\{deletingNotifications\}/);
  assert.match(
    header,
    /finally \{\s*deletingNotificationsRef\.current = false;\s*setDeletingNotifications\(false\);/
  );
});
