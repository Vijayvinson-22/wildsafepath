
import { GoogleGenAI, Type } from "@google/genai";
import type { Sighting, Location, ChatMessage, Route, WeatherData, SafePlace, TravelMode } from '../types';
import { GBIF_LIMIT } from '../constants';
import * as geo from './geoService';

// Declare TensorFlow.js global variable
declare var tf: any;

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

// --- Direct Fetch Helper ---
// Replaces the unreliable public proxy system with direct API calls.
// Includes a retry mechanism with exponential backoff for resilience.
const fetchJson = async (url: string, options: RequestInit = {}, retries = 3, initialDelay = 1000) => {
    let lastError: Error | null = null;
    let delay = initialDelay;

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);

            if (response.ok) {
                const text = await response.text();
                if (!text) return null;
                try {
                    return JSON.parse(text);
                } catch (e) {
                    // Non-retryable parsing error
                    console.error(`Failed to parse JSON response from ${url}. Response text: ${text}`);
                    throw new Error("Received invalid JSON from the server.");
                }
            }

            // For non-OK responses, decide whether to retry
            if (response.status >= 500 && response.status < 600) {
                // Server error, worth retrying
                lastError = new Error(`API Error: Status ${response.status}`);
                console.warn(`API request to ${url} failed with status ${response.status}. Retrying in ${delay / 1000}s...`);
                await new Promise(res => setTimeout(res, delay));
                delay *= 2;
                continue;
            } else {
                // Client error (4xx), not worth retrying
                const errorText = await response.text();
                const truncatedError = errorText.length > 500 ? `${errorText.substring(0, 500)}...` : errorText;
                console.error(`API request to ${url} failed with status ${response.status}. Response: ${truncatedError}`);
                throw new Error(`API Error: Status ${response.status}`);
            }
        } catch (error: any) {
            // Network error
            lastError = error;
            console.warn(`Fetch failed for ${url}: ${error.message}. Retrying in ${delay / 1000}s...`);
            await new Promise(res => setTimeout(res, delay));
            delay *= 2;
        }
    }

    console.error(`All retries failed for ${url}. Last error:`, lastError);
    // Re-throw a generic error to be caught by the UI logic
    throw new Error(`The required data could not be fetched. Please check your network connection.`);
};
// --- End of Fetch Helper ---

