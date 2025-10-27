import { useState, useCallback, useRef, useEffect } from 'react';
import type { Location, AnimalPrediction, Sighting, Route, NavigationStats, NavigationAlert, WeatherData, SafePlace, TravelMode } from '../types';
import { AppState } from '../types';
import * as api from '../services/apiService';
import * as geo from '../services/geoService';
import { ANIMALS, RADIUS_KM, SEQ_LEN, SMOOTH_STEPS, NEARBY_KM } from '../constants';

const useLocalStorage = <T,>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] => {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error) {
            console.error(error);
            return initialValue;
        }
    });

    const setValue = (value: T | ((val: T) => T)) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
            console.error(error);
        }
    };
    return [storedValue, setValue];
};

// --- Notification Helpers ---
const audioContext = typeof window !== 'undefined' ? new (window.AudioContext || (window as any).webkitAudioContext)() : null;

const playAlertSound = () => {
    if (!audioContext) return;
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    try {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
    } catch (e) {
        console.error("Error playing alert sound:", e);
    }
};

const showBrowserNotification = (title: string, body: string, icon?: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon });
    }
};
// --- End Notification Helpers ---


const WEATHER_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Helper to determine if weather is severe based on WMO code
const isWeatherSevere = (code: number): boolean => {
    const severeCodes = [63, 65, 66, 67, 73, 75, 77, 81, 82, 85, 86, 95, 96, 99];
    return severeCodes.includes(code);
};

// Helper to get user-friendly text for a weather alert
const getWeatherAlertText = (code: number): string => {
    if ([63, 65, 81, 82].includes(code)) return "Warning: Heavy rain detected on your route. Drive carefully.";
    if ([73, 75, 85, 86, 77].includes(code)) return "Warning: Heavy snow detected. Conditions may be hazardous.";
    if ([66, 67].includes(code)) return "Warning: Freezing rain detected. Roads may be icy.";
    if ([95, 96, 99].includes(code)) return "Warning: Thunderstorms nearby. Consider seeking shelter if possible.";
    return "Warning: Severe weather conditions detected ahead.";
};

