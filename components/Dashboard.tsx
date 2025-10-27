import React, { useMemo, useState, useCallback } from 'react';
import type { AnimalPrediction, User, WeatherData, Route, Location, SafePlace, TravelMode } from '../types';
import { AppState, View } from '../types';
import { SpinnerIcon, ErrorIcon, ShieldIcon, AlertTriangleIcon, PaperPlaneIcon, ChartIcon, SunIcon, CloudIcon, RainIcon, WindIcon, MoonIcon, PartlyCloudyIcon, SnowIcon, LocationMarkerIcon, SyncIcon, MapIcon as MapIconSolid, CarIcon, WalkIcon, BikeIcon, BusIcon, PlayIcon, InfoIcon } from './icons';
import { NEARBY_KM, RADIUS_KM } from '../constants';
import * as geo from '../services/geoService';

// --- Helper Functions ---
const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
};

const getWeatherInfo = (code: number, isDay: number): { text: string; icon: React.ReactNode } => {
    const Icon = (props: React.SVGProps<SVGSVGElement>) => {
        switch (code) {
            case 0: return isDay ? <SunIcon {...props} /> : <MoonIcon {...props} />;
            case 1: return isDay ? <PartlyCloudyIcon {...props} /> : <MoonIcon {...props} />;
            case 2: case 3: return <CloudIcon {...props} />;
            case 45: case 48: return <CloudIcon {...props} />; // Fog
            case 51: case 53: case 55: case 61: case 63: case 65: case 80: case 81: case 82: return <RainIcon {...props} />;
            case 71: case 73: case 75: case 77: case 85: case 86: return <SnowIcon {...props} />;
            default: return isDay ? <SunIcon {...props} /> : <MoonIcon {...props} />;
        }
    };
    const text = (() => {
        switch (code) {
            case 0: return 'Clear sky';
            case 1: return 'Mainly clear';
            case 2: return 'Partly cloudy';
            case 3: return 'Overcast';
            case 45: case 48: return 'Fog';
            case 61: case 63: case 65: return 'Rain';
            case 80: case 81: case 82: return 'Rain showers';
            case 71: case 73: case 75: return 'Snowfall';
            default: return 'Clear';
        }
    })();
    return { text, icon: <Icon className="w-8 h-8" /> };
};

// --- Child Components ---

const SuggestionList: React.FC<{
    suggestions: Location[];
    isLoading: boolean;
    onSelect: (location: Location) => void;
}> = ({ suggestions, isLoading, onSelect }) => (
    <div className="absolute w-full bg-white rounded-md shadow-lg border border-gray-200 mt-1 z-10 max-h-48 overflow-y-auto">
        {isLoading ? (
            <div className="p-3 text-center text-sm text-gray-500">Loading...</div>
        ) : (
            <ul>
                {suggestions.map((s) => (
                    <li key={`${s.lat}-${s.lon}`} onClick={() => onSelect(s)} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer truncate">
                        {s.name}
                    </li>
                ))}
            </ul>
        )}
    </div>
);

