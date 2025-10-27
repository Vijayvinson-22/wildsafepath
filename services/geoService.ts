import type { Location, SafePlace } from '../types';

export const calculateDistance = (loc1: Location | {lat: number, lon: number}, loc2: Location | {lat: number, lon: number}): number => {
    const R = 6371; // Radius of the Earth in km
    const dLat = (loc2.lat - loc1.lat) * Math.PI / 180;
    const dLon = (loc2.lon - loc1.lon) * Math.PI / 180;
    const a =
        0.5 - Math.cos(dLat) / 2 +
        Math.cos(loc1.lat * Math.PI / 180) * Math.cos(loc2.lat * Math.PI / 180) *
        (1 - Math.cos(dLon)) / 2;
    return R * 2 * Math.asin(Math.sqrt(a));
};

export const getMidpoint = (loc1: Location, loc2: Location): Location => {
    const dLon = (loc2.lon - loc1.lon) * Math.PI / 180;
    const lat1 = loc1.lat * Math.PI / 180;
    const lat2 = loc2.lat * Math.PI / 180;
    const lon1 = loc1.lon * Math.PI / 180;

    const Bx = Math.cos(lat2) * Math.cos(dLon);
    const By = Math.cos(lat2) * Math.sin(dLon);

    const lat3 = Math.atan2(Math.sin(lat1) + Math.sin(lat2), Math.sqrt((Math.cos(lat1) + Bx) * (Math.cos(lat1) + Bx) + By * By));
    const lon3 = lon1 + Math.atan2(By, Math.cos(lat1) + Bx);

    return {
        lat: lat3 * 180 / Math.PI,
        lon: lon3 * 180 / Math.PI,
        name: 'Route Midpoint'
    };
};

// --- Cardinal Spline Generation for Realistic Paths ---
// This function generates a smooth curve that passes through all the given points.
function getSplinePoint(t: number, p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], tension: number): [number, number] {
    const t2 = t * t;
    const t3 = t2 * t;

    const b1 = -tension * t3 + 2 * tension * t2 - tension * t;
    const b2 = (2 - tension) * t3 + (tension - 3) * t2 + 1;
    const b3 = (tension - 2) * t3 + (3 - 2 * tension) * t2 + tension * t;
    const b4 = tension * t3 - tension * t2;

    const x = p0[0] * b1 + p1[0] * b2 + p2[0] * b3 + p3[0] * b4;
    const y = p0[1] * b1 + p1[1] * b2 + p2[1] * b3 + p3[1] * b4;

    return [x, y];
}

export const createSplinePath = (waypoints: [number, number][], substeps: number = 20, tension: number = 0.5): [number, number][] => {
    if (waypoints.length < 2) return waypoints;

    const path: [number, number][] = [];
    const points = [...waypoints];
    // Add "phantom" points at the start and end to ensure the curve goes through the first and last actual waypoints.
    points.unshift(points[0]);
    points.push(points[points.length - 1]);

    for (let i = 1; i < points.length - 2; i++) {
        for (let t = 0; t <= substeps; t++) {
            path.push(getSplinePoint(t / substeps, points[i - 1], points[i], points[i + 1], points[i + 2], tension));
        }
    }
    
    // Ensure the last point is exactly the last waypoint
    if (path.length > 0) {
        path.push(waypoints[waypoints.length - 1]);
    }

    return path;
};

/**
 * Creates a circular polygon around a center point.
 * Used for creating avoidance zones for the routing API.
 * @param center - The center of the circle as [lat, lon].
 * @param radiusKm - The radius of the circle in kilometers.
 * @param points - The number of points to generate for the polygon (default 32).
 * @returns An array of [lon, lat] coordinates representing the polygon.
 */
export const createCirclePolygon = (center: [number, number], radiusKm: number, points: number = 32): number[][] => {
    const coords: number[][] = [];
    const distance = radiusKm / 6371; // Earth's radius in km, to get angular distance
    const lat1 = center[0] * Math.PI / 180;
    const lon1 = center[1] * Math.PI / 180;

    for (let i = 0; i < points; i++) {
        const bearing = 2 * Math.PI * i / points;
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distance) + Math.cos(lat1) * Math.sin(distance) * Math.cos(bearing));
        const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat1), Math.cos(distance) - Math.sin(lat1) * Math.sin(lat2));
        
        // ORS expects [lon, lat]
        coords.push([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
    }
    coords.push(coords[0]); // Close the polygon loop
    return coords;
};

