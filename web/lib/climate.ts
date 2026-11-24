/**
 * Weather and climate for a place, from Open-Meteo (free, no key, CC BY 4.0): the last two years of daily records
 * folded into a typical year, plus the weather now and the week ahead. Cached per place for the visit.
 */

export interface Month { m: number; hi: number; lo: number; rain: number; wetDays: number; sun: number; score: number }
export interface Climate { tz: string; months: Month[]; best: number[] }
export interface Now { temp: number; code: number; wind: number; days: { date: string; hi: number; lo: number; code: number; rain: number }[] }

const cache = new Map<string, Promise<unknown>>();
const memo = <T,>(k: string, f: () => Promise<T>): Promise<T> => {
  if (!cache.has(k)) cache.set(k, f().catch((e) => { cache.delete(k); throw e; }));
  return cache.get(k) as Promise<T>;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** How pleasant a month is to visit: warm-not-hot days, little rain, sunshine. 0..1 */
export function comfort(m: Pick<Month, "hi" | "rain" | "sun" | "wetDays">): number {
  const t = m.hi < 8 ? 0 : m.hi < 20 ? (m.hi - 8) / 12 : m.hi <= 29 ? 1 : Math.max(0, 1 - (m.hi - 29) / 9);
  const r = Math.max(0, 1 - m.wetDays / 18);
  const s = Math.min(1, m.sun / 9);
  return Math.round((0.55 * t + 0.25 * r + 0.2 * s) * 100) / 100;
}

export function climate(lat: number, lon: number): Promise<Climate> {
  return memo(`c:${lat.toFixed(2)},${lon.toFixed(2)}`, async () => {
    const end = new Date(Date.now() - 7 * 864e5);
    const start = new Date(end.getTime() - 730 * 864e5);
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${iso(start)}&end_date=${iso(end)}`
      + "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration&timezone=auto";
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
    const j = await r.json();
    const d = j.daily as { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[]; sunshine_duration: number[] };
    const acc = Array.from({ length: 12 }, () => ({ hi: 0, lo: 0, rain: 0, wet: 0, sun: 0, n: 0 }));
    d.time.forEach((t, i) => {
      const a = acc[Number(t.slice(5, 7)) - 1];
      if (d.temperature_2m_max[i] == null) return;
      a.hi += d.temperature_2m_max[i];
      a.lo += d.temperature_2m_min[i];
      a.rain += d.precipitation_sum[i] ?? 0;
      a.wet += (d.precipitation_sum[i] ?? 0) >= 1 ? 1 : 0;
      a.sun += (d.sunshine_duration[i] ?? 0) / 3600;
      a.n++;
    });
    const months: Month[] = acc.map((a, m) => {
      const n = Math.max(1, a.n);
      const days = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
      const base = { m, hi: Math.round((a.hi / n) * 10) / 10, lo: Math.round((a.lo / n) * 10) / 10, rain: Math.round((a.rain / n) * days), wetDays: Math.round((a.wet / n) * days), sun: Math.round((a.sun / n) * 10) / 10 };
      return { ...base, score: comfort(base) };
    });
    const top = Math.max(...months.map((m) => m.score));
    const ok = months.map((m) => m.score >= top - 0.08 && m.score > 0.45);
    // a single slightly weaker month between two good ones reads as a season, not a gap
    const best = months.filter((m) => ok[m.m] || (ok[(m.m + 11) % 12] && ok[(m.m + 1) % 12] && m.score >= top - 0.2)).map((m) => m.m);
    return { tz: j.timezone as string, months, best };
  });
}

export function weatherNow(lat: number, lon: number): Promise<Now> {
  return memo(`n:${lat.toFixed(2)},${lon.toFixed(2)}`, async () => {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m`
      + "&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&forecast_days=7&timezone=auto");
    if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
    const j = await r.json();
    return {
      temp: j.current.temperature_2m, code: j.current.weather_code, wind: j.current.wind_speed_10m,
      days: (j.daily.time as string[]).map((date, i) => ({ date, hi: j.daily.temperature_2m_max[i], lo: j.daily.temperature_2m_min[i], code: j.daily.weather_code[i], rain: j.daily.precipitation_probability_max[i] ?? 0 })),
    };
  });
}

/** WMO weather codes -> an icon and a word. */
export function sky(code: number): [string, string] {
  if (code === 0) return ["☀️", "Clear"];
  if (code <= 2) return ["🌤️", "Partly cloudy"];
  if (code === 3) return ["☁️", "Overcast"];
  if (code <= 48) return ["🌫️", "Fog"];
  if (code <= 57) return ["🌦️", "Drizzle"];
  if (code <= 67) return ["🌧️", "Rain"];
  if (code <= 77) return ["🌨️", "Snow"];
  if (code <= 82) return ["🌧️", "Showers"];
  if (code <= 86) return ["🌨️", "Snow showers"];
  return ["⛈️", "Thunderstorm"];
}