const _fetchSafePlaces = async (query: string): Promise<SafePlace[]> => {
    const baseUrl = `https://overpass-api.de/api/interpreter`;
    
    try {
        const data = await fetchJson(baseUrl, {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        if (data && data.elements) {
            return data.elements.map((el: any): SafePlace => {
                const center = el.center || { lat: el.lat, lon: el.lon };
                const tags = el.tags || {};
                const type = tags.amenity === 'police' ? 'police' : 'ranger';
                
                // Construct address string
                const addressParts = [
                    tags['addr:housenumber'],
                    tags['addr:street'],
                    tags['addr:city'],
                    tags['addr:postcode']
                ].filter(Boolean).join(', ');

                return {
                    id: el.id,
                    lat: center.lat,
                    lon: center.lon,
                    type: type,
                    name: tags.name || (type === 'police' ? 'Police Station' : 'Forest Office'),
                    address: addressParts || undefined,
                    hours: tags.opening_hours || undefined,
                    phone: tags.phone || tags['contact:phone'] || undefined,
                };
            }).filter((p: SafePlace) => p.lat && p.lon);
        }
        return [];
    } catch (error) {
        console.error("Failed to find safe places:", error);
        throw error;
    }
};

export const findSafePlacesInArea = async (location: Location, radiusKm: number): Promise<SafePlace[]> => {
    const radiusMeters = radiusKm * 1000;
    const query = `
        [out:json][timeout:25];
        (
          node(around:${radiusMeters},${location.lat},${location.lon})["amenity"="police"];
          way(around:${radiusMeters},${location.lat},${location.lon})["amenity"="police"];
          node(around:${radiusMeters},${location.lat},${location.lon})["office"="forestry"];
          way(around:${radiusMeters},${location.lat},${location.lon})["office"="forestry"];
        );
        out center;
    `;
    try {
        return await _fetchSafePlaces(query);
    } catch (e) {
        console.error("findSafePlacesInArea failed:", e);
        return [];
    }
};


export const findSafePlacesAlongRoute = async (routePath: [number, number][]): Promise<SafePlace[]> => {
    if (routePath.length === 0) return [];

    const buffer = 0.05;
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    routePath.forEach(([lat, lon]) => {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
    });

    const bbox = `${minLat - buffer},${minLon - buffer},${maxLat + buffer},${maxLon + buffer}`;

    const query = `
        [out:json][timeout:25];
        (
          node["amenity"="police"](${bbox});
          way["amenity"="police"](${bbox});
          node["office"="forestry"](${bbox});
          way["office"="forestry"](${bbox});
        );
        out center;
    `;
     try {
        return await _fetchSafePlaces(query);
    } catch (e) {
        console.error("findSafePlacesAlongRoute failed:", e);
        return [];
    }
};


export const getWeatherData = async (lat: number, lon: number): Promise<WeatherData | null> => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    try {
        const data = await fetchJson(url);
        if (data && data.current_weather) {
            return {
                temperature: data.current_weather.temperature,
                weatherCode: data.current_weather.weathercode,
                windSpeed: data.current_weather.windspeed,
                isDay: data.current_weather.is_day
            };
        }
        return null;
    } catch (error) {
        console.error("Failed to fetch weather data:", error);
        return null;
    }
};

export const getRainViewerTimestamps = async (): Promise<any> => {
    const url = 'https://api.rainviewer.com/public/weather-maps.json';
    try {
        return await fetchJson(url);
    } catch (error) {
        console.error("Failed to fetch RainViewer timestamps:", error);
        return null;
    }
};

export const searchLocations = async (query: string): Promise<Location[]> => {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
    try {
        const data = await fetchJson(url);
        if (data && Array.isArray(data)) {
            return data.map((result: any) => ({
                lon: parseFloat(result.lon),
                lat: parseFloat(result.lat),
                name: result.display_name,
            }));
        }
        return [];
    } catch (error: any) {
        console.error("Failed to search locations with Nominatim:", error.message);
        return [];
    }
};

export const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
    try {
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error(`Invalid coordinates provided: lat=${lat}, lon=${lon}`);
        const data = await fetchJson(url);
        if (data && data.display_name) return data.display_name;
        return 'Unknown location';
    } catch (error: any) {
        console.error("Failed to reverse geocode:", error.message);
        throw new Error(error.message || "Failed to reverse geocode.");
    }
};

export const getAnimalSightings = async (scientificName: string, taxonKey: string, location: Location, radiusKm: number): Promise<Sighting[]> => {
    const decimalLatitude = `${location.lat - (radiusKm / 111.32)},${location.lat + (radiusKm / 111.32)}`;
    const decimalLongitude = `${location.lon - (radiusKm / (111.32 * Math.cos(location.lat * Math.PI / 180)))},${location.lon + (radiusKm / (111.32 * Math.cos(location.lat * Math.PI / 180)))}`;
    
    try {
        if (!taxonKey) return [];
        const sightingsUrl = `https://api.gbif.org/v1/occurrence/search?taxon_key=${taxonKey}&decimalLatitude=${decimalLatitude}&decimalLongitude=${decimalLongitude}&limit=${GBIF_LIMIT}&hasCoordinate=true&hasGeospatialIssue=false`;
        
        const sightingsData = await fetchJson(sightingsUrl);

        if (!sightingsData || !sightingsData.results) return [];
        
        const sightings = sightingsData.results.map((occ: any) => ({
            lat: occ.decimalLatitude,
            lon: occ.decimalLongitude,
            image: occ.media?.find((m: any) => m.type === 'StillImage')?.identifier
        }));

        return sightings.filter((s: Sighting) => s.lat && s.lon);
    } catch (error: any) {
        console.error(`Failed to get sightings for ${scientificName}:`, error);
        return [];
    }
};