export const useAnimalData = () => {
    const [initialError, setInitialError] = useState('');
    const [predictionStatus, setPredictionStatus] = useState<AppState>(AppState.IDLE);
    const [predictionMessage, setPredictionMessage] = useState('');
    const [userLocation, setUserLocation] = useState<Location | null>(null);
    const [predictions, setPredictions] = useState<AnimalPrediction[]>([]);
    const [searchHistory, setSearchHistory] = useLocalStorage<string[]>('searchHistory', []);
    const [suggestions, setSuggestions] = useState<Location[]>([]);
    const [isSuggesting, setIsSuggesting] = useState(false);
    const debounceTimeout = useRef<number | null>(null);
    const [safeRoute, setSafeRoute] = useState<Route | null>(null);
    const [alternativeRoute, setAlternativeRoute] = useState<Route | null>(null);
    const [safePlaces, setSafePlaces] = useState<SafePlace[]>([]);
    const [routeStatus, setRouteStatus] = useState<AppState>(AppState.IDLE);
    const [routeMessage, setRouteMessage] = useState('');
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const isPredictingRef = useRef(false);
    const [manualSightings, setManualSightings] = useLocalStorage<any[]>('animalSightings', []);
    const [otherModesInfo, setOtherModesInfo] = useState<Partial<Record<TravelMode, { distanceKm: number, durationMinutes: number }>>>({});


    // --- State for Live Navigation ---
    const [isNavigating, setIsNavigating] = useState(false);
    const [liveLocation, setLiveLocation] = useState<Location | null>(null);
    const [navigationStats, setNavigationStats] = useState<NavigationStats | null>(null);
    const [navigationAlert, setNavigationAlert] = useState<NavigationAlert | null>(null);
    const [weatherAlert, setWeatherAlert] = useState<string | null>(null);
    const [animalsNearRoute, setAnimalsNearRoute] = useState<AnimalPrediction[]>([]);
    const [closestPathIndex, setClosestPathIndex] = useState(0);
    const [isApproachingStart, setIsApproachingStart] = useState(false);
    const [emergencyRoute, setEmergencyRoute] = useState<Route | null>(null);
    const [alternativeEmergencyRoute, setAlternativeEmergencyRoute] = useState<Route | null>(null);
    const isApproachingStartRef = useRef(false);
    const watchIdRef = useRef<number | null>(null);
    const lastWeatherCheckTimestampRef = useRef<number>(0);
    const closestPathIndexRef = useRef(0);
    const navigationAlertRef = useRef(navigationAlert);
    useEffect(() => { navigationAlertRef.current = navigationAlert; }, [navigationAlert]);
    const weatherAlertRef = useRef(weatherAlert);
    useEffect(() => { weatherAlertRef.current = weatherAlert; }, [weatherAlert]);
    const initialRouteSnapshotRef = useRef<{ start: Location; end: Location; mode: TravelMode, distanceKm: number, durationMinutes: number } | null>(null);
    const liveLocationRef = useRef(liveLocation);
    useEffect(() => { liveLocationRef.current = liveLocation; }, [liveLocation]);
    const safeRouteRef = useRef(safeRoute);
    useEffect(() => { safeRouteRef.current = safeRoute; }, [safeRoute]);
    const emergencyRouteRef = useRef(emergencyRoute);
    useEffect(() => { emergencyRouteRef.current = emergencyRoute; }, [emergencyRoute]);
    const alternativeEmergencyRouteRef = useRef(alternativeEmergencyRoute);
    useEffect(() => { alternativeEmergencyRouteRef.current = alternativeEmergencyRoute; }, [alternativeEmergencyRoute]);
    const animalsNearRouteRef = useRef(animalsNearRoute);
    useEffect(() => { animalsNearRouteRef.current = animalsNearRoute; }, [animalsNearRoute]);
    const shownAnimalAlertsRef = useRef<Set<string>>(new Set());


    const addAnimalSighting = useCallback(async (commonName: string, lat: number, lon: number) => {
        try {
            const address = await api.reverseGeocode(lat, lon);
            const newSighting = {
                commonName,
                address,
                lat, 
                lon,
                timestamp: new Date().toISOString(),
            };
            setManualSightings(prev => [newSighting, ...prev].slice(0, 50)); // Limit to 50 manual sightings
        } catch (error) {
            console.error("Failed to add manual sighting:", error);
        }
    }, [setManualSightings]);

    const getPredictionsForArea = useCallback(async (location: Location, radius: number = RADIUS_KM, nearbyRadius: number = NEARBY_KM): Promise<AnimalPrediction[]> => {
        if (isPredictingRef.current) {
            console.warn("Prediction already in progress. Skipping.");
            return [];
        }
        isPredictingRef.current = true;
        setPredictionStatus(AppState.LOADING);
        setPredictionMessage('Analyzing wildlife activity...');

        try {
            const animalSightingsPromises = Object.entries(ANIMALS).map(([scientificName, info]) =>
                api.getAnimalSightings(scientificName, info.taxonKey, location, radius).then(sightings => ({
                    scientificName,
                    sightings: sightings.slice(0, SEQ_LEN)
                }))
            );

            const sightingSets = (await Promise.all(animalSightingsPromises))
                .filter(set => set.sightings.length > 0);
            
            const commonToScientific: Record<string, string> = {};
            Object.entries(ANIMALS).forEach(([sciName, info]) => { commonToScientific[info.common] = sciName; });
            const relevantManualSightings = manualSightings.filter(s => geo.calculateDistance(location, s) <= radius);
            const manualSightingSets: { [key: string]: Sighting[] } = {};
            relevantManualSightings.forEach(s => {
                const sciName = commonToScientific[s.commonName];
                if (sciName) {
                    if (!manualSightingSets[sciName]) manualSightingSets[sciName] = [];
                    manualSightingSets[sciName].push({ lat: s.lat, lon: s.lon });
                }
            });
            sightingSets.forEach(set => {
                if (manualSightingSets[set.scientificName]) {
                    set.sightings = [...manualSightingSets[set.scientificName], ...set.sightings];
                    delete manualSightingSets[set.scientificName]; 
                }
            });
            for (const sciName in manualSightingSets) {
                sightingSets.push({ scientificName: sciName, sightings: manualSightingSets[sciName] });
            }
            sightingSets.forEach(set => { set.sightings = set.sightings.slice(0, SEQ_LEN); });

            if (sightingSets.length === 0) {
                setPredictionStatus(AppState.SUCCESS);
                setPredictionMessage(`No recent wildlife sightings within ${radius} km.`);
                setPredictions([]);
                 // Still check for safe places even if no animals are sighted
                const places = await api.findSafePlacesInArea(location, radius);
                setSafePlaces(places);
                return [];
            }

            setPredictionMessage(`Found sightings for ${sightingSets.length} species. Predicting paths...`);

            const pathPredictions = await api.predictAnimalPaths(sightingSets);

            const detailedPredictionsPromises = pathPredictions.map(async (predGroup) => {
                const { scientificName, predictions: pathPoints } = predGroup;
                const sightingSet = sightingSets.find(s => s.scientificName === scientificName);
                if (!sightingSet || sightingSet.sightings.length === 0 || pathPoints.length === 0) return null;

                const animalInfo = ANIMALS[scientificName];
                const currentSighting = sightingSet.sightings[0];
                const currentPoint = { lat: currentSighting.lat, lon: currentSighting.lon };
                const distance = geo.calculateDistance(location, currentPoint);
                const currentAddr = await api.reverseGeocode(currentPoint.lat, currentPoint.lon);

                const predictionsWithAddresses = await Promise.all(
                    pathPoints.map(async (p) => {
                        try {
                            const address = await api.reverseGeocode(p.lat, p.lon);
                            return { ...p, addr: address };
                        } catch (error) {
                            console.warn(`Failed to geocode prediction point:`, p, error);
                            // Fallback to coordinates if geocoding fails
                            return { ...p, addr: `Lat: ${p.lat.toFixed(4)}, Lon: ${p.lon.toFixed(4)}` };
                        }
                    })
                );

                const waypoints: [number, number][] = [
                    [currentPoint.lat, currentPoint.lon],
                    ...pathPoints.map(p => [p.lat, p.lon] as [number, number])
                ];

                const fullPath = geo.createSplinePath(waypoints, SMOOTH_STEPS);
                
                return {
                    id: `${scientificName}-${Date.now()}`,
                    scientific: scientificName,
                    common: animalInfo.common,
                    emoji: animalInfo.emoji,
                    color: animalInfo.color,
                    riskLevel: animalInfo.riskLevel,
                    image: currentSighting.image,
                    current: { ...currentPoint, addr: currentAddr, dist_km: parseFloat(distance.toFixed(1)) },
                    preds: predictionsWithAddresses,
                    fullPath
                };
            });

            const newPredictions = (await Promise.all(detailedPredictionsPromises)).filter(Boolean) as AnimalPrediction[];
            
            setPredictionMessage(`Finding safe places within ${radius} km...`);
            const places = await api.findSafePlacesInArea(location, radius);
            setSafePlaces(places);

            setPredictions(newPredictions);
            setPredictionStatus(AppState.SUCCESS);
            setPredictionMessage(`Found ${newPredictions.length} potential wildlife paths.`);
            return newPredictions;
        } catch (error) {
            console.error("Prediction process failed:", error);
            setPredictionStatus(AppState.ERROR);
            setPredictionMessage("Could not predict animal paths due to an API or network error.");
            setPredictions([]);
            throw error;
        } finally {
            isPredictingRef.current = false;
        }
    }, [manualSightings]);

    const processLocationSearch = useCallback(async (location: Location | string) => {
        setSafeRoute(null);
        setAlternativeRoute(null);
        setSafePlaces([]);
        setSuggestions([]);
        setAnimalsNearRoute([]);

        let finalLocation: Location;
        if (typeof location === 'string') {
            const results = await api.searchLocations(location);
            if (results.length === 0) {
                // TODO: Maybe show an error on the map view?
                console.error(`Could not find location: "${location}".`);
                return;
            }
            finalLocation = results[0];
        } else {
            finalLocation = location;
        }
        
        setUserLocation(finalLocation);

        if (typeof location === 'string' && !searchHistory.includes(location)) {
            setSearchHistory(prev => [location, ...prev.slice(0, 4)]);
        }
        
        const weatherData = await api.getWeatherData(finalLocation.lat, finalLocation.lon);
        setWeather(weatherData);

        await getPredictionsForArea(finalLocation, RADIUS_KM, NEARBY_KM);
    }, [searchHistory, setSearchHistory, getPredictionsForArea]);

    const calculateSafeRoute = useCallback(async (start: Location | string, end: Location | string, radius: number, mode: TravelMode, excludedAnimalIds: string[] = []) => {
        setRouteStatus(AppState.LOADING);
        setRouteMessage('Calculating safest route...');
        setAlternativeRoute(null);
        setOtherModesInfo({});
        
        try {
            let startLoc: Location, endLoc: Location;

            if (typeof start === 'string') {
                const results = await api.searchLocations(start);
                if (results.length === 0) throw new Error(`Could not find start location: "${start}"`);
                startLoc = results[0];
            } else {
                startLoc = { lat: start.lat, lon: start.lon, name: start.name || 'Current Location' };
            }
            if (typeof end === 'string') {
                const results = await api.searchLocations(end);
                if (results.length === 0) throw new Error(`Could not find destination: "${end}"`);
                endLoc = results[0];
            } else {
                endLoc = end;
            }
    
            const searchCenter = geo.getMidpoint(startLoc, endLoc);
            const routeDistance = geo.calculateDistance(startLoc, endLoc);
            const searchRadius = Math.max(RADIUS_KM, routeDistance / 2 * 1.25);

            setRouteMessage('Analyzing wildlife activity...');
            const relevantPredictions = await getPredictionsForArea(searchCenter, searchRadius);
            
            setRouteMessage('Finding direct route...');
            const directRoute = await api.getSafeNavigationRoute(startLoc, endLoc, [], mode);
            if (!directRoute) {
                throw new Error('Could not find a direct route. The area may be inaccessible.');
            }

            const avoidancePolygons = relevantPredictions
                .filter(p => !excludedAnimalIds.includes(p.id))
                .map(p => geo.createCirclePolygon([p.current.lat, p.current.lon], radius / 10));

            let finalRoute: Route;
            let alternative: Route | null = null;

            if (avoidancePolygons.length > 0) {
                setRouteMessage('Calculating safer alternatives...');
                const safeAlternative = await api.getSafeNavigationRoute(startLoc, endLoc, avoidancePolygons, mode);
                
                const DURATION_MULTIPLIER_THRESHOLD = 2.5;
                const DURATION_ABSOLUTE_THRESHOLD_MINS = 120; // 2 hours

                if (safeAlternative && 
                    safeAlternative.durationMinutes < directRoute.durationMinutes * DURATION_MULTIPLIER_THRESHOLD &&
                    safeAlternative.durationMinutes < directRoute.durationMinutes + DURATION_ABSOLUTE_THRESHOLD_MINS
                ) {
                    finalRoute = safeAlternative;
                    alternative = { ...directRoute, isHighRisk: true };
                    const durationDiff = safeAlternative.durationMinutes - directRoute.durationMinutes;
                    setRouteMessage(`Safer route found! Adds ${durationDiff > 0 ? durationDiff : 'no extra'} min to avoid wildlife.`);
                } else {
                    finalRoute = { ...directRoute, isHighRisk: true };
                    alternative = safeAlternative; // Can be null or the unreasonable one
                    setRouteMessage('Warning: Direct route passes through high-risk areas. A safer alternative may be shown.');
                }
            } else {
                finalRoute = directRoute;
                setRouteMessage('Route checked. No immediate wildlife risks found.');
            }

            setSafeRoute(finalRoute);
            setAlternativeRoute(alternative);
            
            const places = await api.findSafePlacesAlongRoute(finalRoute.path);
            setSafePlaces(places);

            const nearbyAnimals = relevantPredictions.map(p => {
                const { distanceToPathKm } = geo.getPathDataFromLocation(p.current, finalRoute.path);
                return { ...p, distanceToPathKm };
            }).filter(p => p.distanceToPathKm < radius);
            setAnimalsNearRoute(nearbyAnimals);

            setRouteStatus(AppState.SUCCESS);

            // Fetch other travel modes for the final chosen route (without avoidance for speed)
            const allTravelModes: TravelMode[] = ['car', 'walk', 'bike', 'bus'];
            const otherModes = allTravelModes.filter(m => m !== mode);
            otherModes.forEach(async (otherMode) => {
                try {
                    const otherRoute = await api.getSafeNavigationRoute(startLoc, endLoc, [], otherMode);
                    if (otherRoute) {
                        setOtherModesInfo(prev => ({
                            ...prev,
                            [otherMode]: {
                                distanceKm: otherRoute.distanceKm,
                                durationMinutes: otherRoute.durationMinutes,
                            }
                        }));
                    }
                } catch (e) {
                    console.warn(`Could not calculate route for ${otherMode}:`, e);
                }
            });

            return finalRoute;

        } catch (error: any) {
            setRouteStatus(AppState.ERROR);
            setRouteMessage(error.message || 'Failed to calculate route.');
            return null;
        }
    }, [getPredictionsForArea]);
    
    const fetchSuggestions = useCallback((query: string) => {
        if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
        if (!query.trim()) {
            setSuggestions([]);
            return;
        }
        setIsSuggesting(true);
        debounceTimeout.current = window.setTimeout(async () => {
            const results = await api.searchLocations(query);
            setSuggestions(results);
            setIsSuggesting(false);
        }, 300);
    }, []);

    const clearSuggestions = useCallback(() => setSuggestions([]), []);

    const getCurrentLocation = useCallback(async (): Promise<Location> => {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error("Geolocation is not supported by your browser."));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const { latitude, longitude } = position.coords;
                    const name = await api.reverseGeocode(latitude, longitude);
                    resolve({ lat: latitude, lon: longitude, name });
                },
                (error) => {
                     console.error(`Geolocation error: Code ${error.code} - ${error.message}`);
                     let detailedMessage = `Could not get current location. Please check your browser's permissions.`;
                     switch(error.code) {
                         case error.PERMISSION_DENIED:
                             detailedMessage = "Location access denied. Please enable it in your browser settings and refresh.";
                             break;
                         case error.POSITION_UNAVAILABLE:
                             detailedMessage = "Location information is currently unavailable. Please try again later.";
                             break;
                         case error.TIMEOUT:
                             detailedMessage = "The request to get your location timed out. Please try again.";
                             break;
                     }
                     reject(new Error(detailedMessage));
                },
                { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
            );
        });
    }, []);
    
    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                setInitialError('');
                const location = await getCurrentLocation();
                setUserLocation(location);
                
                // Once location is available, fetch weather and predictions
                api.getWeatherData(location.lat, location.lon).then(setWeather);
                getPredictionsForArea(location, RADIUS_KM, NEARBY_KM);
            } catch (error: any) {
                console.error("Failed to fetch initial location:", error.message || error);
                setInitialError(error.message || "Could not fetch your location for local data.");
            }
        };

        fetchInitialData();
    }, [getCurrentLocation, getPredictionsForArea]);
    
    const triggerNavigationAlert = useCallback((alert: NavigationAlert) => {
        setNavigationAlert(alert);
        playAlertSound();
        const title = alert.animal ? `Wildlife Alert: ${alert.animal.common}` : 'Navigation Alert';
        showBrowserNotification(title, alert.message, alert.animal?.image);
    }, []);

    const triggerWeatherAlert = useCallback((message: string) => {
        setWeatherAlert(message);
        playAlertSound();
        showBrowserNotification('Weather Alert', message);
    }, []);

    const clearNavigationAlert = useCallback(() => {
        setNavigationAlert(null);
    }, []);

    const clearWeatherAlert = useCallback(() => setWeatherAlert(null), []);

    const stopNavigation = useCallback(() => {
        if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
        }
        setIsNavigating(false);
        setClosestPathIndex(0);
        setLiveLocation(null);
        setNavigationStats(null);
        setNavigationAlert(null);
        setWeatherAlert(null);
        setSafeRoute(null);
        setAlternativeRoute(null);
        setSafePlaces([]);
        setAnimalsNearRoute([]);
        setEmergencyRoute(null);
        setAlternativeEmergencyRoute(null);
        setIsApproachingStart(false);
        closestPathIndexRef.current = 0;
        isApproachingStartRef.current = false;
        initialRouteSnapshotRef.current = null;
        shownAnimalAlertsRef.current.clear();
    }, []);

    const startNavigation = useCallback((routeToNavigate: Route) => {
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().catch(e => console.error("Could not resume audio context:", e));
        }

        if (!routeToNavigate || !routeToNavigate.start || !routeToNavigate.end) {
            setRouteMessage('Cannot start navigation without a calculated route.');
            setRouteStatus(AppState.ERROR);
            return;
        }
        
        shownAnimalAlertsRef.current.clear();
        setClosestPathIndex(0);
        closestPathIndexRef.current = 0;
        setEmergencyRoute(null); // Clear any previous emergency route
        setAlternativeEmergencyRoute(null);
        setSafeRoute(routeToNavigate); // Ensure the route is set for the nav session
        initialRouteSnapshotRef.current = { 
            start: { ...routeToNavigate.start },
            end: { ...routeToNavigate.end },
            mode: routeToNavigate.mode,
            distanceKm: routeToNavigate.distanceKm,
            durationMinutes: routeToNavigate.durationMinutes
        };

        const APPROACHING_START_THRESHOLD_KM = 0.5;

        setIsNavigating(true);
        setNavigationAlert(null);
        setWeatherAlert(null);

        if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
        }

        watchIdRef.current = navigator.geolocation.watchPosition(
            async (position) => {
                if (navigationAlertRef.current?.message.includes("Live location signal lost")) {
                    clearNavigationAlert();
                }

                const currentLiveLocation: Location = {
                    lat: position.coords.latitude,
                    lon: position.coords.longitude,
                    name: 'Live Location'
                };
                setLiveLocation(currentLiveLocation);

                const now = Date.now();

                if (now - lastWeatherCheckTimestampRef.current > WEATHER_CHECK_INTERVAL_MS) {
                    lastWeatherCheckTimestampRef.current = now;
                    const weatherData = await api.getWeatherData(currentLiveLocation.lat, currentLiveLocation.lon);
                    if (weatherData) {
                        const severe = isWeatherSevere(weatherData.weatherCode);
                        if (severe) {
                            triggerWeatherAlert(getWeatherAlertText(weatherData.weatherCode));
                        } else if (weatherAlertRef.current) {
                            clearWeatherAlert();
                        }
                    }
                }
                
                // --- Proactive Animal Alerting ---
                const ANIMAL_ALERT_THRESHOLD_KM = 2; // Alert if user is within 2km of an animal
                const nearbyAnimals = animalsNearRouteRef.current;
    
                if (nearbyAnimals && nearbyAnimals.length > 0) {
                    for (const animal of nearbyAnimals) {
                        const distanceToAnimal = geo.calculateDistance(currentLiveLocation, animal.current);
                        
                        if (distanceToAnimal <= ANIMAL_ALERT_THRESHOLD_KM && !shownAnimalAlertsRef.current.has(animal.id)) {
                            // We have a new nearby animal, trigger an alert if there isn't one already active
                            // This prevents spamming alerts
                            if (!navigationAlertRef.current) {
                                 triggerNavigationAlert({
                                    animal: animal,
                                    message: `${animal.common} detected near your path. Last sighted ${animal.distanceToPathKm?.toFixed(1)} km from the route, and you are currently ${distanceToAnimal.toFixed(1)} km away. Proceed with caution.`
                                });
                                shownAnimalAlertsRef.current.add(animal.id);
                                break; // Show one alert at a time
                            }
                        }
                    }
                }

                const activeRoute = emergencyRouteRef.current || safeRouteRef.current;
                if (!activeRoute) return;
                
                const totalDistanceKm = activeRoute.distanceKm;
                const totalDurationMinutes = activeRoute.durationMinutes;
                
                const { path: routePath } = activeRoute;
                const { closestPointIndex: newClosestPointIndex } = geo.getPathDataFromLocation(currentLiveLocation, routePath, closestPathIndexRef.current);
                
                const distanceToStart = geo.calculateDistance(currentLiveLocation, activeRoute.start);

                const wasApproaching = isApproachingStartRef.current;
                // Only trigger "approaching start" for the original route, not an emergency reroute.
                const isNowApproaching = !emergencyRouteRef.current && newClosestPointIndex === 0 && distanceToStart > APPROACHING_START_THRESHOLD_KM;
                
                if (isNowApproaching) {
                    if (!wasApproaching) {
                        isApproachingStartRef.current = true;
                        setIsApproachingStart(true);
                    }
                    const originalRouteStats = initialRouteSnapshotRef.current;
                    setRouteMessage(`Proceed to the starting point. You are ${distanceToStart.toFixed(1)} km away.`);
                    setNavigationStats({
                        remainingKm: originalRouteStats?.distanceKm ?? totalDistanceKm,
                        etaMinutes: originalRouteStats?.durationMinutes ?? totalDurationMinutes,
                        progressPercent: 0
                    });
                    return;
                } else if (wasApproaching && !isNowApproaching) {
                    isApproachingStartRef.current = false;
                    setIsApproachingStart(false);
                    triggerNavigationAlert({ animal: null, message: "You've reached the start. Navigation has begun!" });
                }

                closestPathIndexRef.current = newClosestPointIndex;
                setClosestPathIndex(newClosestPointIndex);

                // **FIX START**: Reworked navigation stats calculation to be consistent with API summary data.
                // This prevents discrepancies between polyline-calculated distance and the API's reported distance.
                const totalPathPoints = routePath.length;
                const progressRatio = totalPathPoints > 1 ? newClosestPointIndex / (totalPathPoints - 1) : 0;
                
                const remainingKm = totalDistanceKm * (1 - progressRatio);
                const etaMinutes = totalDurationMinutes * (1 - progressRatio);
                const progressPercent = Math.round(progressRatio * 100);

                setNavigationStats({
                    remainingKm: parseFloat(remainingKm.toFixed(1)),
                    etaMinutes: Math.round(etaMinutes),
                    progressPercent: Math.max(0, Math.min(100, progressPercent)),
                });
                // **FIX END**

            },
            (error) => {
                console.error("Geolocation watch error:", error);
                triggerNavigationAlert({ animal: null, message: "Live location signal lost. Please check your GPS and permissions." });
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }, [clearNavigationAlert, setRouteMessage, setRouteStatus, triggerNavigationAlert, triggerWeatherAlert, clearWeatherAlert]);

    const calculateRouteToNearestSafePlace = useCallback(async () => {
        const currentLiveLocation = liveLocationRef.current;
        if (!currentLiveLocation || safePlaces.length === 0) {
            console.warn("Cannot calculate emergency route: No live location or no safe places.");
            setRouteMessage("No safe places found nearby to route to.");
            setRouteStatus(AppState.ERROR);
            return;
        }

        setRouteStatus(AppState.LOADING);
        setRouteMessage("Finding nearest safe place...");
        
        const closestPlace = geo.findClosestSafePlace(currentLiveLocation, safePlaces);

        if (!closestPlace) {
            setRouteMessage("Could not determine the closest safe place.");
            setRouteStatus(AppState.ERROR);
            return;
        }
        
        try {
            const route = await api.getSafeNavigationRoute(currentLiveLocation, { lat: closestPlace.lat, lon: closestPlace.lon, name: closestPlace.name }, [], 'car');
            if (route) {
                setEmergencyRoute(route);
                closestPathIndexRef.current = 0;
                setClosestPathIndex(0);
                setIsApproachingStart(false);
                isApproachingStartRef.current = false;
                triggerNavigationAlert({ animal: null, message: `Rerouting to nearest safe place: ${closestPlace.name}` });
                setRouteStatus(AppState.SUCCESS);
                setRouteMessage('Emergency route calculated.');

                // Calculate alternative route from original start location
                if (initialRouteSnapshotRef.current?.start) {
                    const originalStart = initialRouteSnapshotRef.current.start;
                    const altRoute = await api.getSafeNavigationRoute(originalStart, { lat: closestPlace.lat, lon: closestPlace.lon, name: closestPlace.name }, [], 'car');
                    setAlternativeEmergencyRoute(altRoute);
                }
            } else {
                throw new Error('Could not find a route to the safe place.');
            }
        } catch(error: any) {
            setRouteStatus(AppState.ERROR);
            setRouteMessage(error.message || 'Failed to calculate emergency route.');
        }

    }, [safePlaces, setRouteMessage, setRouteStatus, triggerNavigationAlert]);

    const clearSearchHistory = () => setSearchHistory([]);

    const clearSafeRoute = useCallback(() => {
        setSafeRoute(null);
        setAlternativeRoute(null);
        setSafePlaces([]);
        setAnimalsNearRoute([]);
        setRouteStatus(AppState.IDLE);
        setRouteMessage('');
        setOtherModesInfo({});
    }, []);

    return {
        initialError,
        userLocation, predictions, processLocationSearch,
        predictionStatus, predictionMessage,
        searchHistory, clearSearchHistory,
        suggestions, isSuggesting, fetchSuggestions, clearSuggestions,
        safeRoute, alternativeRoute, routeStatus, routeMessage, calculateSafeRoute, safePlaces,
        isNavigating, liveLocation, navigationStats, startNavigation, stopNavigation,
        navigationAlert, clearNavigationAlert, closestPathIndex, getCurrentLocation,
        weather, isApproachingStart,
        emergencyRoute, calculateRouteToNearestSafePlace,
        alternativeEmergencyRoute,
        weatherAlert, clearWeatherAlert, animalsNearRoute,
        addAnimalSighting,
        clearSafeRoute,
        otherModesInfo,
    };
};