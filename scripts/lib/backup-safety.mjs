import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function loadEnv(filePath) {
  const values = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
      }
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    values[key] = value;
  }
  return values;
}

export function resolveProductImagesDir(env, backendDir) {
  const configured = String(env.PRODUCT_IMAGES_DIR || '').trim();
  return configured
    ? path.resolve(backendDir, configured)
    : path.join(backendDir, 'storage', 'product-images');
}

export function assertSafeVerificationDatabase(name, productionName) {
  if (!/^capytech_verify_[a-z0-9_]+$/.test(name)) {
    throw new Error('Verification database name is not safety-scoped.');
  }
  if (name === productionName) {
    throw new Error('Verification database must not be the production database.');
  }
  return name;
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function relativeFiles(root, current = root) {
  const result = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Backup contains an unexpected symbolic link: ${fullPath}`);
    }
    if (entry.isDirectory()) {
      result.push(...relativeFiles(root, fullPath));
    } else if (entry.isFile()) {
      result.push(path.relative(root, fullPath).split(path.sep).join('/'));
    }
  }
  return result.sort();
}

export function writeChecksumManifest(backupRoot) {
  const checksumName = 'SHA256SUMS';
  const files = relativeFiles(backupRoot).filter(
    (name) => name !== checksumName
  );
  const lines = files.map((name) => {
    if (name.includes('\n') || name.includes('\r')) {
      throw new Error('Backup filenames may not contain line breaks.');
    }
    return `${sha256File(path.join(backupRoot, ...name.split('/')))}  ${name}`;
  });
  fs.writeFileSync(path.join(backupRoot, checksumName), `${lines.join('\n')}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return files.length;
}

export function verifyChecksumManifest(backupRoot) {
  const manifestPath = path.join(backupRoot, 'SHA256SUMS');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Backup checksum manifest is missing.');
  }

  const verified = [];
  for (const line of fs.readFileSync(manifestPath, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error('Backup checksum manifest is malformed.');
    const relative = match[2];
    const fullPath = path.resolve(backupRoot, ...relative.split('/'));
    const boundary = path.relative(path.resolve(backupRoot), fullPath);
    if (!boundary || boundary.startsWith('..') || path.isAbsolute(boundary)) {
      throw new Error(`Unsafe checksum path: ${relative}`);
    }
    if (!fs.existsSync(fullPath) || sha256File(fullPath) !== match[1]) {
      throw new Error(`Backup checksum failed: ${relative}`);
    }
    verified.push(relative);
  }

  if (verified.length === 0) {
    throw new Error('Backup checksum manifest is empty.');
  }

  const allowedReceipts = new Set(['RESTORE-VERIFIED.json', 'UPDATE-RESULT.json']);
  const actual = relativeFiles(backupRoot).filter(
    (name) => name !== 'SHA256SUMS' && !allowedReceipts.has(name)
  );
  if (JSON.stringify([...verified].sort()) !== JSON.stringify(actual)) {
    throw new Error('Backup file inventory does not match the checksum manifest.');
  }
  return verified;
}

export function copyDirectory(source, destination) {
  if (fs.existsSync(destination)) {
    throw new Error(`Refusing to overwrite backup path: ${destination}`);
  }
  if (!fs.existsSync(source)) {
    fs.mkdirSync(destination, { recursive: true });
    return;
  }
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });
}

export function assertDataManifestEqual(expected, actual) {
  const protectedExpected = {
    tables: expected.tables,
    sequences: expected.sequences,
    inventory: expected.inventory,
    invoices: expected.invoices,
    imageReferences: expected.imageReferences,
  };
  const protectedActual = {
    tables: actual.tables,
    sequences: actual.sequences,
    inventory: actual.inventory,
    invoices: actual.invoices,
    imageReferences: actual.imageReferences,
  };
  if (
    JSON.stringify(protectedExpected) !== JSON.stringify(protectedActual)
  ) {
    throw new Error('Restored database does not match the protected-data manifest.');
  }
}
