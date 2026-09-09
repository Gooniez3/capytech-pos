import { useId, useMemo, useState } from 'react';
import type { RevenuePoint } from '@/types';
import { formatCompact, formatCurrency } from '@/lib/currency';

interface RevenueChartProps {
  data: RevenuePoint[];
}

interface Point {
  label: string;
  revenue: number;
  profit: number;
  cogs: number;
  x: number;
  revenueY: number;
  profitY: number;
}

function shopMarginPercent(
  profit: number,
  cogs: number
) {
  const netOfTax = profit + cogs;

  if (netOfTax === 0) {
    return 0;
  }

  return (profit / netOfTax) * 100;
}

export function RevenueChart({ data }: RevenueChartProps) {
  const gradientId = useId().replace(/:/g, '');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const WIDTH = 900;
  const HEIGHT = 260;

  const LEFT = 58;
  const RIGHT = 18;
  const TOP = 22;
  const BOTTOM = 38;

  const chartWidth = WIDTH - LEFT - RIGHT;
  const chartHeight = HEIGHT - TOP - BOTTOM;

  const normalized = useMemo(
    () =>
      data.map((item) => {
        const revenue = Number(item.revenue) || 0;
        const profit = Number(item.profit) || 0;
        const cogs =
          item.cogs !== undefined
            ? Number(item.cogs) || 0
            : Math.max(0, revenue - profit);

        return {
          label: item.label,
          revenue,
          profit,
          cogs,
        };
      }),
    [data]
  );

  const totalRevenue = normalized.reduce(
    (sum, item) => sum + item.revenue,
    0
  );

  const totalProfit = normalized.reduce(
    (sum, item) => sum + item.profit,
    0
  );

  const rawMax = Math.max(
    0,
    ...normalized.map((item) => item.revenue),
    ...normalized.map((item) => item.profit)
  );

  // Give the chart some headroom.
  const maxValue =
    rawMax === 0
      ? 100000
      : Math.ceil((rawMax * 1.2) / 10000) * 10000;

  const points: Point[] = normalized.map((item, index) => {
    const x =
      normalized.length <= 1
        ? LEFT + chartWidth / 2
        : LEFT +
          (index / (normalized.length - 1)) * chartWidth;

    const revenueY =
      TOP +
      chartHeight -
      (item.revenue / maxValue) * chartHeight;

    const profitY =
      TOP +
      chartHeight -
      (item.profit / maxValue) * chartHeight;

    return {
      ...item,
      x,
      revenueY,
      profitY,
    };
  });

  function smoothPath(
    items: Point[],
    getY: (point: Point) => number
  ) {
    if (!items.length) return '';

    if (items.length === 1) {
      return `M ${items[0].x} ${getY(items[0])}`;
    }

    let path = `M ${items[0].x} ${getY(items[0])}`;

    for (let i = 0; i < items.length - 1; i++) {
      const current = items[i];
      const next = items[i + 1];

      const currentY = getY(current);
      const nextY = getY(next);

      const middleX = (current.x + next.x) / 2;

      path += ` C ${middleX} ${currentY}, ${middleX} ${nextY}, ${next.x} ${nextY}`;
    }

    return path;
  }

  const revenuePath = smoothPath(
    points,
    (point) => point.revenueY
  );

  const profitPath = smoothPath(
    points,
    (point) => point.profitY
  );

  const baseY = TOP + chartHeight;

  const revenueArea =
    points.length > 0
      ? `${revenuePath} L ${
          points[points.length - 1].x
        } ${baseY} L ${points[0].x} ${baseY} Z`
      : '';

  const profitArea =
    points.length > 0
      ? `${profitPath} L ${
          points[points.length - 1].x
        } ${baseY} L ${points[0].x} ${baseY} Z`
      : '';

  const gridLines = 4;

  const active =
    activeIndex !== null
      ? points[activeIndex]
      : null;

  const hasSales = normalized.some(
    (item) => item.revenue > 0 || item.profit > 0
  );

  return (
    <div className="w-full">
      {/* Chart summary */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />

              <span className="text-xs font-medium text-slate-500">
                Revenue
              </span>
            </div>

            <p className="text-lg font-bold text-slate-900 tabular-nums">
              {formatCurrency(totalRevenue)}
            </p>
          </div>

          <div className="h-10 w-px bg-slate-200" />

          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-success-500" />

              <span className="text-xs font-medium text-slate-500">
                Gross Profit
              </span>
            </div>

            <p className="text-lg font-bold text-emerald-600 tabular-nums">
              {formatCurrency(totalProfit)}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500">
          Last 7 days
        </div>
      </div>

      {!hasSales ? (
        <div className="flex h-[260px] items-center justify-center">
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-700">
              No sales activity
            </p>

            <p className="mt-1 text-xs text-slate-400">
              Sales performance will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="relative w-full">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-[260px] w-full overflow-visible"
            preserveAspectRatio="none"
            onMouseLeave={() => setActiveIndex(null)}
          >
            <defs>
              {/* Revenue gradient */}
              <linearGradient
                id={`revenue-${gradientId}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor="rgb(37 99 235)"
                  stopOpacity="0.20"
                />

                <stop
                  offset="100%"
                  stopColor="rgb(37 99 235)"
                  stopOpacity="0"
                />
              </linearGradient>

              {/* Profit gradient */}
              <linearGradient
                id={`profit-${gradientId}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor="rgb(16 185 129)"
                  stopOpacity="0.15"
                />

                <stop
                  offset="100%"
                  stopColor="rgb(16 185 129)"
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>

            {/* Grid + Y labels */}
            {Array.from({
              length: gridLines + 1,
            }).map((_, index) => {
              const ratio = index / gridLines;

              const y =
                TOP + ratio * chartHeight;

              const value =
                maxValue * (1 - ratio);

              return (
                <g key={index}>
                  <line
                    x1={LEFT}
                    x2={WIDTH - RIGHT}
                    y1={y}
                    y2={y}
                    stroke="#e2e8f0"
                    strokeWidth="1"
                    strokeDasharray={
                      index === gridLines
                        ? undefined
                        : '4 5'
                    }
                  />

                  <text
                    x={LEFT - 10}
                    y={y + 4}
                    textAnchor="end"
                    fontSize="10"
                    fill="#94a3b8"
                  >
                    {value === 0
                      ? '0'
                      : formatCompact(value)}
                  </text>
                </g>
              );
            })}

            {/* Areas */}
            <path
              d={revenueArea}
              fill={`url(#revenue-${gradientId})`}
            />

            <path
              d={profitArea}
              fill={`url(#profit-${gradientId})`}
            />

            {/* Revenue */}
            <path
              d={revenuePath}
              fill="none"
              stroke="#2563eb"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />

            {/* Profit */}
            <path
              d={profitPath}
              fill="none"
              stroke="#10b981"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />

            {/* X-axis labels */}
            {points.map((point) => (
              <text
                key={`label-${point.label}`}
                x={point.x}
                y={HEIGHT - 10}
                textAnchor="middle"
                fontSize="11"
                fill="#64748b"
              >
                {point.label}
              </text>
            ))}

            {/* Hover areas */}
            {points.map((point, index) => {
              const sectionWidth =
                chartWidth /
                Math.max(points.length, 1);

              return (
                <rect
                  key={`hover-${point.label}`}
                  x={
                    point.x -
                    sectionWidth / 2
                  }
                  y={TOP}
                  width={sectionWidth}
                  height={chartHeight}
                  fill="transparent"
                  className="cursor-crosshair"
                  onMouseEnter={() =>
                    setActiveIndex(index)
                  }
                />
              );
            })}

            {/* Active vertical line */}
            {active && (
              <>
                <line
                  x1={active.x}
                  x2={active.x}
                  y1={TOP}
                  y2={baseY}
                  stroke="#cbd5e1"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />

                <circle
                  cx={active.x}
                  cy={active.revenueY}
                  r="5"
                  fill="white"
                  stroke="#2563eb"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />

                <circle
                  cx={active.x}
                  cy={active.profitY}
                  r="5"
                  fill="white"
                  stroke="#10b981"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />
              </>
            )}
          </svg>

          {/* Professional tooltip */}
          {active && activeIndex !== null && (
            <div
              className="pointer-events-none absolute z-20 min-w-[170px] rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
              style={{
                left: `${
                  (active.x / WIDTH) * 100
                }%`,
                top: '18px',
                transform:
                  activeIndex >
                  points.length / 2
                    ? 'translateX(-105%)'
                    : 'translateX(10px)',
              }}
            >
              <p className="mb-2 text-xs font-semibold text-slate-900">
                {active.label}
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-5">
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="h-2 w-2 rounded-full bg-brand-500" />
                    Revenue
                  </span>

                  <span className="text-xs font-bold text-slate-900">
                    {formatCurrency(
                      active.revenue
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-5">
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="h-2 w-2 rounded-full bg-success-500" />
                    Profit
                  </span>

                  <span className="text-xs font-bold text-emerald-600">
                    {formatCurrency(
                      active.profit
                    )}
                  </span>
                </div>

                {active.revenue > 0 && (
                  <div className="border-t border-slate-100 pt-2">
                    <div className="flex justify-between gap-5 text-xs">
                      <span className="text-slate-500">
                        Margin
                      </span>

                      <span className="font-semibold text-slate-700">
                        {shopMarginPercent(
                          active.profit,
                          active.cogs
                        ).toFixed(1)}
                        %
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}