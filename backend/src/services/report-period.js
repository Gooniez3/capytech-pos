class ReportPeriodError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReportPeriodError';
    this.status = 400;
  }
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateOnly(value, label) {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) {
    throw new ReportPeriodError(`${label} must use YYYY-MM-DD format`);
  }
  const [, yearText, monthText, dayText] = DATE_ONLY.exec(value);
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new ReportPeriodError(`${label} is not a valid calendar date`);
  }
  return value;
}

function shiftDate(dateOnly, days) {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatPeriodDate(dateOnly) {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function normalizeReportPeriod(query, today) {
  const currentDate = parseDateOnly(today, 'Current shop date');
  const range = String(query.range || 'month');
  let from;
  let to;
  let label;
  let trendGrain;

  switch (range) {
    case 'today':
      from = currentDate;
      to = currentDate;
      label = 'Today';
      trendGrain = 'hourly';
      break;
    case 'yesterday':
      from = shiftDate(currentDate, -1);
      to = from;
      label = 'Yesterday';
      trendGrain = 'hourly';
      break;
    case 'week':
      from = shiftDate(currentDate, -6);
      to = currentDate;
      label = 'Last 7 Days';
      trendGrain = 'daily-week';
      break;
    case 'month':
      from = shiftDate(currentDate, -29);
      to = currentDate;
      label = 'Last 30 Days';
      trendGrain = 'daily';
      break;
    case 'year':
      from = `${currentDate.slice(0, 4)}-01-01`;
      to = currentDate;
      label = 'This Year';
      trendGrain = 'monthly';
      break;
    case 'custom':
      from = parseDateOnly(query.from, 'From date');
      to = parseDateOnly(query.to, 'To date');
      if (from > to) throw new ReportPeriodError('From date cannot be after To date');
      if (to > currentDate) throw new ReportPeriodError('Reporting dates cannot be in the future');
      label = from === to
        ? formatPeriodDate(from)
        : `${formatPeriodDate(from)} – ${formatPeriodDate(to)}`;
      trendGrain = from === to ? 'hourly' : 'daily';
      break;
    default:
      throw new ReportPeriodError('Unsupported reporting range');
  }

  return Object.freeze({ range, from, to, label, trendGrain, values: [from, to] });
}

async function resolveReportPeriod(queryable, query) {
  const result = await queryable.query('SELECT CURRENT_DATE::text AS today');
  return normalizeReportPeriod(query, result.rows[0].today);
}

function timestampPredicate(column) {
  return `${column} >= $1::date AND ${column} < ($2::date + INTERVAL '1 day')`;
}

module.exports = {
  ReportPeriodError,
  normalizeReportPeriod,
  resolveReportPeriod,
  timestampPredicate,
};
