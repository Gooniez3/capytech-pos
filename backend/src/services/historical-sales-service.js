const crypto = require('crypto');
const { TextDecoder } = require('util');

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TRANSACTION_ROWS = 10000;
const MAX_MONTH_ROWS = 1200;
const PREVIEW_TTL_MS = 15 * 60 * 1000;

const FILES = Object.freeze({
  historicalSales: Object.freeze({
    name: 'historical-sales.csv',
    headers: Object.freeze([
      'id', 'invoice_number', 'created_at', 'status', 'subtotal', 'tax', 'discount',
      'total', 'payment_method', 'refunded_at', 'voided_at',
    ]),
    maxRows: MAX_TRANSACTION_ROWS,
  }),
  monthlySummary: Object.freeze({
    name: 'monthly-sales-summary.csv',
    headers: Object.freeze([
      'sale_month', 'completed_transactions', 'completed_amount',
      'refunded_transactions', 'refunded_amount',
    ]),
    maxRows: MAX_MONTH_ROWS,
  }),
  allTimeSummary: Object.freeze({
    name: 'all-time-sales-summary.csv',
    headers: Object.freeze([
      'total_transactions', 'completed_transactions', 'completed_amount',
      'refunded_transactions', 'refunded_amount',
    ]),
    maxRows: 1,
  }),
});

class HistoricalArchiveError extends Error {
  constructor(message, status = 400, code = 'HISTORICAL_ARCHIVE_INVALID') {
    super(message);
    this.name = 'HistoricalArchiveError';
    this.status = status;
    this.code = code;
  }
}

function parseCsv(text, label = 'CSV') {
  if (typeof text !== 'string') throw new HistoricalArchiveError(`${label} is not text.`);
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let justClosedQuote = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          justClosedQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (justClosedQuote && char !== ',' && char !== '\r' && char !== '\n') {
      throw new HistoricalArchiveError(`${label} has characters after a closing quote.`);
    }
    if (char === '"') {
      if (field.length > 0) throw new HistoricalArchiveError(`${label} has an unexpected quote.`);
      quoted = true;
      justClosedQuote = false;
    } else if (char === ',') {
      row.push(field);
      field = '';
      justClosedQuote = false;
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      justClosedQuote = false;
    } else {
      field += char;
    }
  }
  if (quoted) throw new HistoricalArchiveError(`${label} has an unterminated quoted field.`);
  if (field.length > 0 || row.length > 0 || justClosedQuote) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length && rows.at(-1).every((value) => value === '')) rows.pop();
  return rows;
}

function csvObjects(buffer, definition) {
  if (!Buffer.isBuffer(buffer)) throw new HistoricalArchiveError(`${definition.name} is required.`);
  if (buffer.length === 0) throw new HistoricalArchiveError(`${definition.name} is empty.`);
  if (buffer.length > MAX_FILE_BYTES) {
    throw new HistoricalArchiveError(`${definition.name} exceeds the ${MAX_FILE_BYTES}-byte limit.`);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new HistoricalArchiveError(`${definition.name} is not valid UTF-8 text.`);
  }
  const rows = parseCsv(text, definition.name);
  if (!rows.length) throw new HistoricalArchiveError(`${definition.name} has no header row.`);
  const expected = definition.headers;
  if (rows[0].length !== expected.length || rows[0].some((value, index) => value !== expected[index])) {
    throw new HistoricalArchiveError(
      `${definition.name} headers must be exactly: ${expected.join(',')}.`
    );
  }
  const data = rows.slice(1);
  if (data.length > definition.maxRows) {
    throw new HistoricalArchiveError(`${definition.name} exceeds the ${definition.maxRows}-row limit.`);
  }
  return data.map((values, rowIndex) => {
    if (values.length !== expected.length) {
      throw new HistoricalArchiveError(
        `${definition.name} row ${rowIndex + 2} has ${values.length} columns; expected ${expected.length}.`
      );
    }
    return Object.fromEntries(expected.map((header, index) => [header, values[index]]));
  });
}

function requiredText(value, field, row, maxLength = 120) {
  if (value === '' || value.trim() !== value) {
    throw new HistoricalArchiveError(`${field} on row ${row} is empty or has surrounding whitespace.`);
  }
  if (value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new HistoricalArchiveError(`${field} on row ${row} is invalid.`);
  }
  return value;
}