const RouteRiskPlanner: React.FC<{
    onCalculateSafeRoute: (start: Location | string, end: Location | string, radius: number, mode: TravelMode) => Promise<Route | null>;
    routeStatus: AppState;
    routeMessage: string;
    suggestions: Location[];
    isSuggesting: boolean;
    onFetchSuggestions: (query: string) => void;
    onClearSuggestions: () => void;
    getCurrentLocation: () => Promise<Location>;
    nearbyRadiusKm: number;
}> = (props) => {
    const { onCalculateSafeRoute, routeStatus, routeMessage, suggestions, isSuggesting, onFetchSuggestions, onClearSuggestions, getCurrentLocation, nearbyRadiusKm } = props;
    const [startQuery, setStartQuery] = useState('');
    const [destQuery, setDestQuery] = useState('');
    const [selectedStart, setSelectedStart] = useState<Location | null>(null);
    const [selectedDest, setSelectedDest] = useState<Location | null>(null);
    const [activeInput, setActiveInput] = useState<'start' | 'dest' | null>(null);
    const [isGettingLocation, setIsGettingLocation] = useState(false);
    const [localError, setLocalError] = useState('');

    const handleUseMyLocation = async () => {
        setIsGettingLocation(true);
        onClearSuggestions();
        try {
            const location = await getCurrentLocation();
            setSelectedStart(location);
            setStartQuery(location.name.split(',').slice(0, 2).join(', '));
        } catch (error: any) {
            setStartQuery("Could not fetch location");
        } finally {
            setIsGettingLocation(false);
        }
    }

    const handleSuggestionClick = (location: Location) => {
        if (activeInput === 'start') {
            setStartQuery(location.name);
            setSelectedStart(location);
        } else if (activeInput === 'dest') {
            setDestQuery(location.name);
            setSelectedDest(location);
        }
        onClearSuggestions();
        setActiveInput(null);
    };

    const handleSubmit = async () => {
        setLocalError('');
        const startInput = selectedStart || startQuery.trim();
        const endInput = selectedDest || destQuery.trim();
        if (!startInput || !endInput) {
            setLocalError('Please provide a start and destination.');
            return;
        }
        // Always calculate for car first from the dashboard planner
        await onCalculateSafeRoute(startInput, endInput, nearbyRadiusKm, 'car');
    };

    return (
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200/80 space-y-4">
            <h3 className="font-bold text-gray-800 text-lg">Check Route Safety</h3>
            <div className="relative">
                <label className="text-sm font-semibold text-gray-600">Start</label>
                <div className="flex items-center gap-2 mt-1">
                    <input type="text" value={startQuery}
                        onChange={(e) => { setStartQuery(e.target.value); setSelectedStart(null); onFetchSuggestions(e.target.value); }}
                        onFocus={() => setActiveInput('start')} placeholder="Enter start location"
                        className="w-full px-3 py-2 text-sm text-gray-700 bg-gray-100 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <button onClick={handleUseMyLocation} disabled={isGettingLocation} className="p-2 bg-gray-200 rounded-md hover:bg-gray-300 disabled:opacity-50">
                        {isGettingLocation ? <SpinnerIcon /> : <LocationMarkerIcon className="w-5 h-5 text-gray-600" />}
                    </button>
                </div>
                {activeInput === 'start' && (suggestions.length > 0 || isSuggesting) && (
                    <SuggestionList suggestions={suggestions} isLoading={isSuggesting} onSelect={handleSuggestionClick} />
                )}
            </div>
            <div className="relative">
                <label className="text-sm font-semibold text-gray-600">Destination</label>
                <input type="text" value={destQuery}
                    onChange={(e) => { setDestQuery(e.target.value); setSelectedDest(null); onFetchSuggestions(e.target.value); }}
                    onFocus={() => setActiveInput('dest')} placeholder="Enter destination"
                    className="w-full px-3 py-2 text-sm text-gray-700 bg-gray-100 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 mt-1"
                />
                {activeInput === 'dest' && (suggestions.length > 0 || isSuggesting) && (
                    <SuggestionList suggestions={suggestions} isLoading={isSuggesting} onSelect={handleSuggestionClick} />
                )}
            </div>
            <button onClick={handleSubmit} disabled={routeStatus === AppState.LOADING} className="w-full py-3 bg-emerald-600 text-white font-semibold rounded-lg shadow hover:bg-emerald-700 disabled:bg-gray-400 flex items-center justify-center gap-2">
                {routeStatus === AppState.LOADING ? <><SpinnerIcon /> Checking...</> : 'Check Risks'}
            </button>
            {(localError || (routeStatus === AppState.ERROR && routeMessage)) && (
                <div className="mt-3 text-center text-sm text-red-600 p-3 bg-red-50 rounded-md border border-red-200 flex items-center justify-center gap-2">
                    <ErrorIcon className="w-5 h-5" /> {localError || routeMessage}
                </div>
            )}
        </div>
    );
};

