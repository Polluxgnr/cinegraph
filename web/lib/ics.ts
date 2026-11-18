/**
 * A trip as a calendar file (.ics, RFC 5545): one all-day event per day with its stops in order and a Google
 * Maps route, so the plan lands in Google Calendar, Apple Calendar or Outlook.
 */
import type { Trip } from "./store";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
/** Lines longer than 75 octets are folded (continuation lines start with a space). */
const fold = (l: string) => (l.length <= 74 ? l : l.match(/.{1,73}/g)!.join("\r\n "));

export function tripToIcs(trip: Trip, now = Date.now()): string {
  const start = trip.start ? Date.parse(trip.start) : now;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CineGraph//Trips//EN", "CALSCALE:GREGORIAN"];
  for (let d = 0; d < trip.days; d++) {
    const stops = trip.spots.filter((s) => s.day === d);
    if (!stops.length && !trip.notes[d]) continue;
    const day = start + d * 864e5;
    const route = stops.length > 1 ? `\nRoute: https://www.google.com/maps/dir/${stops.map((s) => `${s.lat},${s.lon}`).join("/")}` : "";
    const desc = stops.map((s, i) => `${i + 1}. ${s.name}`).join("\n") + route + (trip.notes[d] ? `\n\n${trip.notes[d]}` : "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${trip.id}-day${d + 1}@cinegraph`,
      `DTSTAMP:${new Date(now).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      `DTSTART;VALUE=DATE:${ymd(day)}`,
      `DTEND;VALUE=DATE:${ymd(day + 864e5)}`,
      fold(`SUMMARY:${esc(`${trip.title} · Day ${d + 1}`)}`),
      fold(`DESCRIPTION:${esc(desc)}`),
      ...(stops[0] ? [`GEO:${stops[0].lat};${stops[0].lon}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function downloadIcs(trip: Trip) {
  const blob = new Blob([tripToIcs(trip)], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${trip.title.replace(/[^\w-]+/g, "-")}-trip.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}
