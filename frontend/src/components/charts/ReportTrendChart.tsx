import {
  useId,
  useMemo,
  useState,
} from 'react';

import {
  formatCompact,
  formatCurrency,
} from '@/lib/currency';

/* =========================================================
   TYPES
   ========================================================= */

type ReportRange =
  | 'today'
  | 'week'
  | 'month'
  | 'year';

interface RevenuePoint {
  date: string;
  label: string;
  revenue: number;
  profit: number;
  cogs?: number;
}

interface ReportTrendChartProps {
  data: RevenuePoint[];
  range: ReportRange;
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

interface ChartPoint {
  date: string;
  label: string;

  revenue: number;
  profit: number;
  cogs: number;

  x: number;

  revenueY: number;
  profitY: number;
  cogsY: number;
}

/* =========================================================
   REPORT TREND CHART
   ========================================================= */

export function ReportTrendChart({
  data,
  range,
}: ReportTrendChartProps) {
  const gradientId =
    useId().replace(
      /:/g,
      ''
    );

  const [
    activeIndex,
    setActiveIndex,
  ] = useState<
    number | null
  >(null);

  /*
   * SVG internal dimensions.
   * The browser scales this responsively.
   */
  const WIDTH = 1000;
  const HEIGHT = 340;

  const LEFT = 68;
  const RIGHT = 24;
  const TOP = 28;
  const BOTTOM = 48;

  const chartWidth =
    WIDTH -
    LEFT -
    RIGHT;

  const chartHeight =
    HEIGHT -
    TOP -
    BOTTOM;

  /* =========================================================
     NORMALIZE DATA
     ========================================================= */

  const normalized =
    useMemo(
      () =>
        data.map(
          (item) => {
            const revenue =
              Number(
                item.revenue
              ) || 0;

            const profit =
              Number(
                item.profit
              ) || 0;

            /*
             * If backend does not return COGS yet,
             * derive it from revenue - profit.
             */
            const cogs =
              item.cogs !==
              undefined
                ? Number(
                    item.cogs
                  ) || 0
                : Math.max(
                    0,
                    revenue -
                      profit
                  );

            return {
              date:
                item.date,

              label:
                item.label,

              revenue,

              profit,

              cogs,
            };
          }
        ),
      [data]
    );

  /* =========================================================
     TOTALS
     ========================================================= */

  const totals =
    useMemo(() => {
      return normalized.reduce(
        (
          result,
          item
        ) => ({
          revenue:
            result.revenue +
            item.revenue,

          profit:
            result.profit +
            item.profit,

          cogs:
            result.cogs +
            item.cogs,
        }),
        {
          revenue: 0,
          profit: 0,
          cogs: 0,
        }
      );
    }, [normalized]);

  const overallMargin = shopMarginPercent(
    totals.profit,
    totals.cogs
  );

  /* =========================================================
     SCALE
     ========================================================= */

  const rawMax =
    Math.max(
      0,

      ...normalized.map(
        (item) =>
          item.revenue
      ),

      ...normalized.map(
        (item) =>
          item.profit
      ),

      ...normalized.map(
        (item) =>
          item.cogs
      )
    );

  /*
   * Add headroom and round scale upward.
   */
  function roundMax(
    value: number
  ) {
    if (value <= 0) {
      return 100000;
    }

    const padded =
      value * 1.18;

    if (
      padded <=
      100000
    ) {
      return (
        Math.ceil(
          padded /
            10000
        ) *
        10000
      );
    }

    if (
      padded <=
      1000000
    ) {
      return (
        Math.ceil(
          padded /
            50000
        ) *
        50000
      );
    }

    return (
      Math.ceil(
        padded /
          100000
      ) *
      100000
    );
  }

  const maxValue =
    roundMax(rawMax);

  /* =========================================================
     POINTS
     ========================================================= */

  const points:
    ChartPoint[] =
    normalized.map(
      (
        item,
        index
      ) => {
        const x =
          normalized.length <=
          1
            ? LEFT +
              chartWidth /
                2
            : LEFT +
              (index /
                (
                  normalized.length -
                  1
                )) *
                chartWidth;

        const toY = (
          value: number
        ) =>
          TOP +
          chartHeight -
          (value /
            maxValue) *
            chartHeight;

        return {
          ...item,

          x,

          revenueY:
            toY(
              item.revenue
            ),

          profitY:
            toY(
              item.profit
            ),

          cogsY:
            toY(
              item.cogs
            ),
        };
      }
    );

  /* =========================================================
     SMOOTH PATH
     ========================================================= */

  function smoothPath(
    items: ChartPoint[],
    getY: (
      point: ChartPoint
    ) => number
  ) {
    if (
      items.length ===
      0
    ) {
      return '';
    }

    if (
      items.length ===
      1
    ) {
      return `M ${items[0].x} ${getY(
        items[0]
      )}`;
    }

    let path =
      `M ${items[0].x} ${getY(
        items[0]
      )}`;

    for (
      let index = 0;
      index <
      items.length - 1;
      index++
    ) {
      const current =
        items[index];

      const next =
        items[
          index + 1
        ];

      const currentY =
        getY(current);

      const nextY =
        getY(next);

      const middleX =
        (
          current.x +
          next.x
        ) /
        2;

      path +=
        ` C ${middleX} ${currentY},` +
        ` ${middleX} ${nextY},` +
        ` ${next.x} ${nextY}`;
    }

    return path;
  }

  const revenuePath =
    smoothPath(
      points,
      (point) =>
        point.revenueY
    );

  const profitPath =
    smoothPath(
      points,
      (point) =>
        point.profitY
    );

  const cogsPath =
    smoothPath(
      points,
      (point) =>
        point.cogsY
    );

  const baseY =
    TOP +
    chartHeight;

  const revenueArea =
    points.length >
    0
      ? `${revenuePath} L ${
          points[
            points.length -
              1
          ].x
        } ${baseY} L ${
          points[0].x
        } ${baseY} Z`
      : '';

  /* =========================================================
     AXIS LABEL FREQUENCY
     ========================================================= */

  function shouldShowLabel(
    index: number,
    total: number
  ) {
    if (
      range ===
      'today'
    ) {
      /*
       * Later backend should
       * return hourly buckets.
       */
      return (
        index % 3 ===
          0 ||
        index ===
          total - 1
      );
    }

    if (
      range ===
      'week'
    ) {
      return true;
    }

    if (
      range ===
      'month'
    ) {
      /*
       * Prevent 30 labels
       * overlapping.
       */
      return (
        index % 5 ===
          0 ||
        index ===
          total - 1
      );
    }

    /*
     * Year should eventually
     * return Jan-Dec.
     */
    return true;
  }

  /* =========================================================
     EMPTY DATA
     ========================================================= */

  const hasData =
    normalized.some(
      (item) =>
        item.revenue >
          0 ||
        item.profit >
          0 ||
        item.cogs >
          0
    );

  const active =
    activeIndex !== null
      ? points[
          activeIndex
        ]
      : null;

  /* =========================================================
     UI
     ========================================================= */

  return (
    <div className="space-y-5">

      {/* =====================================================
          FINANCIAL SUMMARY
          ===================================================== */}

      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">

        <ChartMetric
          label="Revenue"
          value={formatCurrency(
            totals.revenue
          )}
          dotClassName="bg-brand-500"
        />

        <ChartMetric
          label="COGS"
          value={formatCurrency(
            totals.cogs
          )}
          dotClassName="bg-slate-400"
        />

        <ChartMetric
          label="Gross Profit"
          value={formatCurrency(
            totals.profit
          )}
          dotClassName="bg-success-500"
          valueClassName="text-success-600"
        />

        <div className="ml-auto">

          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Margin
          </p>

          <p className="mt-1 text-xl font-bold text-slate-900 tabular-nums">
            {overallMargin.toFixed(
              1
            )}
            %
          </p>

        </div>

      </div>

      {/* =====================================================
          CHART
          ===================================================== */}

      {!hasData ? (

        <div className="flex h-[310px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50">

          <BarChartPlaceholder />

          <p className="mt-3 text-sm font-semibold text-slate-700">
            No sales activity
          </p>

          <p className="mt-1 text-xs text-slate-400">
            Financial trend data will appear here.
          </p>

        </div>

      ) : (

        <div className="relative">

          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            className="h-[320px] w-full overflow-visible"
            onMouseLeave={() =>
              setActiveIndex(
                null
              )
            }
          >

            {/* =================================================
                DEFINITIONS
                ================================================= */}

            <defs>

              <linearGradient
                id={`report-revenue-${gradientId}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor="rgb(37 99 235)"
                  stopOpacity="0.17"
                />

                <stop
                  offset="100%"
                  stopColor="rgb(37 99 235)"
                  stopOpacity="0"
                />

              </linearGradient>

            </defs>

            {/* =================================================
                GRID
                ================================================= */}

            {Array.from({
              length: 5,
            }).map(
              (
                _,
                index
              ) => {
                const ratio =
                  index /
                  4;

                const y =
                  TOP +
                  ratio *
                    chartHeight;

                const value =
                  maxValue *
                  (
                    1 -
                    ratio
                  );

                return (
                  <g
                    key={
                      index
                    }
                  >

                    <line
                      x1={
                        LEFT
                      }
                      x2={
                        WIDTH -
                        RIGHT
                      }
                      y1={y}
                      y2={y}
                      stroke="#e2e8f0"
                      strokeWidth="1"
                      strokeDasharray={
                        index ===
                        4
                          ? undefined
                          : '4 6'
                      }
                    />

                    <text
                      x={
                        LEFT -
                        12
                      }
                      y={
                        y +
                        4
                      }
                      textAnchor="end"
                      fontSize="10"
                      fill="#94a3b8"
                    >
                      {value ===
                      0
                        ? '0'
                        : formatCompact(
                            value
                          )}
                    </text>

                  </g>
                );
              }
            )}

            {/* =================================================
                REVENUE AREA
                ================================================= */}

            <path
              d={
                revenueArea
              }
              fill={`url(#report-revenue-${gradientId})`}
            />

            {/* =================================================
                COGS LINE
                ================================================= */}

            <path
              d={cogsPath}
              fill="none"
              stroke="#94a3b8"
              strokeWidth="2"
              strokeDasharray="6 6"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />

            {/* =================================================
                REVENUE LINE
                ================================================= */}

            <path
              d={
                revenuePath
              }
              fill="none"
              stroke="#2563eb"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />

            {/* =================================================
                PROFIT LINE
                ================================================= */}

            <path
              d={
                profitPath
              }
              fill="none"
              stroke="#10b981"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />

            {/* =================================================
                X LABELS
                ================================================= */}

            {points.map(
              (
                point,
                index
              ) =>
                shouldShowLabel(
                  index,
                  points.length
                ) ? (
                  <text
                    key={`label-${point.date}-${index}`}
                    x={
                      point.x
                    }
                    y={
                      HEIGHT -
                      12
                    }
                    textAnchor="middle"
                    fontSize="10"
                    fill="#64748b"
                  >
                    {
                      point.label
                    }
                  </text>
                ) : null
            )}

            {/* =================================================
                HOVER AREAS
                ================================================= */}

            {points.map(
              (
                point,
                index
              ) => {
                const sectionWidth =
                  chartWidth /
                  Math.max(
                    points.length,
                    1
                  );

                return (
                  <rect
                    key={`hover-${point.date}-${index}`}
                    x={
                      point.x -
                      sectionWidth /
                        2
                    }
                    y={TOP}
                    width={
                      sectionWidth
                    }
                    height={
                      chartHeight
                    }
                    fill="transparent"
                    className="cursor-crosshair"
                    onMouseEnter={() =>
                      setActiveIndex(
                        index
                      )
                    }
                  />
                );
              }
            )}

            {/* =================================================
                ACTIVE CROSSHAIR
                ================================================= */}

            {active && (
              <>

                <line
                  x1={
                    active.x
                  }
                  x2={
                    active.x
                  }
                  y1={TOP}
                  y2={
                    baseY
                  }
                  stroke="#cbd5e1"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />

                <ChartCircle
                  x={
                    active.x
                  }
                  y={
                    active.revenueY
                  }
                  stroke="#2563eb"
                />

                <ChartCircle
                  x={
                    active.x
                  }
                  y={
                    active.profitY
                  }
                  stroke="#10b981"
                />

                <ChartCircle
                  x={
                    active.x
                  }
                  y={
                    active.cogsY
                  }
                  stroke="#94a3b8"
                />

              </>
            )}

          </svg>

          {/* ===================================================
              TOOLTIP
              =================================================== */}

          {active &&
            activeIndex !==
              null && (
              <div
                className="pointer-events-none absolute z-20 min-w-[220px] rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
                style={{
                  left: `${
                    (
                      active.x /
                      WIDTH
                    ) *
                    100
                  }%`,

                  top:
                    '15px',

                  transform:
                    activeIndex >
                    points.length /
                      2
                      ? 'translateX(-105%)'
                      : 'translateX(14px)',
                }}
              >

                <p className="text-sm font-bold text-slate-900">
                  {
                    active.label
                  }
                </p>

                <div className="mt-3 space-y-2.5">

                  <TooltipRow
                    label="Revenue"
                    value={formatCurrency(
                      active.revenue
                    )}
                    dotClassName="bg-brand-500"
                  />

                  <TooltipRow
                    label="COGS"
                    value={formatCurrency(
                      active.cogs
                    )}
                    dotClassName="bg-slate-400"
                  />

                  <TooltipRow
                    label="Gross Profit"
                    value={formatCurrency(
                      active.profit
                    )}
                    dotClassName="bg-success-500"
                    valueClassName="text-success-600"
                  />

                  <div className="border-t border-slate-100 pt-2.5">

                    <div className="flex items-center justify-between gap-6">

                      <span className="text-xs text-slate-500">
                        Margin
                      </span>

                      <span className="text-xs font-bold text-slate-900">
                        {shopMarginPercent(
                          active.profit,
                          active.cogs
                        ).toFixed(1)}
                        %
                      </span>

                    </div>

                  </div>

                </div>

              </div>
            )}

        </div>
      )}

    </div>
  );
}

/* =========================================================
   CHART METRIC
   ========================================================= */

function ChartMetric({
  label,
  value,
  dotClassName,
  valueClassName =
    'text-slate-900',
}: {
  label: string;
  value: string;
  dotClassName: string;
  valueClassName?: string;
}) {
  return (
    <div>

      <div className="flex items-center gap-2">

        <span
          className={`h-2.5 w-2.5 rounded-full ${dotClassName}`}
        />

        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {label}
        </span>

      </div>

      <p
        className={`mt-1.5 text-lg font-bold tabular-nums ${valueClassName}`}
      >
        {value}
      </p>

    </div>
  );
}

/* =========================================================
   TOOLTIP ROW
   ========================================================= */

function TooltipRow({
  label,
  value,
  dotClassName,
  valueClassName =
    'text-slate-900',
}: {
  label: string;
  value: string;
  dotClassName: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6">

      <span className="flex items-center gap-2 text-xs text-slate-500">

        <span
          className={`h-2 w-2 rounded-full ${dotClassName}`}
        />

        {label}

      </span>

      <span
        className={`text-xs font-bold tabular-nums ${valueClassName}`}
      >
        {value}
      </span>

    </div>
  );
}

/* =========================================================
   CHART CIRCLE
   ========================================================= */

function ChartCircle({
  x,
  y,
  stroke,
}: {
  x: number;
  y: number;
  stroke: string;
}) {
  return (
    <circle
      cx={x}
      cy={y}
      r="5"
      fill="white"
      stroke={
        stroke
      }
      strokeWidth="3"
      vectorEffect="non-scaling-stroke"
    />
  );
}

/* =========================================================
   EMPTY ICON
   ========================================================= */

function BarChartPlaceholder() {
  return (
    <svg
      width="38"
      height="38"
      viewBox="0 0 38 38"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-slate-300"
    >
      <path
        d="M5 31V21H11V31H5Z"
        stroke="currentColor"
        strokeWidth="2"
      />

      <path
        d="M16 31V14H22V31H16Z"
        stroke="currentColor"
        strokeWidth="2"
      />

      <path
        d="M27 31V7H33V31H27Z"
        stroke="currentColor"
        strokeWidth="2"
      />

      <path
        d="M4 31H34"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}