const MultiModalSummary: React.FC<{
    currentMode: TravelMode;
    otherModesInfo: Partial<Record<TravelMode, { distanceKm: number, durationMinutes: number }>>;
}> = ({ currentMode, otherModesInfo }) => {
    const modes: { mode: TravelMode; icon: React.ReactNode }[] = [
        { mode: 'car', icon: <CarIcon className="w-5 h-5" /> },
        { mode: 'walk', icon: <WalkIcon className="w-5 h-5" /> },
        { mode: 'bike', icon: <BikeIcon className="w-5 h-5" /> },
        { mode: 'bus', icon: <BusIcon className="w-5 h-5" /> },
    ];

    const formatDuration = (minutes: number) => {
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    };

    return (
        <div>
            <h4 className="font-semibold text-gray-700 text-sm mb-2">Travel Time Estimates</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                {modes.map(({ mode, icon }) => {
                    const info = otherModesInfo[mode];
                    const isCurrent = mode === currentMode;
                    return (
                        <div key={mode} className={`p-2 rounded-lg ${isCurrent ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-gray-100 text-gray-700'}`}>
                            <div className={`mx-auto w-8 h-8 flex items-center justify-center rounded-full ${isCurrent ? 'bg-emerald-200' : 'bg-gray-200'}`}>{icon}</div>
                            {info ? (
                                <>
                                    <p className="text-sm font-bold mt-1">{formatDuration(info.durationMinutes)}</p>
                                    <p className="text-xs text-gray-500">{info.distanceKm} km</p>
                                </>
                            ) : (
                                <SpinnerIcon className="mx-auto mt-2 w-4 h-4" />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};


const RouteRiskSummary: React.FC<{
    safeRoute: Route;
    alternativeRoute: Route | null;
    animalsNearRoute: AnimalPrediction[];
    safePlaces: SafePlace[];
    otherModesInfo: Partial<Record<TravelMode, { distanceKm: number, durationMinutes: number }>>;
    onNavigate: (view: View) => void;
    onStartNavigation: (route: Route) => void;
    onClearRoute: () => void;
    animalsNearStart: AnimalPrediction[];
    animalsNearEnd: AnimalPrediction[];
}> = (props) => {
    const { safeRoute, alternativeRoute, animalsNearRoute, safePlaces, otherModesInfo, onNavigate, onStartNavigation, onClearRoute, animalsNearStart, animalsNearEnd } = props;
    const allModesInfo = { ...otherModesInfo, [safeRoute.mode]: { distanceKm: safeRoute.distanceKm, durationMinutes: safeRoute.durationMinutes } };

    return (
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200/80 space-y-4">
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="font-bold text-gray-800 text-lg">Route Safety Report</h3>
                    <p className="text-xs text-gray-500 truncate max-w-[250px]">From: {safeRoute.start.name}</p>
                    <p className="text-xs text-gray-500 truncate max-w-[250px]">To: {safeRoute.end.name}</p>
                </div>
            </div>
            
            {safeRoute.isHighRisk && (
                <div className="p-3 bg-red-100 border border-red-200 text-red-800 rounded-lg text-sm flex items-start gap-2">
                    <AlertTriangleIcon className="w-8 h-8 flex-shrink-0 mt-1" />
                    <div>
                        <span className="font-bold">High-Risk Route Advisory</span>
                        <p className="mt-1">This direct route passes through areas with significant wildlife activity. Proceed with extreme caution.</p>
                    </div>
                </div>
            )}

            {alternativeRoute && (
                <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-lg text-sm flex items-start gap-2">
                    <InfoIcon className="w-8 h-8 flex-shrink-0 mt-1 text-blue-500" />
                    <div>
                        <span className="font-bold">Alternative Route Available</span>
                        <p className="mt-1">
                            A {alternativeRoute.isHighRisk ? 'faster, but higher-risk' : 'safer, but longer'} alternative route ({alternativeRoute.durationMinutes} min) is also shown on the map.
                        </p>
                    </div>
                </div>
            )}

            <MultiModalSummary currentMode={safeRoute.mode} otherModesInfo={allModesInfo} />

            <div>
                <h4 className="font-semibold text-gray-700 text-sm mb-2 flex items-center gap-2"><AlertTriangleIcon className="w-5 h-5 text-yellow-500" /> Wildlife Risks on Route</h4>
                {animalsNearRoute.length > 0 ? (
                    <div className="space-y-2">
                        {animalsNearRoute.map(animal => (
                            <div key={animal.id} className="text-sm flex items-center gap-2 bg-yellow-50 text-yellow-800 p-2 rounded-md">
                                <span>{animal.emoji}</span>
                                <span className="font-semibold">{animal.common}</span>
                                <span>(~{animal.distanceToPathKm?.toFixed(1)} km away)</span>
                            </div>
                        ))}
                    </div>
                ) : <p className="text-sm text-gray-500 italic">No significant wildlife risks detected directly on your path.</p>}
            </div>

            {animalsNearStart.length > 0 && (
                <div>
                    <h4 className="font-semibold text-gray-700 text-sm mb-2 flex items-center gap-2"><LocationMarkerIcon className="w-5 h-5 text-green-500" /> Activity Near Start Point</h4>
                    <div className="space-y-2">
                        {animalsNearStart.map(animal => (
                            <div key={animal.id} className="text-sm flex items-center gap-2 bg-green-50 text-green-800 p-2 rounded-md">
                                <span>{animal.emoji}</span>
                                <span className="font-semibold">{animal.common}</span>
                                <span>(~{geo.calculateDistance(animal.current, safeRoute.start).toFixed(1)} km away)</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            
            {animalsNearEnd.length > 0 && (
                <div>
                    <h4 className="font-semibold text-gray-700 text-sm mb-2 flex items-center gap-2"><LocationMarkerIcon className="w-5 h-5 text-red-500" /> Activity Near Destination</h4>
                    <div className="space-y-2">
                        {animalsNearEnd.map(animal => (
                            <div key={animal.id} className="text-sm flex items-center gap-2 bg-red-50 text-red-800 p-2 rounded-md">
                                <span>{animal.emoji}</span>
                                <span className="font-semibold">{animal.common}</span>
                                <span>(~{geo.calculateDistance(animal.current, safeRoute.end).toFixed(1)} km away)</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div>
                <h4 className="font-semibold text-gray-700 text-sm mb-2 flex items-center gap-2"><ShieldIcon className="w-5 h-5 text-blue-500" /> Safe Places Along Route</h4>
                {safePlaces.length > 0 ? (
                     <div className="space-y-2">
                        {safePlaces.slice(0, 3).map(place => (
                            <div key={place.id} className="text-sm flex items-center gap-2 bg-blue-50 text-blue-800 p-2 rounded-md">
                                <span className="capitalize font-semibold">{place.type}:</span>
                                <span>{place.name}</span>
                            </div>
                        ))}
                    </div>
                ) : <p className="text-sm text-gray-500 italic">No designated safe places found along this route.</p>}
            </div>
             <div className="space-y-3 mt-4">
                <button onClick={() => onStartNavigation(safeRoute)} className="w-full py-3 bg-emerald-600 text-white font-semibold rounded-lg shadow hover:bg-emerald-700 flex items-center justify-center gap-2">
                    <PlayIcon className="w-5 h-5" /> Start Navigation
                </button>
                <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => onNavigate(View.MAP)} className="w-full py-2 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 flex items-center justify-center gap-2 text-sm">
                        <MapIconSolid className="w-4 h-4" /> View on Map
                    </button>
                    <button onClick={onClearRoute} className="w-full py-2 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 flex items-center justify-center gap-2 text-sm">
                        <SyncIcon className="w-4 h-4" /> New Search
                    </button>
                </div>
            </div>
        </div>
    );
};

const NearbySafetyReport: React.FC<{
    nearbyAlerts: AnimalPrediction[];
    safePlaces: SafePlace[];
    onViewDetails: (animal: AnimalPrediction) => void;
}> = ({ nearbyAlerts, safePlaces, onViewDetails }) => {
    const riskGroups = useMemo(() => {
        const groups: { [key: string]: AnimalPrediction[] } = { High: [], Medium: [], Low: [] };
        nearbyAlerts.forEach(alert => {
            if (alert.riskLevel && groups[alert.riskLevel]) {
                groups[alert.riskLevel].push(alert);
            }
        });
        return [
            { level: 'High', alerts: groups.High },
            { level: 'Medium', alerts: groups.Medium },
            { level: 'Low', alerts: groups.Low },
        ].filter(g => g.alerts.length > 0);
    }, [nearbyAlerts]);

    const riskLevelClasses: { [key: string]: { bg: string, border: string, hoverBg: string, ring: string, text: string, subText: string, icon: React.ReactNode } } = {
        High: { bg: 'bg-red-50', border: 'border-red-200', hoverBg: 'hover:bg-red-100', ring: 'focus:ring-red-500', text: 'text-red-800', subText: 'text-red-700', icon: <AlertTriangleIcon className="w-5 h-5 text-red-600" /> },
        Medium: { bg: 'bg-yellow-50', border: 'border-yellow-200', hoverBg: 'hover:bg-yellow-100', ring: 'focus:ring-yellow-500', text: 'text-yellow-800', subText: 'text-yellow-700', icon: <AlertTriangleIcon className="w-5 h-5 text-yellow-600" /> },
        Low: { bg: 'bg-green-50', border: 'border-green-200', hoverBg: 'hover:bg-green-100', ring: 'focus:ring-green-500', text: 'text-green-800', subText: 'text-green-700', icon: <InfoIcon className="w-5 h-5 text-green-600" /> },
    };

    return (
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200/80 space-y-4">
            <div className="flex items-center gap-3">
                 <ChartIcon className="w-8 h-8 text-gray-500 flex-shrink-0" />
                <div>
                    <h3 className="font-bold text-gray-800 text-lg">Nearby Risk Zones</h3>
                    <p className="text-sm text-gray-600">Wildlife activity has been classified by risk level.</p>
                </div>
            </div>
            
            <div className="space-y-4">
                {riskGroups.map(group => {
                    const classes = riskLevelClasses[group.level];
                    return (
                        <div key={group.level}>
                            <h4 className="font-semibold text-gray-700 text-sm mb-2 flex items-center gap-2">
                                {classes.icon} {group.level} Risk Activity
                            </h4>
                            <div className="space-y-2">
                                {group.alerts.map(animal => (
                                    <button 
                                        key={animal.id} 
                                        onClick={() => onViewDetails(animal)} 
                                        className={`w-full text-left flex items-center gap-3 text-sm p-3 rounded-lg border transition-colors focus:outline-none ${classes.bg} ${classes.border} ${classes.hoverBg} ${classes.ring}`}
                                    >
                                        <span className="text-2xl">{animal.emoji}</span>
                                        <div>
                                            <p className={`font-semibold ${classes.text}`}>{animal.common}</p>
                                            <p className={`text-xs ${classes.subText}`}>{animal.current.dist_km.toFixed(1)} km away near {animal.current.addr.split(',').slice(0, 2).join(',')}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )
                })}
            </div>

            <div>
                <h4 className="font-semibold text-gray-700 text-sm mb-2 flex items-center gap-2"><ShieldIcon className="w-5 h-5 text-blue-500" /> Nearest Safe Places</h4>
                {safePlaces.length > 0 ? (
                    <div className="space-y-2">
                        {safePlaces.slice(0, 3).map(place => (
                             <div key={place.id} className="text-sm bg-blue-50 text-blue-800 p-3 rounded-md">
                                <div className="flex justify-between items-start">
                                    <span className="font-semibold flex-grow pr-2">{place.name}</span>
                                    <span className="capitalize text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full flex-shrink-0">{place.type}</span>
                                </div>
                                {place.address && <p className="text-xs text-blue-700 mt-1">{place.address}</p>}
                            </div>
                        ))}
                    </div>
                ) : <p className="text-sm text-gray-500 italic">Could not find designated safe places in the vicinity.</p>}
            </div>
        </div>
    );
};


// --- Main Dashboard Component ---
interface DashboardProps {
    user: User;
    initialError: string;
    predictions: AnimalPrediction[];
    predictionStatus: AppState;
    predictionMessage: string;
    nearbyRadiusKm: number;
    safeRoute: Route | null;
    alternativeRoute: Route | null;
    weather: WeatherData | null;
    onNavigate: (view: View) => void;
    onViewDetails: (animal: AnimalPrediction) => void;
    onCalculateSafeRoute: (start: Location | string, end: Location | string, radius: number, mode: TravelMode) => Promise<Route | null>;
    onStartNavigation: (route: Route) => void;
    routeStatus: AppState;
    routeMessage: string;
    safePlaces: SafePlace[];
    animalsNearRoute: AnimalPrediction[];
    onFetchSuggestions: (query: string) => void;
    suggestions: Location[];
    isSuggesting: boolean;
    onClearSuggestions: () => void;
    getCurrentLocation: () => Promise<Location>;
    onClearRoute: () => void;
    otherModesInfo: Partial<Record<TravelMode, { distanceKm: number, durationMinutes: number }>>;
}

const AlertItem: React.FC<{ alert: AnimalPrediction; onViewDetails: (animal: AnimalPrediction) => void }> = ({ alert, onViewDetails }) => (
    <button onClick={() => onViewDetails(alert)} className="w-full text-left flex items-center gap-3 text-sm p-3 bg-yellow-50 rounded-lg shadow-sm border border-yellow-200 hover:bg-yellow-100 transition-colors focus:outline-none focus:ring-2 focus:ring-yellow-500">
        <span className="text-2xl">{alert.emoji}</span>
        <div>
            <p className="font-semibold text-yellow-800">{alert.common}</p>
            <p className="text-yellow-700">{alert.current.dist_km} km away near {alert.current.addr.split(',').slice(0, 2).join(',')}</p>
        </div>
    </button>
);

const RiskLevelCard: React.FC<{ 
    riskScore: number; 
    riskLevel: string; 
    speciesTracked: number; 
    weather: WeatherData | null; 
    predictionStatus: AppState;
}> = ({ riskScore, riskLevel, speciesTracked, weather, predictionStatus }) => {
    const isInitializing = !weather;
    const isLoading = predictionStatus === AppState.LOADING;

    const colorClasses = {
        Low: 'from-emerald-500 to-green-500',
        Medium: 'from-yellow-500 to-amber-500',
        High: 'from-red-500 to-rose-500',
    };
    const riskColorClass = isInitializing ? 'from-gray-400 to-gray-500' : isLoading ? 'from-blue-400 to-blue-500' : colorClasses[riskLevel as keyof typeof colorClasses];
    const weatherInfo = weather ? getWeatherInfo(weather.weatherCode, weather.isDay) : null;

    return (
        <div className={`p-5 rounded-xl text-white bg-gradient-to-br ${riskColorClass} transition-all duration-500`}>
            <div className="flex justify-between items-start min-h-[124px]">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <ShieldIcon className="w-6 h-6" />
                        <h3 className="font-semibold">Local Area Risk</h3>
                    </div>
                    <div className="ml-9 mt-1">
                        {isInitializing ? (
                            <>
                                <p className="text-4xl font-bold">Checking...</p>
                                <p className="text-sm opacity-90">Getting your location</p>
                            </>
                        ) : isLoading ? (
                            <>
                                <p className="text-4xl font-bold">Analyzing...</p>
                                <p className="text-sm opacity-90">Predicting wildlife paths</p>
                            </>
                        ) : (
                            <>
                                <p className="text-5xl font-bold">{riskLevel}</p>
                                <p className="text-sm opacity-90">Risk Score: {riskScore}/100 • {speciesTracked} species</p>
                            </>
                        )}
                    </div>
                </div>
                {isInitializing ? (
                     <div className="text-right flex-shrink-0">
                         <div className="flex items-center justify-end gap-2">
                            <CloudIcon className="w-8 h-8 animate-pulse"/>
                         </div>
                         <p className="text-xs opacity-90 mt-1">Fetching weather</p>
                     </div>
                ) : weatherInfo && weather && (
                    <div className="text-right flex-shrink-0">
                        <div className="flex items-center justify-end gap-2">
                           {weatherInfo.icon}
                           <p className="text-3xl font-bold">{Math.round(weather.temperature)}°C</p>
                        </div>
                        <p className="text-xs opacity-90">{weatherInfo.text}</p>
                         <p className="text-xs opacity-90 flex items-center justify-end gap-1"><WindIcon className="w-3 h-3"/>{weather.windSpeed} km/h</p>
                    </div>
                )}
            </div>
        </div>
    );
};

const Dashboard: React.FC<DashboardProps> = (props) => {
    const { user, initialError, predictions, predictionStatus, predictionMessage, nearbyRadiusKm, safeRoute, alternativeRoute, weather, onNavigate, onViewDetails, onCalculateSafeRoute, onStartNavigation, routeStatus, routeMessage, safePlaces, animalsNearRoute, onFetchSuggestions, suggestions, isSuggesting, onClearSuggestions, getCurrentLocation, onClearRoute, otherModesInfo } = props;

    const dashboardStats = useMemo(() => {
        // Show all animals found within the 50km search radius as "nearby" on the dashboard, matching the map's visual circle.
        const nearbyAlerts = predictions.filter(p => p.current.dist_km <= RADIUS_KM);
        const speciesTracked = new Set(predictions.map(p => p.common)).size;
        
        // Risk score is still based on closer animals (using configurable radius) to represent more immediate, actionable risk.
        const immediateAlerts = predictions.filter(p => p.current.dist_km <= (user.nearbyRadiusKm ?? NEARBY_KM));
        let riskScore = immediateAlerts.length * 15 + predictions.length * 2;
        riskScore = Math.min(riskScore, 100);

        const riskLevel = riskScore > 65 ? 'High' : riskScore > 35 ? 'Medium' : 'Low';

        return { riskScore, riskLevel, speciesTracked, nearbyAlerts };
    }, [predictions, user]);

    const animalsNearStartAndEnd = useMemo(() => {
        if (!safeRoute || !predictions.length) {
            return { nearStart: [], nearEnd: [] };
        }
    
        const RADIUS = 50; // User-specified radius

        const nearStart = predictions.filter(p => 
            geo.calculateDistance(p.current, safeRoute.start) <= RADIUS
        ).sort((a, b) => geo.calculateDistance(a.current, safeRoute.start) - geo.calculateDistance(b.current, safeRoute.start));
    
        const nearEnd = predictions.filter(p => 
            geo.calculateDistance(p.current, safeRoute.end) <= RADIUS
        ).sort((a, b) => geo.calculateDistance(a.current, safeRoute.end) - geo.calculateDistance(b.current, safeRoute.end));
    
        return { nearStart, nearEnd };
    
    }, [safeRoute, predictions]);

    const greeting = getGreeting();
    const showNearbySafetyReport = !safeRoute && dashboardStats.nearbyAlerts.length > 0;

    return (
        <div className="p-4 space-y-5 overflow-y-auto h-full pb-24 bg-gray-50">
            <header>
                <p className="text-gray-500 text-sm">{greeting}, {user.name.split(' ')[0]}</p>
                <h1 className="text-2xl font-bold text-gray-800">
                    {!weather && !initialError ? 'Initializing...' : 'Stay Safe Out There'}
                </h1>
            </header>
            
            <RiskLevelCard 
                riskScore={dashboardStats.riskScore}
                riskLevel={dashboardStats.riskLevel}
                speciesTracked={dashboardStats.speciesTracked}
                weather={weather}
                predictionStatus={predictionStatus}
            />

            {initialError ? (
                 <div className="flex items-center justify-center gap-3 bg-red-100 text-red-700 p-4 rounded-lg shadow">
                    <ErrorIcon /> <span>{initialError}</span>
                </div>
            ) : (
                <>
                    {safeRoute ? (
                        <RouteRiskSummary 
                            safeRoute={safeRoute}
                            alternativeRoute={alternativeRoute}
                            animalsNearRoute={animalsNearRoute}
                            safePlaces={safePlaces}
                            otherModesInfo={otherModesInfo}
                            onNavigate={onNavigate}
                            onStartNavigation={onStartNavigation}
                            onClearRoute={onClearRoute}
                            animalsNearStart={animalsNearStartAndEnd.nearStart}
                            animalsNearEnd={animalsNearStartAndEnd.nearEnd}
                        />
                    ) : (
                        <div className="space-y-5">
                            <RouteRiskPlanner 
                                onCalculateSafeRoute={onCalculateSafeRoute}
                                routeStatus={routeStatus}
                                routeMessage={routeMessage}
                                onFetchSuggestions={onFetchSuggestions}
                                suggestions={suggestions}
                                isSuggesting={isSuggesting}
                                onClearSuggestions={onClearSuggestions}
                                getCurrentLocation={getCurrentLocation}
                                nearbyRadiusKm={nearbyRadiusKm}
                            />
                            {showNearbySafetyReport && (
                                <NearbySafetyReport nearbyAlerts={dashboardStats.nearbyAlerts} safePlaces={safePlaces} onViewDetails={onViewDetails} />
                            )}
                        </div>
                    )}

                    {!safeRoute && !showNearbySafetyReport && (
                         <div>
                            <h2 className="text-lg font-bold text-gray-800 mb-3">Nearby Wildlife Alerts</h2>
                            {predictionStatus === AppState.LOADING && !weather ? null : // Hide spinner if we are still in the 'initializing' phase
                            predictionStatus === AppState.LOADING ? (
                                <div className="text-center text-gray-500 py-6 bg-white rounded-lg shadow-sm border flex flex-col items-center gap-3">
                                    <SpinnerIcon className="w-6 h-6" />
                                    <p className="text-sm font-medium">{predictionMessage || 'Analyzing wildlife activity...'}</p>
                                </div>
                            ) : predictionStatus === AppState.ERROR ? (
                                <div className="text-center text-red-600 py-6 bg-red-50 rounded-lg shadow-sm border border-red-200 flex flex-col items-center gap-3">
                                    <ErrorIcon className="w-6 h-6" />
                                    <p className="text-sm font-medium">{predictionMessage}</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {dashboardStats.nearbyAlerts.length > 0 ? (
                                        dashboardStats.nearbyAlerts.slice(0, 3).map(alert => <AlertItem key={alert.id} alert={alert} onViewDetails={onViewDetails} />)
                                    ) : (
                                        <div className="text-center text-gray-500 py-6 bg-white rounded-lg shadow-sm border">
                                            <p className="text-sm font-medium">No recent wildlife alerts in your area.</p>
                                            <p className="text-xs text-gray-400 mt-1">It's quiet for now. Stay vigilant.</p>
                                        </div>
                                    )}
                                    {dashboardStats.nearbyAlerts.length > 3 && (
                                        <button onClick={() => onNavigate(View.MAP)} className="w-full text-center py-2 px-4 bg-gray-100 text-gray-600 font-semibold text-sm rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-2">
                                            <MapIconSolid className="w-4 h-4" />
                                            View all {dashboardStats.nearbyAlerts.length} alerts on map
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default React.memo(Dashboard);