export const predictAnimalPaths = async (sightingSets: { scientificName: string, sightings: Sighting[] }[]): Promise<{ scientificName: string, predictions: { lat: number, lon: number }[] }[]> => {
    // Check if TensorFlow.js is loaded
    if (typeof tf === 'undefined') {
        console.error("TensorFlow.js is not loaded. Cannot perform local predictions.");
        return [];
    }

    // Process each set of sightings in parallel
    const allPredictions = await Promise.all(sightingSets.map(async (set) => {
        const { scientificName, sightings } = set;
        
        // Need at least one sighting to make a prediction
        if (sightings.length < 1) {
            return { scientificName, predictions: [] };
        }
        
        let pred1: { lat: number, lon: number };
        let pred2: { lat: number, lon: number };
        const lastSighting = sightings[0]; // Sightings are sorted from most recent to oldest

        // Handle case with less than 2 sightings for trajectory calculation
        if (sightings.length < 2) {
            // Fallback: create a small random displacement
            const randomAngle = Math.random() * 2 * Math.PI;
            const randomDist = 0.01; // Approx 1.1km displacement
            pred1 = {
                lat: lastSighting.lat + randomDist * Math.cos(randomAngle),
                lon: lastSighting.lon + randomDist * Math.sin(randomAngle),
            };
            pred2 = {
                lat: pred1.lat + randomDist * Math.cos(randomAngle),
                lon: pred1.lon + randomDist * Math.sin(randomAngle),
            };
        } else {
            // Linear extrapolation using TensorFlow.js
            const coords = sightings.map(s => [s.lat, s.lon]).reverse(); // Oldest to newest
            const tensor = tf.tensor2d(coords);
            
            // Calculate vectors between consecutive points
            const deltas = tensor.slice(1).sub(tensor.slice(0, tensor.shape[0] - 1));
            
            // Calculate the average movement vector
            const avgDelta = tf.mean(deltas, 0);
            
            const lastPointTensor = tf.tensor1d([lastSighting.lat, lastSighting.lon]);
            
            // Predict next two points by adding the average vector
            const pred1Tensor = lastPointTensor.add(avgDelta);
            const pred2Tensor = pred1Tensor.add(avgDelta);

            // Get data from tensors asynchronously
            const pred1Data = await pred1Tensor.data();
            const pred2Data = await pred2Tensor.data();
            
            pred1 = { lat: pred1Data[0], lon: pred1Data[1] };
            pred2 = { lat: pred2Data[0], lon: pred2Data[1] };
            
            // Clean up GPU memory by disposing tensors
            tf.dispose([tensor, deltas, avgDelta, lastPointTensor, pred1Tensor, pred2Tensor]);
        }
        
        return {
            scientificName,
            predictions: [ pred1, pred2 ] // Return predictions without addresses for offline capability
        };
    }));
    
    // Filter out any sets that resulted in no predictions
    return allPredictions.filter(p => p.predictions.length > 0);
};

export const getAIGuideResponse = async (history: ChatMessage[]): Promise<string> => {
    const systemInstruction = "You are a navigation and safety assistant. Given a user’s current location and their destination, your task is to find the safest route. Safety means avoiding unsafe areas such as isolated alleys, highways without pedestrian access, or regions flagged with higher risk. Always prioritize well-lit, populated, and frequently used roads.\n\nAlong the route, also identify and highlight the nearest safe places such as police stations, wildlife checkposts, or forest ranger posts that the user can approach in case of emergency. Provide the route directions, estimated time, and distance, along with markers showing these safe places. If multiple routes are available, rank them by safety first, and travel time second. Finally, explain why the chosen route and safe places are considered safe (e.g., ‘police station within 2 km’, ‘route passes through main road with public presence’)..";
    const contents = history.map(msg => ({ role: msg.role, parts: [{ text: msg.text }] }));
    try {
        const chat = ai.chats.create({ model: 'gemini-2.5-flash', config: { systemInstruction }, history: contents.slice(0, -1) });
        const lastMessage = contents[contents.length-1].parts[0].text;
        const response = await chat.sendMessage({ message: lastMessage });
        return response.text;
    } catch (error) { console.error("Failed to get AI guide response:", error); return "I'm sorry, I'm having trouble connecting right now. Please try again later."; }
};