function integer(value, field, row, { min = 0, max = 1000000000 } = {}) {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new HistoricalArchiveError(`${field} on row ${row} must be a whole number.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new HistoricalArchiveError(`${field} on row ${row} is out of range.`);
  }
  return parsed;
}

function amount(value, field, row) {
  if (!/^(0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) {
    throw new HistoricalArchiveError(`${field} on row ${row} must be a non-negative decimal with at most 2 places.`);
  }
  const [whole, fraction = ''] = value.split('.');
  return {
    database: `${whole}.${fraction.padEnd(2, '0')}`,
    minor: BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')),
  };
}

function validateDateText(value, field, row, optional = false) {
  if (optional && value === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|[+-](\d{2}):(\d{2}))?)?$/.exec(value);
  if (!match) throw new HistoricalArchiveError(`${field} on row ${row} is not a supported ISO date/time.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    year < 1900 || year > 2200 || check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day
    || hour > 23 || minute > 59 || second > 59
  ) throw new HistoricalArchiveError(`${field} on row ${row} is not a valid calendar date/time.`);
  if (match[8] && (Number(match[8]) > 23 || Number(match[9]) > 59)) {
    throw new HistoricalArchiveError(`${field} on row ${row} has an invalid timezone offset.`);
  }
  return value;
}

function monthKey(value, row) {
  validateDateText(value, 'sale_month', row);
  if (value.slice(8, 10) !== '01') {
    throw new HistoricalArchiveError(`sale_month on row ${row} must be the first day of a month.`);
  }
  return value.slice(0, 7);
}

function totalsFor(rows) {
  const totals = {
    totalTransactions: rows.length,
    completedTransactions: 0,
    completedAmountMinor: 0n,
    refundedTransactions: 0,
    refundedAmountMinor: 0n,
  };
  for (const row of rows) {
    if (row.status === 'completed') {
      totals.completedTransactions += 1;
      totals.completedAmountMinor += row.totalMinor;
    } else if (row.status === 'refunded') {
      totals.refundedTransactions += 1;
      totals.refundedAmountMinor += row.totalMinor;
    }
  }
  return totals;
}

function assertTotals(actual, summary, context) {
  const comparisons = [
    ['total transaction count', actual.totalTransactions, summary.totalTransactions],
    ['completed transaction count', actual.completedTransactions, summary.completedTransactions],
    ['completed amount', actual.completedAmountMinor, summary.completedAmountMinor],
    ['refunded transaction count', actual.refundedTransactions, summary.refundedTransactions],
    ['refunded amount', actual.refundedAmountMinor, summary.refundedAmountMinor],
  ];
  for (const [label, left, right] of comparisons) {
    if (left !== right) throw new HistoricalArchiveError(`${context} ${label} does not match historical-sales.csv.`);
  }
}

