import { useState, type CSSProperties, type KeyboardEvent } from "react";
import styles from "./usage.module.css";

export type DailyPoint = { readonly date: string; readonly value: number };

/** The smallest of 1, 2, 2.5 and 5 times a power of ten that reaches `value`. */
function roundedUp(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return (
    [1, 2, 2.5, 5, 10].map((step) => step * power).find((v) => v >= value) ??
    10 * power
  );
}

/** "Tue 1 Sep": the day, then the month, as the app writes dates. */
function dayName(date: string, days: number) {
  const parts = new Intl.DateTimeFormat("en", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).formatToParts(new Date(`${date}T00:00:00.000Z`));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return [days <= 7 ? part("weekday") : undefined, part("day"), part("month")]
    .filter(Boolean)
    .join(" ");
}

function axisDay(date: string, days: number) {
  return new Intl.DateTimeFormat("en", {
    ...(days <= 7
      ? { weekday: "short" as const }
      : { month: "short" as const, day: "numeric" as const }),
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

/** Plot height in the drawing's own units; the drawing is stretched to fit. */
const plotHeight = 100;

/**
 * One value per day, drawn as a line or as bars over a scale. Each day is a
 * column that says its date and value on hover and keyboard focus; the arrow
 * keys move between days, so the chart is one stop in the tab order.
 */
export function DailyChart({
  name,
  points,
  shape,
  format,
  formatScale = format,
}: {
  /** What the chart's days are, as a list: "Requests by day". */
  name: string;
  points: readonly DailyPoint[];
  shape: "line" | "bars";
  /** A day's value as it is said: "182 requests", "$2.63". */
  format: (value: number) => string;
  formatScale?: (value: number) => string;
}) {
  const [current, setCurrent] = useState(0);
  const top = roundedUp(Math.max(...points.map((point) => point.value), 0));
  const count = points.length;
  const x = (index: number) => ((index + 0.5) / count) * 100;
  const y = (value: number) => plotHeight - (value / top) * plotHeight;
  const line = points
    .map((point, index) => `${index ? "L" : "M"}${x(index)} ${y(point.value)}`)
    .join(" ");
  /** Every day's name fits a week; a month names a day a week, back from today. */
  const named = (index: number) => count <= 7 || (count - 1 - index) % 7 === 0;

  const move = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const next =
      event.key === "ArrowRight"
        ? index + 1
        : event.key === "ArrowLeft"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? count - 1
              : undefined;
    if (next === undefined || next < 0 || next >= count) return;
    event.preventDefault();
    setCurrent(next);
    const days = event.currentTarget.parentElement?.children;
    (days?.[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <div className={styles["daily-chart"]}>
      <div className={styles["daily-chart__scale"]} aria-hidden="true">
        <span>{formatScale(top)}</span>
        <span>{formatScale(top / 2)}</span>
        <span>{formatScale(0)}</span>
      </div>
      <div className={styles["daily-chart__plot"]}>
        <svg
          viewBox={`0 0 100 ${plotHeight}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className={styles["chart-grid"]}
            d={`M0 0H100M0 ${plotHeight / 2}H100M0 ${plotHeight}H100`}
          />
          {shape === "line" && count > 0 && (
            <>
              <path
                className={styles["chart-area"]}
                d={`${line} L${x(count - 1)} ${plotHeight} H${x(0)} Z`}
              />
              <path className={styles["chart-line"]} d={line} />
            </>
          )}
        </svg>
        <ul
          className={styles["daily-chart__days"]}
          aria-label={name}
          style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
        >
          {points.map((point, index) => {
            const said = `${dayName(point.date, count)}: ${format(point.value)}`;
            return (
              <li
                key={point.date}
                aria-label={said}
                data-tip={said}
                tabIndex={index === current ? 0 : -1}
                onFocus={() => setCurrent(index)}
                onKeyDown={(event) => move(event, index)}
                style={{ "--value": point.value / top } as CSSProperties}
              >
                {shape === "bars" ? (
                  <i className={styles["daily-chart__bar"]} />
                ) : (
                  <i className={styles["daily-chart__point"]} />
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div
        className={styles["daily-chart__dates"]}
        aria-hidden="true"
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      >
        {points.map((point, index) => (
          <span key={point.date}>
            {named(index) ? axisDay(point.date, count) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
