import { type PointerEvent, useState } from "react";
import { duration } from "../duration";
import type { RoundTrip } from "./probe";

const WIDTH = 264;
const HEIGHT = 64; // the plot; the time labels sit below it
const MINUTE = 60_000;
const GAP_MS = 6000; // pings go every 2 s: a longer silence is a break in the line, not a slope
// the accent a step darker: inside the chart lightness band on this surface (dataviz validator)
const LINE = "#8384fb";

// the axis top: the smallest 1, 2 or 5 × 10^k at or above the highest value
function niceTop(ms: number): number {
  if (ms <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(ms));
  return [1, 2, 5, 10].map((step) => step * power).find((top) => top >= ms) ?? 10 * power;
}

// runs of round trips with no long silence between them, each drawn as its own line
function runs(trips: RoundTrip[]): RoundTrip[][] {
  const out: RoundTrip[][] = [];
  for (const [i, trip] of trips.entries()) {
    if (i === 0 || trip.at - trips[i - 1].at > GAP_MS) out.push([]);
    out[out.length - 1].push(trip);
  }
  return out;
}

function summary(trips: RoundTrip[]): string {
  if (trips.length === 0) return "Round trip over the last minute: none measured yet";
  const ms = trips.map((trip) => trip.ms);
  return `Round trip over the last minute: latest ${duration(ms.at(-1) ?? 0)}, lowest ${duration(Math.min(...ms))}, highest ${duration(Math.max(...ms))}`;
}

// the last minute of round trips, newest at the right; hover reads any one, and the table has them all
export function RoundTripChart({ trips, now }: { trips: RoundTrip[]; now: number }) {
  const [picked, setPicked] = useState<number | null>(null); // the chosen round trip's time
  const shown = trips.filter((trip) => trip.at > now - MINUTE);
  const top = niceTop(Math.max(0, ...shown.map((trip) => trip.ms)));
  const x = (at: number) => ((at - (now - MINUTE)) / MINUTE) * WIDTH;
  const y = (ms: number) => HEIGHT - (ms / top) * HEIGHT;
  const point = shown.find((trip) => trip.at === picked);

  function pick(event: PointerEvent<SVGSVGElement>) {
    if (shown.length === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - box.left) / box.width) * WIDTH;
    let nearest = 0;
    for (const [i, trip] of shown.entries()) {
      if (Math.abs(x(trip.at) - at) < Math.abs(x(shown[nearest].at) - at)) nearest = i;
    }
    setPicked(shown[nearest].at);
  }

  return (
    <figure className="border-t border-line px-3 py-3 text-xs">
      <figcaption className="text-muted">Round trip, last minute</figcaption>
      <div className="relative mt-2">
        <svg
          role="img"
          aria-label={summary(shown)}
          viewBox={`0 -8 ${WIDTH} ${HEIGHT + 8}`}
          className="w-full overflow-visible rounded"
          onPointerMove={pick}
          onPointerLeave={() => setPicked(null)}
        >
          {[0, top / 2, top].map((ms) => (
            <line
              key={ms}
              x1={0}
              x2={WIDTH}
              y1={y(ms)}
              y2={y(ms)}
              className="stroke-line"
              strokeWidth={1}
            />
          ))}
          {[top / 2, top].map((ms) => (
            <text key={ms} x={0} y={y(ms) - 3} className="fill-faint text-[9px] tabular-nums">
              {duration(ms)}
            </text>
          ))}
          {runs(shown).map((run) => {
            const line = run.map((trip) => `${x(trip.at)},${y(trip.ms)}`).join(" L");
            const area = `M${x(run[0].at)},${HEIGHT} L${line} L${x(run[run.length - 1].at)},${HEIGHT} Z`;
            return (
              <g key={run[0].at}>
                <path d={area} fill={LINE} fillOpacity={0.1} />
                <path
                  d={`M${line}`}
                  fill="none"
                  stroke={LINE}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            );
          })}
          {point && (
            <line
              x1={x(point.at)}
              x2={x(point.at)}
              y1={0}
              y2={HEIGHT}
              className="stroke-muted"
              strokeWidth={1}
            />
          )}
          {(point ?? shown.at(-1)) && (
            <circle
              cx={x((point ?? shown[shown.length - 1]).at)}
              cy={y((point ?? shown[shown.length - 1]).ms)}
              r={4}
              fill={LINE}
              className="stroke-surface"
              strokeWidth={2}
            />
          )}
        </svg>
        {point && (
          <div
            className="pointer-events-none absolute -top-1 -translate-x-1/2 rounded-md border border-line bg-raised px-2 py-1 text-[11px] whitespace-nowrap shadow-lg shadow-black/40"
            style={{ left: `${Math.min(85, Math.max(15, (x(point.at) / WIDTH) * 100))}%` }}
          >
            <span className="font-semibold">{duration(point.ms)}</span>{" "}
            <span className="text-faint">{Math.round((now - point.at) / 1000)} s ago</span>
          </div>
        )}
        {shown.length === 0 && (
          <p className="absolute inset-0 grid place-items-center text-[11px] text-faint">
            Measuring…
          </p>
        )}
        <div className="mt-1 flex justify-between text-[10px] text-faint">
          <span>1 min ago</span>
          <span>now</span>
        </div>
      </div>
      {shown.length > 0 && (
        <details className="mt-2 text-[11px]">
          <summary className="cursor-pointer text-faint transition hover:text-fg">
            Show as table
          </summary>
          <table className="mt-1 w-full tabular-nums">
            <thead className="text-faint">
              <tr>
                <th className="py-0.5 text-left font-normal">When</th>
                <th className="py-0.5 text-right font-normal">Round trip</th>
              </tr>
            </thead>
            <tbody>
              {[...shown].reverse().map((trip) => (
                <tr key={trip.at}>
                  <td className="py-0.5 text-muted">{Math.round((now - trip.at) / 1000)} s ago</td>
                  <td className="py-0.5 text-right">{duration(trip.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  );
}