function validateArchive(fileBuffers) {
  const rawSales = csvObjects(fileBuffers.historicalSales, FILES.historicalSales);
  const rawMonths = csvObjects(fileBuffers.monthlySummary, FILES.monthlySummary);
  const rawAllTime = csvObjects(fileBuffers.allTimeSummary, FILES.allTimeSummary);
  if (!rawSales.length) throw new HistoricalArchiveError('historical-sales.csv must contain at least one transaction.');
  if (!rawMonths.length) throw new HistoricalArchiveError('monthly-sales-summary.csv must contain at least one month.');
  if (rawAllTime.length !== 1) throw new HistoricalArchiveError('all-time-sales-summary.csv must contain exactly one data row.');

  const ids = new Set();
  const invoices = new Set();
  const sales = rawSales.map((row, index) => {
    const rowNumber = index + 2;
    const legacyId = integer(row.id, 'id', rowNumber, { min: 1, max: Number.MAX_SAFE_INTEGER });
    const invoiceNumber = requiredText(row.invoice_number, 'invoice_number', rowNumber);
    if (ids.has(legacyId)) throw new HistoricalArchiveError(`Duplicate historical id ${legacyId}.`);
    if (invoices.has(invoiceNumber)) throw new HistoricalArchiveError(`Duplicate historical invoice number ${invoiceNumber}.`);
    ids.add(legacyId);
    invoices.add(invoiceNumber);
    const createdAt = validateDateText(row.created_at, 'created_at', rowNumber);
    const status = requiredText(row.status, 'status', rowNumber, 20).toLowerCase();
    if (!['completed', 'refunded', 'voided'].includes(status)) {
      throw new HistoricalArchiveError(`status on row ${rowNumber} must be completed, refunded, or voided.`);
    }
    const subtotal = amount(row.subtotal, 'subtotal', rowNumber);
    const tax = amount(row.tax, 'tax', rowNumber);
    const discount = amount(row.discount, 'discount', rowNumber);
    const total = amount(row.total, 'total', rowNumber);
    if (subtotal.minor + tax.minor - discount.minor !== total.minor) {
      throw new HistoricalArchiveError(`Amounts on historical-sales.csv row ${rowNumber} do not reconcile.`);
    }
    const refundedAt = validateDateText(row.refunded_at, 'refunded_at', rowNumber, true);
    const voidedAt = validateDateText(row.voided_at, 'voided_at', rowNumber, true);
    if (status === 'refunded' && !refundedAt) {
      throw new HistoricalArchiveError(`refunded_at is required for refunded row ${rowNumber}.`);
    }
    if (status === 'voided' && !voidedAt) {
      throw new HistoricalArchiveError(`voided_at is required for voided row ${rowNumber}.`);
    }
    return {
      legacyId, invoiceNumber, createdAt, saleMonth: `${createdAt.slice(0, 7)}-01`, status,
      subtotal: subtotal.database, tax: tax.database, discount: discount.database,
      total: total.database, totalMinor: total.minor,
      paymentMethod: requiredText(row.payment_method, 'payment_method', rowNumber, 80),
      refundedAt, voidedAt,
    };
  });

  const seenMonths = new Set();
  const months = rawMonths.map((row, index) => {
    const rowNumber = index + 2;
    const key = monthKey(row.sale_month, rowNumber);
    if (seenMonths.has(key)) throw new HistoricalArchiveError(`Duplicate monthly summary for ${key}.`);
    seenMonths.add(key);
    const completedAmount = amount(row.completed_amount, 'completed_amount', rowNumber);
    const refundedAmount = amount(row.refunded_amount, 'refunded_amount', rowNumber);
    return {
      saleMonth: `${key}-01`, key,
      totalTransactions: undefined,
      completedTransactions: integer(row.completed_transactions, 'completed_transactions', rowNumber),
      completedAmount: completedAmount.database,
      completedAmountMinor: completedAmount.minor,
      refundedTransactions: integer(row.refunded_transactions, 'refunded_transactions', rowNumber),
      refundedAmount: refundedAmount.database,
      refundedAmountMinor: refundedAmount.minor,
    };
  }).sort((left, right) => left.key.localeCompare(right.key));

  const allRow = rawAllTime[0];
  const allCompletedAmount = amount(allRow.completed_amount, 'completed_amount', 2);
  const allRefundedAmount = amount(allRow.refunded_amount, 'refunded_amount', 2);
  const allTime = {
    totalTransactions: integer(allRow.total_transactions, 'total_transactions', 2),
    completedTransactions: integer(allRow.completed_transactions, 'completed_transactions', 2),
    completedAmount: allCompletedAmount.database,
    completedAmountMinor: allCompletedAmount.minor,
    refundedTransactions: integer(allRow.refunded_transactions, 'refunded_transactions', 2),
    refundedAmount: allRefundedAmount.database,
    refundedAmountMinor: allRefundedAmount.minor,
  };

  const computedAll = totalsFor(sales);
  assertTotals(computedAll, allTime, 'All-time summary');
  const grouped = new Map();
  for (const sale of sales) {
    const key = sale.saleMonth.slice(0, 7);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(sale);
  }
  if (grouped.size !== months.length || months.some((month) => !grouped.has(month.key))) {
    throw new HistoricalArchiveError('Monthly summary months do not exactly match historical-sales.csv.');
  }
  for (const month of months) {
    const computed = totalsFor(grouped.get(month.key));
    delete computed.totalTransactions;
    const comparableMonth = { ...month };
    delete comparableMonth.totalTransactions;
    assertTotals({ totalTransactions: undefined, ...computed }, comparableMonth, `Monthly summary ${month.key}`);
  }
  const monthlyCompleted = months.reduce((sum, row) => sum + row.completedAmountMinor, 0n);
  const monthlyRefunded = months.reduce((sum, row) => sum + row.refundedAmountMinor, 0n);
  const monthlyCompletedCount = months.reduce((sum, row) => sum + row.completedTransactions, 0);
  const monthlyRefundedCount = months.reduce((sum, row) => sum + row.refundedTransactions, 0);
  if (
    monthlyCompleted !== allTime.completedAmountMinor || monthlyRefunded !== allTime.refundedAmountMinor
    || monthlyCompletedCount !== allTime.completedTransactions
    || monthlyRefundedCount !== allTime.refundedTransactions
  ) throw new HistoricalArchiveError('Monthly summaries do not reconcile with the all-time summary.');

  return { sales, months, allTime };
}