const _fetchValhallaRoute = async (start: Location, end: Location, avoidPolygons: number[][][], mode: TravelMode): Promise<Route | null> => {
    const url = 'https://valhalla1.openstreetmap.de/route';
    const profile = { car: 'auto', bike: 'bicycle', walk: 'pedestrian', bus: 'bus' }[mode];

    const requestBody: any = {
        locations: [{ lat: start.lat, lon: start.lon }, { lat: end.lat, lon: end.lon }],
        costing: profile,
        directions_options: { units: 'kilometers' }
    };

    if (avoidPolygons.length > 0) {
        // FIX: Valhalla expects an array of polygons, with each polygon being an array of {lat, lon} objects.
        const valhallaPolygons = avoidPolygons.map(poly => 
            poly.map(([lon, lat]) => ({ lat, lon }))
        );
        requestBody.costing_options = { [profile as string]: { avoid_polygons: valhallaPolygons } };
    }

    const data = await fetchJson(url, { method: 'POST', body: JSON.stringify(requestBody), headers: { 'Content-Type': 'application/json' } });

    if (data && data.trip && data.trip.legs && data.trip.legs[0].summary) {
        const { summary, shape } = data.trip.legs[0];
        const path = geo.decodePolyline(shape, 6);
        
        return {
            path,
            distanceKm: parseFloat(summary.length.toFixed(1)),
            durationMinutes: Math.round(summary.time / 60),
            start, end, mode
        };
    }
    return null;
};

const isRouteReasonable = (route: Route, start: Location, end: Location): boolean => {
    const straightLineDistance = geo.calculateDistance(start, end);

    const maxReasonableDistance = straightLineDistance * 7;
    if (route.distanceKm > maxReasonableDistance) {
        console.warn(`Route rejected: Distance (${route.distanceKm}km) is >7x straight-line distance (${straightLineDistance.toFixed(1)}km).`);
        return false;
    }

    if (route.durationMinutes > 0) {
        const avgSpeedKmh = route.distanceKm / (route.durationMinutes / 60);
        const minSpeed = { car: 10, bus: 10, bike: 8, walk: 2 }[route.mode];
        const maxSpeed = { car: 120, bus: 100, bike: 35, walk: 8 }[route.mode];

        if (avgSpeedKmh < minSpeed || avgSpeedKmh > maxSpeed) {
            console.warn(`Route rejected: Avg speed (${avgSpeedKmh.toFixed(1)}km/h) is outside plausible range [${minSpeed}-${maxSpeed}] for mode '${route.mode}'.`);
            return false;
        }
    }
    
    return true;
};

export const getSafeNavigationRoute = async (start: Location, end: Location, avoidPolygons: number[][][], mode: TravelMode): Promise<Route | null> => {
    try {
        // Valhalla is now the primary and only routing service.
        const valhallaRoute = await _fetchValhallaRoute(start, end, avoidPolygons, mode);
        
        if (valhallaRoute && isRouteReasonable(valhallaRoute, start, end)) {
            return valhallaRoute;
        }

        // If route is unreasonable, return null to let the caller decide how to proceed.
        if (valhallaRoute) {
            console.warn('Valhalla returned an unreasonable route. Discarding.');
        }
        
        return null;
        
    } catch (error: any) {
        // This will catch network errors from fetchJson, or if Valhalla returns a non-200 status.
        console.error(`Valhalla routing request failed: ${error.message}`);
        throw error; // Re-throw to be handled by the calling function in useAnimalData.
    }
};
