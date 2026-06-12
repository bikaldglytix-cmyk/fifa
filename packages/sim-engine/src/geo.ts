/**
 * Venue geography & climatology — static reference data for the 16 official
 * FIFA World Cup 2026 venues. Coordinates and altitudes are published venue
 * facts; temperature/humidity are June–July climatological averages for the
 * host city (labelled as climatology everywhere — never presented as a live
 * forecast).
 */

export interface VenueGeo {
  lat: number;
  lon: number;
  altitudeM: number;
  /** average daily high, June–July (°C) */
  avgHighC: number;
  /** average afternoon relative humidity, June–July (%) */
  avgHumidityPct: number;
  /** UTC offset in hours during the tournament (June–July, DST where used) */
  tzOffsetHours: number;
}

export const VENUE_GEO: Record<string, VenueGeo> = {
  'estadio-azteca':          { lat: 19.3029, lon: -99.1505,  altitudeM: 2240, avgHighC: 26, avgHumidityPct: 57, tzOffsetHours: -6 },
  'estadio-akron':           { lat: 20.6817, lon: -103.4625, altitudeM: 1560, avgHighC: 31, avgHumidityPct: 48, tzOffsetHours: -6 },
  'estadio-bbva':            { lat: 25.6692, lon: -100.2447, altitudeM: 520,  avgHighC: 35, avgHumidityPct: 52, tzOffsetHours: -6 },
  'bmo-field':               { lat: 43.6332, lon: -79.4186,  altitudeM: 76,   avgHighC: 25, avgHumidityPct: 62, tzOffsetHours: -4 },
  'bc-place':                { lat: 49.2768, lon: -123.1120, altitudeM: 9,    avgHighC: 21, avgHumidityPct: 68, tzOffsetHours: -7 },
  'metlife-stadium':         { lat: 40.8135, lon: -74.0745,  altitudeM: 3,    avgHighC: 28, avgHumidityPct: 62, tzOffsetHours: -4 },
  'sofi-stadium':            { lat: 33.9535, lon: -118.3392, altitudeM: 30,   avgHighC: 25, avgHumidityPct: 66, tzOffsetHours: -7 },
  'att-stadium':             { lat: 32.7473, lon: -97.0945,  altitudeM: 168,  avgHighC: 34, avgHumidityPct: 58, tzOffsetHours: -5 },
  'nrg-stadium':             { lat: 29.6847, lon: -95.4107,  altitudeM: 15,   avgHighC: 33, avgHumidityPct: 72, tzOffsetHours: -5 },
  'mercedesbenz-stadium':    { lat: 33.7554, lon: -84.4010,  altitudeM: 225,  avgHighC: 31, avgHumidityPct: 65, tzOffsetHours: -4 },
  'hard-rock-stadium':       { lat: 25.9580, lon: -80.2389,  altitudeM: 3,    avgHighC: 32, avgHumidityPct: 72, tzOffsetHours: -4 },
  'lincoln-financial-field': { lat: 39.9008, lon: -75.1675,  altitudeM: 12,   avgHighC: 29, avgHumidityPct: 60, tzOffsetHours: -4 },
  'levis-stadium':           { lat: 37.4030, lon: -121.9700, altitudeM: 3,    avgHighC: 27, avgHumidityPct: 55, tzOffsetHours: -7 },
  'lumen-field':             { lat: 47.5952, lon: -122.3316, altitudeM: 5,    avgHighC: 22, avgHumidityPct: 60, tzOffsetHours: -7 },
  'arrowhead-stadium':       { lat: 39.0489, lon: -94.4839,  altitudeM: 265,  avgHighC: 31, avgHumidityPct: 62, tzOffsetHours: -5 },
  'gillette-stadium':        { lat: 42.0909, lon: -71.2643,  altitudeM: 89,   avgHighC: 26, avgHumidityPct: 62, tzOffsetHours: -4 },
};

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two venues, km. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

export function venueDistanceKm(venueA: string, venueB: string): number {
  const a = VENUE_GEO[venueA];
  const b = VENUE_GEO[venueB];
  if (!a || !b) return 0;
  return haversineKm(a, b);
}

export function venueTzShift(venueA: string, venueB: string): number {
  const a = VENUE_GEO[venueA];
  const b = VENUE_GEO[venueB];
  if (!a || !b) return 0;
  return Math.abs(a.tzOffsetHours - b.tzOffsetHours);
}