function archiveDigest(fileBuffers) {
  const hash = crypto.createHash('sha256');
  for (const key of Object.keys(FILES)) {
    const buffer = fileBuffers[key];
    if (!Buffer.isBuffer(buffer)) throw new HistoricalArchiveError(`${FILES[key].name} is required.`);
    hash.update(key);
    hash.update(String(buffer.length));
    hash.update('\0');
    hash.update(buffer);
  }
  return hash.digest('hex');
}

function previewArchive(fileBuffers, secret, now = Date.now()) {
  if (!secret) throw new Error('JWT_SECRET is required to issue an import preview.');
  const archive = validateArchive(fileBuffers);
  const digest = archiveDigest(fileBuffers);
  const expiresAt = now + PREVIEW_TTL_MS;
  const payload = `${digest}.${expiresAt}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return {
    archive,
    preview: {
      digest,
      expiresAt: new Date(expiresAt).toISOString(),
      previewToken: `${payload}.${signature}`,
      summary: publicSummary(archive.allTime),
      months: archive.months.map(publicMonth),
    },
  };
}

function verifyPreviewToken(token, digest, secret, now = Date.now()) {
  const match = /^([0-9a-f]{64})\.(\d{13})\.([0-9a-f]{64})$/.exec(String(token || ''));
  if (!match || match[1] !== digest || Number(match[2]) < now) {
    throw new HistoricalArchiveError('Import preview is missing, expired, or does not match these files.', 400, 'HISTORICAL_PREVIEW_INVALID');
  }
  const expected = crypto.createHmac('sha256', secret).update(`${match[1]}.${match[2]}`).digest();
  const actual = Buffer.from(match[3], 'hex');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new HistoricalArchiveError('Import preview is invalid.', 400, 'HISTORICAL_PREVIEW_INVALID');
  }
}

function publicSummary(row) {
  return {
    totalTransactions: Number(row.totalTransactions),
    completedTransactions: Number(row.completedTransactions),
    completedAmount: Number(row.completedAmount),
    refundedTransactions: Number(row.refundedTransactions),
    refundedAmount: Number(row.refundedAmount),
  };
}

function publicMonth(row) {
  return {
    saleMonth: row.saleMonth,
    completedTransactions: Number(row.completedTransactions),
    completedAmount: Number(row.completedAmount),
    refundedTransactions: Number(row.refundedTransactions),
    refundedAmount: Number(row.refundedAmount),
  };
}

async function importArchive(pool, fileBuffers, { previewToken, userId, secret, now = Date.now() }) {
  const archive = validateArchive(fileBuffers);
  const digest = archiveDigest(fileBuffers);
  verifyPreviewToken(previewToken, digest, secret, now);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query('SELECT id, role FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (user.rows[0]?.role !== 'admin') {
      throw new HistoricalArchiveError('Admin access required.', 403, 'HISTORICAL_ADMIN_REQUIRED');
    }
    await client.query('LOCK TABLE historical_sales_archives IN EXCLUSIVE MODE');
    const existing = await client.query('SELECT archive_digest FROM historical_sales_archives WHERE id = 1');
    if (existing.rows.length) {
      if (existing.rows[0].archive_digest === digest) {
        await client.query('COMMIT');
        return { imported: false, alreadyImported: true, digest, summary: publicSummary(archive.allTime) };
      }
      throw new HistoricalArchiveError(
        'A different historical archive is already installed. Replacement is not supported.',
        409,
        'HISTORICAL_ARCHIVE_REPLACEMENT_REFUSED'
      );
    }
    await client.query(
      `INSERT INTO historical_sales_archives
        (id, archive_digest, source_label, transaction_count, imported_by)
       VALUES (1, $1, 'Archived / Legacy POS', $2, $3)`,
      [digest, archive.sales.length, userId]
    );
    for (const sale of archive.sales) {
      await client.query(
        `INSERT INTO historical_sales
          (archive_id, legacy_id, invoice_number, created_at_text, sale_month, status,
           subtotal, tax, discount, total, payment_method, refunded_at_text, voided_at_text)
         VALUES (1, $1, $2, $3, $4::date, $5, $6::numeric, $7::numeric, $8::numeric,
                 $9::numeric, $10, $11, $12)`,
        [sale.legacyId, sale.invoiceNumber, sale.createdAt, sale.saleMonth, sale.status,
          sale.subtotal, sale.tax, sale.discount, sale.total, sale.paymentMethod,
          sale.refundedAt, sale.voidedAt]
      );
    }
    for (const month of archive.months) {
      await client.query(
        `INSERT INTO historical_monthly_summaries
          (archive_id, sale_month, completed_transactions, completed_amount,
           refunded_transactions, refunded_amount)
         VALUES (1, $1::date, $2, $3::numeric, $4, $5::numeric)`,
        [month.saleMonth, month.completedTransactions, month.completedAmount,
          month.refundedTransactions, month.refundedAmount]
      );
    }
    await client.query(
      `INSERT INTO historical_all_time_summaries
        (archive_id, total_transactions, completed_transactions, completed_amount,
         refunded_transactions, refunded_amount)
       VALUES (1, $1, $2, $3::numeric, $4, $5::numeric)`,
      [archive.allTime.totalTransactions, archive.allTime.completedTransactions,
        archive.allTime.completedAmount, archive.allTime.refundedTransactions,
        archive.allTime.refundedAmount]
    );
    await client.query('COMMIT');
    return { imported: true, alreadyImported: false, digest, summary: publicSummary(archive.allTime) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function normalizeHistoricalQuery(query = {}) {
  const status = String(query.status || 'all').toLowerCase();
  if (!['all', 'completed', 'refunded', 'voided'].includes(status)) {
    throw new HistoricalArchiveError('Historical status filter is invalid.');
  }
  const search = String(query.q || '').trim();
  if (search.length > 100) throw new HistoricalArchiveError('Historical invoice search is too long.');
  return { status, search };
}

async function getHistoricalReport(queryable, query = {}) {
  const filters = normalizeHistoricalQuery(query);
  const archiveResult = await queryable.query(
    `SELECT archive_digest, source_label, transaction_count, imported_at
     FROM historical_sales_archives WHERE id = 1`
  );
  if (!archiveResult.rows.length) return { imported: false, archive: null, summary: null, months: [], transactions: [] };
  const [summaryResult, monthsResult, salesResult] = await Promise.all([
    queryable.query(
      `SELECT total_transactions, completed_transactions, completed_amount,
              refunded_transactions, refunded_amount
       FROM historical_all_time_summaries WHERE archive_id = 1`
    ),
    queryable.query(
      `SELECT sale_month::text, completed_transactions, completed_amount,
              refunded_transactions, refunded_amount
       FROM historical_monthly_summaries WHERE archive_id = 1 ORDER BY sale_month ASC`
    ),
    queryable.query(
      `SELECT legacy_id::text, invoice_number, created_at_text, status,
              payment_method, subtotal, discount, tax, total
       FROM historical_sales
       WHERE archive_id = 1
         AND ($1 = 'all' OR status = $1)
         AND ($2 = '' OR invoice_number ILIKE '%' || $2 || '%')
       ORDER BY created_at_text ASC, legacy_id ASC
       LIMIT 10000`,
      [filters.status, filters.search]
    ),
  ]);
  return {
    imported: true,
    archive: {
      digest: archiveResult.rows[0].archive_digest,
      sourceLabel: archiveResult.rows[0].source_label,
      transactionCount: Number(archiveResult.rows[0].transaction_count),
      importedAt: archiveResult.rows[0].imported_at,
    },
    summary: publicSummary({
      totalTransactions: summaryResult.rows[0].total_transactions,
      completedTransactions: summaryResult.rows[0].completed_transactions,
      completedAmount: summaryResult.rows[0].completed_amount,
      refundedTransactions: summaryResult.rows[0].refunded_transactions,
      refundedAmount: summaryResult.rows[0].refunded_amount,
    }),
    months: monthsResult.rows.map((row) => publicMonth({
      saleMonth: row.sale_month,
      completedTransactions: row.completed_transactions,
      completedAmount: row.completed_amount,
      refundedTransactions: row.refunded_transactions,
      refundedAmount: row.refunded_amount,
    })),
    transactions: salesResult.rows.map((row) => ({
      legacyId: row.legacy_id,
      invoiceNumber: row.invoice_number,
      createdAt: row.created_at_text,
      status: row.status,
      paymentMethod: row.payment_method,
      subtotal: Number(row.subtotal),
      discount: Number(row.discount),
      tax: Number(row.tax),
      total: Number(row.total),
      source: 'Archived / Legacy POS',
    })),
  };
}

function csvSafe(value) {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

module.exports = {
  FILES,
  MAX_FILE_BYTES,
  HistoricalArchiveError,
  parseCsv,
  validateArchive,
  archiveDigest,
  previewArchive,
  verifyPreviewToken,
  importArchive,
  normalizeHistoricalQuery,
  getHistoricalReport,
  csvSafe,
};