/**
 * Calculates the total distance of a polyline path.
 * @param path An array of [lat, lon] coordinates.
 * @returns The total distance in kilometers.
 */
export const calculatePolylineDistance = (path: [number, number][]): number => {
    let totalDistance = 0;
    for (let i = 0; i < path.length - 1; i++) {
        const point1 = { lat: path[i][0], lon: path[i][1] };
        const point2 = { lat: path[i+1][0], lon: path[i+1][1] };
        totalDistance += calculateDistance(point1, point2);
    }
    return totalDistance;
};

/**
 * Finds the remaining part of a route and calculates the distance from the user to the path.
 * @param userLocation The user's current location.
 * @param routePath The full path of the route.
 * @param searchStartIndex The index from which to start searching for the closest point.
 * @returns An object with the remaining path, the user's distance to the path in km, and the index of the closest point on the path.
 */
// FIX: Loosened the type to accept any object with lat/lon, not just the full Location type, to fix compatibility with PredictionPoint.
export const getPathDataFromLocation = (userLocation: { lat: number; lon: number; }, routePath: [number, number][], searchStartIndex: number = 0): { remainingPath: [number, number][]; distanceToPathKm: number; closestPointIndex: number } => {
    if (routePath.length < 2) return { remainingPath: [], distanceToPathKm: Infinity, closestPointIndex: 0 };

    let closestPointIndex = searchStartIndex;
    let minDistance = Infinity;
    let increasingCount = 0;
    const INCREASING_THRESHOLD = 30; // Stop after distance increases for this many consecutive points.

    // Search forward from last known point, with a small buffer backwards in case user deviates.
    const searchFrom = Math.max(0, searchStartIndex - 20);

    for (let i = searchFrom; i < routePath.length; i++) {
        const pathPoint = { lat: routePath[i][0], lon: routePath[i][1] };
        const distance = calculateDistance(userLocation, pathPoint);

        if (distance < minDistance) {
            minDistance = distance;
            closestPointIndex = i;
            increasingCount = 0; // Reset counter when we find a new closer point.
        } else {
            increasingCount++;
        }

        // If the distance has been consistently increasing, we've likely passed the 'local' closest point on the path.
        // This heuristic prevents the algorithm from jumping to a geographically close but logically distant part of a winding route.
        if (increasingCount > INCREASING_THRESHOLD) {
            break;
        }
    }

    // Return the path from the closest point to the end.
    // Prepending the user's actual location makes the visual polyline snap to them.
    const remainingSegment = routePath.slice(closestPointIndex);
    const finalRemainingPath: [number, number][] = [[userLocation.lat, userLocation.lon], ...remainingSegment];
    
    return {
        remainingPath: finalRemainingPath,
        distanceToPathKm: minDistance,
        closestPointIndex: closestPointIndex
    };
};

export const findClosestSafePlace = (userLocation: Location, places: SafePlace[]): SafePlace | null => {
    if (places.length === 0) return null;

    let closestPlace: SafePlace | null = null;
    let minDistance = Infinity;

    places.forEach(place => {
        const distance = calculateDistance(userLocation, place);
        if (distance < minDistance) {
            minDistance = distance;
            closestPlace = place;
        }
    });
    return closestPlace;
};

/**
 * Decodes an encoded polyline string into an array of [lat, lon] coordinates.
 * This is used for the Valhalla routing service fallback.
 * @param encoded The encoded polyline string.
 * @param precision The precision of the encoded string (6 for Valhalla).
 * @returns An array of [lat, lon] coordinates.
 */
export const decodePolyline = (encoded: string, precision: number = 6): [number, number][] => {
    const points: [number, number][] = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;
    const factor = Math.pow(10, precision);

    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;

        points.push([lat / factor, lng / factor]);
    }
    return points;
};