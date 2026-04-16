import { RouteStop } from '../types';

interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Haversine formula — great-circle distance between two lat/lng points in km.
 */
export const haversineDistance = (p1: LatLng, p2: LatLng): number => {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Nearest-neighbour TSP heuristic.
 * Starting from depot (or first stop), always pick the closest unvisited stop next.
 * Returns stops in visit order with recalculated sequence and estimatedMinutes.
 * Assumes average speed of 40 km/h in urban delivery.
 */
export const optimizeRoute = (stops: RouteStop[], depot?: LatLng): RouteStop[] => {
  if (stops.length <= 1) return stops;

  const AVG_SPEED_KMH = 40;
  const unvisited = [...stops];
  const ordered: RouteStop[] = [];

  // Start from depot if provided, else from the first stop's location
  let current: LatLng = depot ?? stops[0].location;

  // If no depot, seed the first stop as the starting point
  if (!depot) {
    const first = unvisited.shift()!;
    ordered.push({ ...first, sequence: 1, estimatedMinutes: 0 });
    current = first.location;
  }

  let cumulativeMinutes = 0;

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const dist = haversineDistance(current, unvisited[i].location);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    const next = unvisited.splice(nearestIdx, 1)[0];
    const travelMinutes = Math.round((nearestDist / AVG_SPEED_KMH) * 60);
    cumulativeMinutes += travelMinutes;

    ordered.push({
      ...next,
      sequence: ordered.length + 1,
      estimatedMinutes: cumulativeMinutes,
    });

    current = next.location;
  }

  return ordered;
};
