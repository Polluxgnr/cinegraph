"use client";
/** Trips: one per destination, planned day by day (synced with the rest of a profile's memory). */
import { getState, type Trip, type TripSpot, update } from "./store";

/** The trip being planned for a place (one per place), created on demand. */
export function tripFor(place: { key: string; title: string; image?: string }, create = false): Trip | undefined {
  const t = getState().trips.find((x) => x.place === place.key);
  if (t || !create) return t;
  const trip: Trip = { id: crypto.randomUUID().slice(0, 8), place: place.key, title: place.title, image: place.image, days: 3, spots: [], notes: {}, created: Date.now(), updated: Date.now() };
  update((s) => {
    s.trips.push(trip);
  });
  return trip;
}

export function updateTrip(id: string, fn: (t: Trip) => void) {
  update((s) => {
    const t = s.trips.find((x) => x.id === id);
    if (!t) return;
    fn(t);
    t.updated = Date.now();
  });
}

export function toggleTripSpot(place: { key: string; title: string; image?: string }, spot: Omit<TripSpot, "day">) {
  const trip = tripFor(place, true)!;
  updateTrip(trip.id, (t) => {
    const i = t.spots.findIndex((x) => x.q === spot.q);
    if (i >= 0) t.spots.splice(i, 1);
    else t.spots.push({ ...spot, day: null });
  });
}

export function deleteTrip(id: string) {
  update((s) => {
    s.trips = s.trips.filter((t) => t.id !== id);
    s.deleted[`trip:${id}`] = Date.now();
  });
}
