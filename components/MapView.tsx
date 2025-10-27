import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap, CircleMarker } from 'react-leaflet';
import type { AnimalPrediction, Location, Route, NavigationStats, NavigationAlert, SafePlace, TravelMode } from '../types';
import { AppState } from '../types';
import { MAP_CENTER, MAP_ZOOM, ANIMATION_STEPS, RADIUS_KM } from '../constants';
import L from 'leaflet';
import { FilterIcon, PlayIcon, PauseIcon, AlertTriangleIcon, InfoIcon, StopIcon, XIcon, PaperPlaneIcon, SpinnerIcon, ErrorIcon, LocationMarkerIcon, SyncIcon, ShieldIcon, RainIcon, CarIcon, WalkIcon, BikeIcon, BusIcon } from './icons';
import * as api from '../services/apiService';


const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * x) - 1) / 2;

const useLocalStorage = <T,>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] => {
    const [storedValue, setStoredValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
        } catch (error: any) {
            console.error(error);
            return initialValue;
        }
    });

    const setValue = (value: T | ((val: T) => T)) => {
        try {
            const valueToStore = value instanceof Function ? value(storedValue) : value;
            setStoredValue(valueToStore);
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error: any) {
            console.error(error);
        }
    };
    return [storedValue, setValue];
};

// --- Child Components for MapView ---

const WeatherRadarOverlay: React.FC = () => {
    const [tileUrl, setTileUrl] = useState<string | null>(null);
    
    useEffect(() => {
        const fetchAndSetUrl = async () => {
            const data = await api.getRainViewerTimestamps();
            if (data && data.radar && data.radar.past && data.radar.past.length > 0) {
                const latestTimestamp = data.radar.past[data.radar.past.length - 1];
                setTileUrl(`https://tilecache.rainviewer.com/v2/radar/${latestTimestamp}/{z}/{x}/{y}/512/1_1.png`);
            }
        };
        fetchAndSetUrl();
    }, []);

    if (!tileUrl) return null;

    return <TileLayer url={tileUrl} opacity={0.7} zIndex={5} />;
};

interface MapEventsProps {
    setMap: (map: L.Map) => void;
}
const MapEvents: React.FC<MapEventsProps> = ({ setMap }) => {
    const map = useMap();
    useEffect(() => {
        setMap(map);
    }, [map, setMap]);
    return null;
}

interface NavigationAlertBannerProps {
    alert: NavigationAlert;
    onClose: () => void;
    alternativeRoute: Route | null;
    onActivateAlternative: (route: Route) => void;
}
const NavigationAlertBanner: React.FC<NavigationAlertBannerProps> = ({ alert, onClose, alternativeRoute, onActivateAlternative }) => {
    const isRerouteAlert = alert.message.includes('Rerouting to nearest safe place');
    
    return (
         <div className="leaflet-top w-full pt-4 px-4 pointer-events-none" style={{ zIndex: 1100 }}>
            <div className="w-full max-w-lg mx-auto bg-white rounded-xl shadow-2xl p-4 flex flex-col gap-3 pointer-events-auto animate-slide-down border-t-4 border-yellow-500">
                <div className="flex items-start gap-4">
                    <div className={`flex-shrink-0 text-3xl flex items-center gap-2`}>
                        <AlertTriangleIcon className="w-8 h-8 text-yellow-500" />
                        {alert.animal && <span className="text-4xl">{alert.animal.emoji}</span>}
                    </div>
                    <div className="flex-grow">
                        <p className="font-bold text-gray-800">{alert.animal ? `Wildlife Alert!` : 'Navigation Alert!'}</p>
                        <p className="text-sm text-gray-600">{alert.message}</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <XIcon className="w-5 h-5" />
                    </button>
                </div>
                {isRerouteAlert && alternativeRoute && (
                    <div className="mt-2 pt-3 border-t border-gray-200">
                        <p className="text-xs text-gray-500 mb-2">Alternative route available:</p>
                        <button 
                            onClick={() => onActivateAlternative(alternativeRoute)}
                            className="w-full text-center px-3 py-2 bg-blue-100 text-blue-800 text-sm font-semibold rounded-md hover:bg-blue-200 transition-colors flex items-center justify-center gap-2">
                            <SyncIcon className="w-4 h-4" />
                            <span>Navigate from Start Location</span>
                        </button>
                    </div>
                )}
            </div>
            <style>{`
                @keyframes slide-down {
                    from { transform: translateY(-120%); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                .animate-slide-down {
                    animation: slide-down 0.5s ease-out forwards;
                }
            `}</style>
        </div>
    );
};

interface WeatherAlertBannerProps {
    message: string;
    onClose: () => void;
}
const WeatherAlertBanner: React.FC<WeatherAlertBannerProps> = ({ message, onClose }) => {
    return (
        <div className="leaflet-top w-full pt-4 px-4 pointer-events-none" style={{ top: '60px', zIndex: 1099 }}>
            <div className="w-full max-w-lg mx-auto bg-white rounded-xl shadow-2xl p-4 flex items-start gap-4 pointer-events-auto animate-slide-down border-t-4 border-blue-500">
                <div className="flex-shrink-0 text-3xl">
                    <RainIcon className="w-8 h-8 text-blue-500" />
                </div>
                <div className="flex-grow">
                    <p className="font-bold text-gray-800">Weather Alert</p>
                    <p className="text-sm text-gray-600">{message}</p>
                </div>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                    <XIcon className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
};


interface LiveUserMarkerProps {
    location: Location;
}
const LiveUserMarker: React.FC<LiveUserMarkerProps> = React.memo(({ location }) => (
    <CircleMarker center={[location.lat, location.lon]} radius={8} pathOptions={{ color: 'white', fillColor: '#2563eb', fillOpacity: 1, weight: 2 }}>
        <Circle center={[location.lat, location.lon]} radius={20} pathOptions={{ color: '#2563eb', weight: 1, fillOpacity: 0.1 }}/>
    </CircleMarker>
));

interface MapControllerProps {
    userLocation: Location | null;
    route: Route | null;
    isNavigating: boolean;
    liveLocation: Location | null;
}
const MapController: React.FC<MapControllerProps> = ({ userLocation, route, isNavigating, liveLocation }) => {
    const map = useMap();

    useEffect(() => {
        if (route && route.path.length > 0) {
            const bounds = L.latLngBounds(route.path);
            map.flyToBounds(bounds, { padding: [50, 50] });
        } else if (isNavigating && liveLocation) {
            map.flyTo([liveLocation.lat, liveLocation.lon], 14);
        } else if (userLocation) {
            map.flyTo([userLocation.lat, userLocation.lon], 12);
        }
    }, [userLocation, route, map, isNavigating, liveLocation]);
    
    return null;
};

interface UserMarkerProps {
    location: Location;
}
const UserMarker: React.FC<UserMarkerProps> = React.memo(({ location }) => {
    const icon = new L.DivIcon({
        html: `
            <div class="relative flex flex-col items-center">
                <div class="absolute -top-8 bg-white text-gray-800 text-sm font-bold px-3 py-1 rounded-lg shadow-md whitespace-nowrap">Your Location <div class="absolute bg-white h-2 w-2 transform rotate-45 -bottom-1 left-1/2 -ml-1"></div></div>
                <div class="bg-blue-600 w-4 h-4 rounded-full border-2 border-white shadow-lg"></div>
            </div>
        `,
        className: 'leaflet-div-icon',
        iconAnchor: [8, 8]
    });

    return (
        <Marker position={[location.lat, location.lon]} icon={icon}>
             <Popup><b>Your Location:</b><br/>{location.name}</Popup>
        </Marker>
    )
});

interface RouteMarkerProps {
    location: Location;
    type: 'start' | 'end';
}
const RouteMarker: React.FC<RouteMarkerProps> = React.memo(({ location, type }) => {
    const isStart = type === 'start';
    const bgColor = isStart ? 'bg-green-600' : 'bg-red-600';
    const label = isStart ? 'Start' : 'Destination';
    const flagPath = `M3.75 21v-18a.75.75 0 01.75-.75h6a.75.75 0 01.75.75v18m-9 0h9`;
    
    const icon = new L.DivIcon({
        html: `
            <div class="relative flex flex-col items-center group">
                <div class="absolute -top-9 bg-white text-gray-800 text-sm font-bold px-3 py-1 rounded-lg shadow-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">${label}<div class="absolute bg-white h-2 w-2 transform rotate-45 -bottom-1 left-1/2 -ml-1"></div></div>
                <div class="flex items-center justify-center w-8 h-8 rounded-full ${bgColor} border-2 border-white shadow-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5 text-white">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" />
                    </svg>
                </div>
            </div>
        `,
        className: 'leaflet-div-icon',
        iconAnchor: [16, 32]
    });

    return <Marker position={[location.lat, location.lon]} icon={icon} zIndexOffset={1000}><Popup><b>{label}:</b><br/>{location.name}</Popup></Marker>;
});


interface AnimatedAnimalMarkerProps {
    prediction: AnimalPrediction;
    progress: number;
    onViewDetails: (animal: AnimalPrediction) => void;
}
const AnimatedAnimalMarker: React.FC<AnimatedAnimalMarkerProps> = ({ prediction, progress, onViewDetails }) => {
    const icon = useMemo(() => new L.DivIcon({
        html: `<div class="relative text-3xl" style="text-shadow: 0 0 5px white;">${prediction.emoji}</div>`,
        className: 'leaflet-div-icon',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
    }), [prediction.emoji]);
    
    const progressRatio = progress / ANIMATION_STEPS;
    const easedProgressRatio = easeInOutSine(progressRatio);
    const pathIndex = Math.floor(easedProgressRatio * (prediction.fullPath.length - 1));

    const currentPosition = prediction.fullPath[pathIndex];
    if (!currentPosition) return null;

    return (
        <Marker position={currentPosition} icon={icon}>
            <Popup>
                <div style={{width: 240}}>
                    <b className="text-lg">{prediction.emoji} {prediction.common}</b><br/>
                    <small><b>Current:</b> {prediction.current.addr} <br/><b>Distance:</b> {prediction.current.dist_km} km</small>
                    {prediction.image && <a href={prediction.image} target='_blank' rel="noreferrer"><img src={prediction.image} width='220' alt={prediction.common} className="mt-2 rounded-md" /></a>}
                    <button onClick={() => onViewDetails(prediction)} className="mt-2 w-full text-center p-2 bg-emerald-600 text-white text-sm font-semibold rounded-md hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1">
                        <InfoIcon className="w-4 h-4" /> View Details
                    </button>
                </div>
            </Popup>
        </Marker>
    );
};

interface NavigationInfoPanelProps {
    stats: NavigationStats;
    onStop: () => void;
    onFindSafePlace: () => void;
}
const NavigationInfoPanel: React.FC<NavigationInfoPanelProps> = ({ stats, onStop, onFindSafePlace }) => (
    <div className="leaflet-bottom w-full pb-4 px-4 pointer-events-none" style={{zIndex: 1000}}>
        <div className="w-full max-w-sm mx-auto bg-white rounded-xl shadow-2xl p-4 pointer-events-auto">
            <div className="flex items-center justify-between gap-3">
                <div className="text-left flex-grow">
                    <p className="text-3xl font-bold text-gray-800">{stats.etaMinutes}<span className="text-xl font-medium"> min</span></p>
                    <p className="text-gray-500 font-semibold">{stats.remainingKm} km remaining</p>
                </div>
            </div>
            <div className="mt-3">
                <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-semibold text-gray-500">Progress</span>
                    <span className="text-sm font-bold text-emerald-600">{stats.progressPercent}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div 
                        className="bg-emerald-500 h-2.5 rounded-full transition-all duration-500 ease-out" 
                        style={{ width: `${stats.progressPercent}%` }}
                    ></div>
                </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
                <button 
                    onClick={onFindSafePlace} 
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-100 text-blue-800 text-sm font-semibold rounded-lg hover:bg-blue-200 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                    <ShieldIcon className="w-5 h-5" />
                    <span>Safe Place</span>
                </button>
                <button 
                    onClick={onStop} 
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-100 text-red-800 text-sm font-semibold rounded-lg hover:bg-red-200 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                >
                    <StopIcon className="w-5 h-5" />
                    <span>End Trip</span>
                </button>
            </div>
        </div>
    </div>
);


interface SuggestionListProps {
    suggestions: Location[];
    isLoading: boolean;
    onSelect: (location: Location) => void;
}
const SuggestionList: React.FC<SuggestionListProps> = ({ suggestions, isLoading, onSelect }) => (
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

interface RoutePlannerSheetProps {
    isOpen: boolean;
    onClose: () => void;
    onCalculateSafeRoute: (start: Location | string, end: Location | string, radius: number, mode: TravelMode) => Promise<Route | null>;
    routeStatus: AppState;
    routeMessage: string;
    suggestions: Location[];
    isSuggesting: boolean;
    onFetchSuggestions: (query: string) => void;
    onClearSuggestions: () => void;
    getCurrentLocation: () => Promise<Location>;
    nearbyRadiusKm: number;
    searchHistory: string[];
    currentRoute: Route | null;
}
const RoutePlannerSheet: React.FC<RoutePlannerSheetProps> = (props) => {
    const { isOpen, onClose, onCalculateSafeRoute, routeStatus, routeMessage, suggestions, isSuggesting, onFetchSuggestions, onClearSuggestions, getCurrentLocation, nearbyRadiusKm, searchHistory, currentRoute } = props;
    const [startQuery, setStartQuery] = useState('');
    const [destQuery, setDestQuery] = useState('');
    const [selectedStart, setSelectedStart] = useState<Location | null>(null);
    const [selectedDest, setSelectedDest] = useState<Location | null>(null);
    const [activeInput, setActiveInput] = useState<'start' | 'dest' | null>(null);
    const [isGettingLocation, setIsGettingLocation] = useState(false);
    const [localError, setLocalError] = useState('');
    const [travelMode, setTravelMode] = useState<TravelMode>('car');

    useEffect(() => {
        if (isOpen) {
            if (currentRoute) {
                setStartQuery(currentRoute.start.name);
                setSelectedStart(currentRoute.start);
                setDestQuery(currentRoute.end.name);
                setSelectedDest(currentRoute.end);
            } else {
                setStartQuery('');
                setSelectedStart(null);
                setDestQuery('');
                setSelectedDest(null);
            }
            setLocalError('');
        }
    }, [isOpen, currentRoute]);


    const travelModes: { mode: TravelMode; icon: React.ReactNode; label: string }[] = [
        { mode: 'car', icon: <CarIcon className="w-6 h-6" />, label: 'Car' },
        { mode: 'walk', icon: <WalkIcon className="w-6 h-6" />, label: 'Walk' },
        { mode: 'bike', icon: <BikeIcon className="w-6 h-6" />, label: 'Bike' },
        { mode: 'bus', icon: <BusIcon className="w-6 h-6" />, label: 'Bus' },
    ];

    const handleUseMyLocation = async () => {
        setIsGettingLocation(true);
        onClearSuggestions();
        try {
            const location = await getCurrentLocation();
            setSelectedStart(location);
            setStartQuery(location.name.split(',').slice(0, 2).join(', '));
        } catch (error: any) {
            console.error("Error getting current location:", error);
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
    
    const handleRecentSearchClick = (searchTerm: string) => {
        const targetInput = activeInput || 'dest';
        if (targetInput === 'start') {
            setStartQuery(searchTerm);
            setSelectedStart(null);
        } else {
            setDestQuery(searchTerm);
            setSelectedDest(null);
        }
        onClearSuggestions();
    };

    const handleSubmit = async () => {
        setLocalError('');
        const startInput = selectedStart || startQuery.trim();
        const endInput = selectedDest || destQuery.trim();

        if (!startInput) {
            setLocalError('Please provide a start location.');
            return;
        }
        if (!endInput) {
            setLocalError('Please provide a destination.');
            return;
        }

        const newRoute = await onCalculateSafeRoute(startInput, endInput, nearbyRadiusKm, travelMode);
        if (newRoute) {
            onClose();
        }
    };

    return (
        <div className={`fixed inset-0 z-[2000] transition-colors ${isOpen ? 'bg-black/40' : 'bg-transparent pointer-events-none'}`} onClick={onClose}>
            <div 
                className={`fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl p-4 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-y-0' : 'translate-y-full'}`} 
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-800">Plan a Safe Route</h2>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><XIcon /></button>
                </div>

                {searchHistory && searchHistory.length > 0 && (
                    <div className="mb-4">
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Recent Searches</h3>
                        <div className="flex flex-wrap gap-2">
                            {searchHistory.map((item, index) => (
                                <button key={index} onClick={() => handleRecentSearchClick(item)} className="px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full hover:bg-gray-200 transition-colors truncate max-w-[150px]">
                                    {item}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                
                <div className="space-y-4">
                     <div className="relative">
                        <label className="text-sm font-semibold text-gray-600">Start</label>
                        <div className="flex items-center gap-2 mt-1">
                            <input 
                                type="text" 
                                value={startQuery} 
                                onChange={(e) => {
                                    setStartQuery(e.target.value);
                                    setSelectedStart(null);
                                    onFetchSuggestions(e.target.value);
                                }}
                                onFocus={() => setActiveInput('start')}
                                placeholder="Enter start location" 
                                className="w-full px-3 py-2 text-sm text-gray-700 bg-gray-100 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                            <button onClick={handleUseMyLocation} disabled={isGettingLocation} className="p-2 bg-gray-200 rounded-md hover:bg-gray-300 disabled:opacity-50">
                                {isGettingLocation ? <SpinnerIcon /> : <LocationMarkerIcon className="w-5 h-5 text-gray-600"/>}
                            </button>
                        </div>
                        {activeInput === 'start' && (suggestions.length > 0 || isSuggesting) && (
                            <SuggestionList suggestions={suggestions} isLoading={isSuggesting} onSelect={handleSuggestionClick} />
                        )}
                    </div>
                     <div className="relative">
                        <label className="text-sm font-semibold text-gray-600">Destination</label>
                        <input 
                            type="text" 
                            value={destQuery} 
                            onChange={(e) => {
                                setDestQuery(e.target.value);
                                setSelectedDest(null);
                                onFetchSuggestions(e.target.value);
                            }}
                            onFocus={() => setActiveInput('dest')}
                            placeholder="Enter destination" 
                            className="w-full px-3 py-2 text-sm text-gray-700 bg-gray-100 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 mt-1"
                        />
                         {activeInput === 'dest' && (suggestions.length > 0 || isSuggesting) && (
                            <SuggestionList suggestions={suggestions} isLoading={isSuggesting} onSelect={handleSuggestionClick} />
                        )}
                    </div>
                    <div className="flex justify-around items-center bg-gray-100 rounded-lg p-1">
                        {travelModes.map(({ mode, icon, label }) => (
                            <button
                                key={mode}
                                type="button"
                                onClick={() => setTravelMode(mode)}
                                className={`flex-1 flex flex-col items-center justify-center p-2 rounded-md transition-colors text-sm ${travelMode === mode ? 'bg-white text-emerald-600 shadow' : 'text-gray-600 hover:bg-gray-200'}`}
                                aria-label={`Select travel mode: ${label}`}
                            >
                                {icon}
                                <span className="font-semibold mt-1">{label}</span>
                            </button>
                        ))}
                    </div>
                    <button onClick={handleSubmit} disabled={routeStatus === AppState.LOADING} className="w-full py-3 bg-emerald-600 text-white font-semibold rounded-lg shadow hover:bg-emerald-700 disabled:bg-gray-400 flex items-center justify-center gap-2">
                         {routeStatus === AppState.LOADING ? <><SpinnerIcon/> Calculating...</> : 'Find Safe Route'}
                    </button>
                    {(localError || (routeStatus === AppState.ERROR && routeMessage)) && (
                        <div className="mt-3 text-center text-sm text-red-600 p-3 bg-red-50 rounded-md border border-red-200 flex items-center justify-center gap-2">
                           <ErrorIcon className="w-5 h-5" /> {localError || (routeMessage.includes("Could not find a route") ? "No safe route found. The area may be high-risk. Please consider waiting or alerting local authorities for guidance." : routeMessage)}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

interface FilterPanelProps {
    animalTypes: string[];
    visibleAnimals: Record<string, boolean>;
    onToggleAnimal: (commonName: string) => void;
    showPredictions: boolean;
    onTogglePredictions: () => void;
    showNearbyRadius: boolean;
    onToggleNearbyRadius: () => void;
    showWeatherOverlay: boolean;
    onToggleWeatherOverlay: () => void;
}
const FilterPanel: React.FC<FilterPanelProps> = (props) => {
    return (
        <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-lg shadow-lg p-4 z-[1000]">
            <div className="space-y-4">
                <div>
                    <div className="flex justify-between items-center">
                        <label className="font-semibold text-gray-700 text-sm">AI Predictions</label>
                        <button onClick={props.onTogglePredictions} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${props.showPredictions ? 'bg-emerald-600' : 'bg-gray-200'}`}>
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${props.showPredictions ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </div>
                <div className="border-t border-gray-200 -mx-4"></div>
                <div>
                     <label className="font-semibold text-gray-700 text-sm mb-2 block">Visible Animals</label>
                     <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                        {props.animalTypes.map(animalName => (
                             <div key={animalName} className="flex items-center">
                                <input type="checkbox" id={`animal-${animalName}`} checked={props.visibleAnimals[animalName] ?? false} onChange={() => props.onToggleAnimal(animalName)} className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"/>
                                <label htmlFor={`animal-${animalName}`} className="ml-2 block text-sm text-gray-600 truncate">{animalName}</label>
                            </div>
                        ))}
                     </div>
                </div>
                <div className="border-t border-gray-200 -mx-4"></div>
                <div>
                     <div className="flex justify-between items-center">
                        <label className="font-semibold text-gray-700 text-sm">Nearby Alert Zone</label>
                        <button onClick={props.onToggleNearbyRadius} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${props.showNearbyRadius ? 'bg-emerald-600' : 'bg-gray-200'}`}>
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${props.showNearbyRadius ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </div>
                <div className="border-t border-gray-200 -mx-4"></div>
                <div>
                     <div className="flex justify-between items-center">
                        <label className="font-semibold text-gray-700 text-sm flex items-center gap-2">
                            <RainIcon className="w-5 h-5 text-gray-500" />
                            <span>Weather Radar</span>
                        </label>
                        <button onClick={props.onToggleWeatherOverlay} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${props.showWeatherOverlay ? 'bg-emerald-600' : 'bg-gray-200'}`}>
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${props.showWeatherOverlay ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Show precipitation overlay.</p>
                </div>
            </div>
        </div>
    );
}

const policeSvgPath = `<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />`;
const rangerSvgPath = `<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />`;

interface SafePlaceMarkerProps {
    place: SafePlace;
}
const SafePlaceMarker: React.FC<SafePlaceMarkerProps> = ({ place }) => {
    const icon = useMemo(() => {
        const isPolice = place.type === 'police';
        const bgColor = isPolice ? 'bg-blue-600' : 'bg-green-700';
        const pulseColor = isPolice ? '37, 99, 235' : '21, 128, 61'; // blue-600, green-700
        const svgPath = isPolice ? policeSvgPath : rangerSvgPath;
        const iconHtml = `
            <div 
                class="relative flex items-center justify-center w-8 h-8 rounded-full border-2 border-white shadow-lg ${bgColor} safe-place-marker"
                style="--safe-place-color-rgb: ${pulseColor};"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5 text-white">
                    ${svgPath}
                </svg>
            </div>
        `;
        return new L.DivIcon({
            html: iconHtml,
            className: 'leaflet-div-icon',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });
    }, [place.type]);

    return (
        <Marker position={[place.lat, place.lon]} icon={icon} zIndexOffset={500}>
            <Popup>
                <div className="space-y-2 w-48">
                    <div>
                        <b className="font-bold text-base">{place.name}</b><br/>
                        <span className="capitalize text-sm text-gray-600">{place.type}</span>
                    </div>
                    {place.address && (
                        <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Address</p>
                            <p className="text-sm text-gray-800">{place.address}</p>
                        </div>
                    )}
                    {place.hours && (
                         <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Hours</p>
                            <p className="text-sm text-gray-800">{place.hours}</p>
                        </div>
                    )}
                    {place.phone && (
                         <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</p>
                            <a href={`tel:${place.phone}`} className="text-sm text-emerald-600 hover:underline">{place.phone}</a>
                        </div>
                    )}
                </div>
            </Popup>
        </Marker>
    );
};

const MultiModalSummary: React.FC<{
    currentMode: TravelMode;
    currentRoute: Route;
    otherModesInfo: Partial<Record<TravelMode, { distanceKm: number, durationMinutes: number }>>;
    onModeChange: (mode: TravelMode) => void;
    isRecalculating: boolean;
}> = ({ currentMode, currentRoute, otherModesInfo, onModeChange, isRecalculating }) => {
    const travelModes: { mode: TravelMode; icon: React.ReactNode; label: string }[] = [
        { mode: 'car', icon: <CarIcon className="w-6 h-6" />, label: 'Car' },
        { mode: 'walk', icon: <WalkIcon className="w-6 h-6" />, label: 'Walk' },
        { mode: 'bike', icon: <BikeIcon className="w-6 h-6" />, label: 'Bike' },
        { mode: 'bus', icon: <BusIcon className="w-6 h-6" />, label: 'Bus' },
    ];
    const allModesInfo = { ...otherModesInfo, [currentMode]: { distanceKm: currentRoute.distanceKm, durationMinutes: currentRoute.durationMinutes } };

    return (
        <div className="grid grid-cols-4 gap-2">
            {travelModes.map(({ mode, icon, label }) => {
                 const info = allModesInfo[mode];
                 const isCurrent = mode === currentMode;
                 return (
                    <button
                        key={mode}
                        onClick={() => onModeChange(mode)}
                        disabled={isRecalculating}
                        className={`flex flex-col items-center justify-center p-2 rounded-lg transition-colors text-sm ${isCurrent ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                        {isRecalculating && isCurrent ? <SpinnerIcon className="w-6 h-6" /> : icon}
                        {info ? (
                             <span className="font-semibold text-xs mt-1">{info.durationMinutes} min</span>
                        ): <SpinnerIcon className="w-4 h-4 mt-1" />}
                    </button>
                 )
            })}
        </div>
    );
}

interface RouteSummaryPanelProps {
    route: Route;
    alternativeRoute: Route | null;
    safePlaces: SafePlace[];
    animalsNearRoute: AnimalPrediction[];
    otherModesInfo: Partial<Record<TravelMode, { distanceKm: number, durationMinutes: number }>>;
    onClose: () => void;
    onStartNavigation: (route: Route) => void;
    onCalculateSafeRoute: (start: Location | string, end: Location | string, radius: number, mode: TravelMode) => Promise<Route | null>;
    nearbyRadiusKm: number;
    onChangeRoute: () => void;
}
const RouteSummaryPanel: React.FC<RouteSummaryPanelProps> = (props) => {
    const { route, alternativeRoute, safePlaces, animalsNearRoute, otherModesInfo, onClose, onStartNavigation, onCalculateSafeRoute, nearbyRadiusKm, onChangeRoute } = props;
    const [isRecalculating, setIsRecalculating] = useState(false);

    const handleModeChange = async (newMode: TravelMode) => {
        if (newMode === route.mode || isRecalculating) return;
        setIsRecalculating(true);
        await onCalculateSafeRoute(route.start, route.end, nearbyRadiusKm, newMode);
        setIsRecalculating(false);
    };
    
    return (
        <div className="absolute bottom-0 left-0 right-0 z-[1100] p-4 bg-white rounded-t-2xl shadow-2xl animate-slide-up">
            <div className="flex justify-between items-center mb-3">
                <h2 className="text-xl font-bold text-gray-800">Your Route</h2>
                <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><XIcon /></button>
            </div>
            {route.isHighRisk && (
                <div className="mb-3 p-3 bg-red-100 border border-red-200 text-red-800 rounded-lg text-xs flex items-center gap-2">
                    <AlertTriangleIcon className="w-6 h-6 flex-shrink-0" />
                    <span><b>Warning:</b> High wildlife risk detected. No reasonable safer alternative was found. Proceed with caution.</span>
                </div>
            )}
            {alternativeRoute && (
                 <div className="mb-3 p-3 bg-blue-100 border border-blue-200 text-blue-800 rounded-lg text-xs flex items-center gap-2">
                    <InfoIcon className="w-6 h-6 flex-shrink-0" />
                    <span>
                        {alternativeRoute.isHighRisk
                            ? `A faster, high-risk alternative (${alternativeRoute.durationMinutes} min) is shown as a dashed line.`
                            : `A safer, but longer alternative is shown as a dashed line.`
                        }
                    </span>
                </div>
            )}
            <div className="flex justify-around items-center text-center mb-4 p-3 bg-gray-50 rounded-lg">
                <div>
                    <p className="text-2xl font-bold text-gray-800">{route.distanceKm}</p>
                    <p className="text-xs text-gray-500">KM</p>
                </div>
                <div>
                    <p className="text-2xl font-bold text-gray-800">{route.durationMinutes}</p>
                    <p className="text-xs text-gray-500">MINS</p>
                </div>
                 <div>
                    <p className="text-2xl font-bold text-blue-600">{safePlaces.length}</p>
                    <p className="text-xs text-gray-500">SAFE SPOTS</p>
                </div>
            </div>
            
            <MultiModalSummary 
                currentMode={route.mode} 
                currentRoute={route}
                otherModesInfo={otherModesInfo} 
                onModeChange={handleModeChange}
                isRecalculating={isRecalculating}
            />

            {animalsNearRoute.length > 0 && (
                <div className="my-4 px-2">
                    <p className="text-sm font-semibold text-gray-700 mb-2">Wildlife near your route:</p>
                    <div className="flex space-x-2 overflow-x-auto pb-2">
                        {animalsNearRoute.map(animal => (
                            <div key={animal.id} className="flex-shrink-0 flex items-center gap-2 bg-yellow-100 text-yellow-800 text-xs font-semibold px-2 py-1 rounded-full">
                                <span>{animal.emoji}</span>
                                <span>{animal.common} (~{animal.distanceToPathKm?.toFixed(1)} km)</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-4 space-y-3">
                 <button 
                    onClick={() => onStartNavigation(route)} 
                    className="w-full text-center p-3 bg-emerald-600 text-white font-semibold rounded-lg shadow hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                >
                    <PlayIcon className="w-5 h-5" /> Start Navigation
                </button>
                <div className="grid grid-cols-2 gap-3">
                    <button 
                        onClick={onChangeRoute}
                        className="w-full text-center p-3 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center gap-1"
                    >
                        <SyncIcon className="w-5 h-5"/> Change Route
                    </button>
                    <button 
                        onClick={onClose} 
                        className="w-full text-center p-3 bg-white text-gray-700 font-semibold rounded-lg shadow-sm border border-gray-200 hover:bg-gray-100 transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
            <style>{`
                @keyframes slide-up {
                    from { transform: translateY(100%); }
                    to { transform: translateY(0); }
                }
                .animate-slide-up { animation: slide-up 0.3s ease-out forwards; }
            `}</style>
        </div>
    );
};

// --- Main MapView Component ---

interface MapViewProps {
    status: AppState;
    message: string;
    userLocation: Location | null;
    predictions: AnimalPrediction[];
    safeRoute: Route | null;
    alternativeRoute: Route | null;
    safePlaces: SafePlace[];
    onLocationSubmit: (location: Location | string) => void;
    suggestions: Location[];
    isSuggesting: boolean;
    onFetchSuggestions: (query: string) => void;
    onClearSuggestions: () => void;
    routeStatus: AppState;
    routeMessage: string;
    onCalculateSafeRoute: (start: Location | string, end: Location | string, radius: number, mode: TravelMode) => Promise<Route | null>;
    getCurrentLocation: () => Promise<Location>;
    isNavigating: boolean;
    liveLocation: Location | null;
    navigationStats: NavigationStats | null;
    onStartNavigation: (route: Route) => void;
    onStopNavigation: () => void;
    navigationAlert: NavigationAlert | null;
    clearNavigationAlert: () => void;
    closestPathIndex: number;
    animationProgress: number;
    isPlaying: boolean;
    onPlay: () => void;
    onPause: () => void;
    nearbyRadiusKm: number;
    isApproachingStart: boolean;
    emergencyRoute: Route | null;
    alternativeEmergencyRoute: Route | null;
    onCalculateRouteToNearestSafePlace: () => void;
    weatherAlert: string | null;
    clearWeatherAlert: () => void;
    animalsNearRoute: AnimalPrediction[];
    onViewDetails: (animal: AnimalPrediction) => void;
    searchHistory: string[];
    otherModesInfo: Partial<Record<TravelMode, { distanceKm: number, durationMinutes: number }>>;
}

const MapView: React.FC<MapViewProps> = (props) => {
    const { 
        status, message, userLocation, predictions, safeRoute, alternativeRoute, safePlaces,
        onLocationSubmit, suggestions, isSuggesting,
        onFetchSuggestions, onClearSuggestions, routeStatus,
        routeMessage, onCalculateSafeRoute, getCurrentLocation,
        isNavigating, liveLocation, navigationStats,
        onStartNavigation, onStopNavigation, navigationAlert,
        clearNavigationAlert, closestPathIndex,
        animationProgress, isPlaying, onPlay, onPause,
        nearbyRadiusKm, isApproachingStart,
        emergencyRoute, alternativeEmergencyRoute, onCalculateRouteToNearestSafePlace,
        weatherAlert, clearWeatherAlert, animalsNearRoute, onViewDetails,
        searchHistory, otherModesInfo
    } = props;

    const [map, setMap] = useState<L.Map | null>(null);
    const [isRoutePlannerOpen, setIsRoutePlannerOpen] = useState(false);
    const [showFilters, setShowFilters] = useState(false);

    const [visibleAnimals, setVisibleAnimals] = useLocalStorage<Record<string, boolean>>('visibleAnimals', {});
    const [showPredictions, setShowPredictions] = useLocalStorage('showPredictions', true);
    const [showNearbyRadius, setShowNearbyRadius] = useLocalStorage('showNearbyRadius', true);
    const [showWeatherOverlay, setShowWeatherOverlay] = useLocalStorage('showWeatherOverlay', false);
    
    const animalTypes = useMemo(() => Array.from(new Set(predictions.map(p => p.common))), [predictions]);

    useEffect(() => {
        const initialVisibility: Record<string, boolean> = {};
        animalTypes.forEach(type => {
            if (visibleAnimals[type] === undefined) {
                initialVisibility[type] = true;
            }
        });
        if (Object.keys(initialVisibility).length > 0) {
            setVisibleAnimals(prev => ({ ...initialVisibility, ...prev }));
        }
    }, [animalTypes, visibleAnimals, setVisibleAnimals]);
    
    const displayedPredictions = useMemo(() => {
        return predictions.filter(p => visibleAnimals[p.common]);
    }, [predictions, visibleAnimals]);
    
    const [isSummaryVisible, setIsSummaryVisible] = useState(true);
    useEffect(() => {
        if(safeRoute) setIsSummaryVisible(true);
    }, [safeRoute]);

    const handleClearRoute = useCallback(() => {
        setIsSummaryVisible(false);
    }, []);
    
    const handleChangeRoute = useCallback(() => {
        setIsSummaryVisible(false);
        setIsRoutePlannerOpen(true);
    }, []);

    return (
        <div className="relative h-full w-full">
            <MapContainer center={MAP_CENTER} zoom={MAP_ZOOM} className="h-full w-full" scrollWheelZoom={true}>
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                />
                <MapController {...{ userLocation, route: safeRoute, isNavigating, liveLocation }} />
                <MapEvents setMap={setMap} />

                {userLocation && !isNavigating && <UserMarker location={userLocation} />}
                {isNavigating && liveLocation && <LiveUserMarker location={liveLocation} />}

                {safeRoute && (
                    <>
                        <Polyline 
                            positions={safeRoute.path} 
                            color={safeRoute.isHighRisk ? "#f97316" : "#10b981"} 
                            weight={6} 
                            opacity={0.8} 
                        />
                        <RouteMarker location={safeRoute.start} type="start" />
                        <RouteMarker location={safeRoute.end} type="end" />
                    </>
                )}
                {alternativeRoute && (
                     <Polyline
                        positions={alternativeRoute.path}
                        color={alternativeRoute.isHighRisk ? "#f97316" : "#3b82f6"}
                        weight={5}
                        opacity={0.7}
                        dashArray="10, 10"
                    />
                )}
                {alternativeEmergencyRoute && <Polyline positions={alternativeEmergencyRoute.path} color="#3b82f6" weight={6} dashArray="5, 5" opacity={0.7} />}

                {showPredictions && displayedPredictions.map(p => (
                    <React.Fragment key={p.id}>
                        <Circle
                            center={[p.current.lat, p.current.lon]}
                            radius={
                                p.riskLevel === 'High' ? 1500 :
                                p.riskLevel === 'Medium' ? 1000 : 500
                            }
                            pathOptions={{
                                color:
                                    p.riskLevel === 'High' ? '#ef4444' : // red-500
                                    p.riskLevel === 'Medium' ? '#f97316' : // orange-500
                                    '#eab308', // yellow-500
                                fillColor:
                                    p.riskLevel === 'High' ? '#ef4444' :
                                    p.riskLevel === 'Medium' ? '#f97316' :
                                    '#eab308',
                                fillOpacity: 0.2,
                                weight: 1,
                            }}
                        >
                            <Popup>
                                <b>{p.riskLevel} Risk Zone</b><br/>
                                {p.common} sighted here recently.
                            </Popup>
                        </Circle>
                        <Polyline positions={p.fullPath} color={p.color} dashArray="5, 10" weight={2} />
                        <AnimatedAnimalMarker prediction={p} progress={animationProgress} onViewDetails={onViewDetails} />
                    </React.Fragment>
                ))}
                
                {safePlaces.map(place => <SafePlaceMarker key={place.id} place={place} />)}

                {showNearbyRadius && userLocation && !isNavigating && (
                    <Circle center={[userLocation.lat, userLocation.lon]} radius={RADIUS_KM * 1000} pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.1, weight: 1 }} />
                )}
                
                {showWeatherOverlay && <WeatherRadarOverlay />}

            </MapContainer>
            
            <div className="absolute top-4 right-4 z-[1000] flex items-start gap-2">
                <button 
                    onClick={isPlaying ? onPause : onPlay} 
                    className="p-3 bg-white text-gray-700 rounded-lg shadow-lg hover:bg-gray-100 transition-colors flex items-center justify-center"
                    aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
                >
                    {isPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />}
                </button>
                 <div className="relative">
                    <button onClick={() => setShowFilters(f => !f)} className="p-3 bg-white rounded-lg shadow-lg text-gray-500 hover:text-gray-800 transition-colors">
                        <FilterIcon />
                    </button>
                    {showFilters && <FilterPanel 
                        animalTypes={animalTypes}
                        visibleAnimals={visibleAnimals}
                        onToggleAnimal={(commonName) => setVisibleAnimals(prev => ({...prev, [commonName]: !prev[commonName]}))}
                        showPredictions={showPredictions}
                        onTogglePredictions={() => setShowPredictions(p => !p)}
                        showNearbyRadius={showNearbyRadius}
                        onToggleNearbyRadius={() => setShowNearbyRadius(r => !r)}
                        showWeatherOverlay={showWeatherOverlay}
                        onToggleWeatherOverlay={() => setShowWeatherOverlay(w => !w)}
                    />}
                </div>
            </div>
            
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
                <div className="flex justify-center">
                    {!safeRoute && !isNavigating && (
                        <button onClick={() => setIsRoutePlannerOpen(true)} className="pointer-events-auto flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white font-semibold rounded-full shadow-lg hover:bg-emerald-700 transition-transform hover:scale-105">
                            <PaperPlaneIcon className="w-5 h-5" />
                            <span>Plan a Safe Route</span>
                        </button>
                    )}
                </div>
            </div>

            {navigationAlert && <NavigationAlertBanner alert={navigationAlert} onClose={clearNavigationAlert} alternativeRoute={alternativeEmergencyRoute} onActivateAlternative={onStartNavigation} />}
            {weatherAlert && <WeatherAlertBanner message={weatherAlert} onClose={clearWeatherAlert} />}
            
            {isNavigating && navigationStats && <NavigationInfoPanel stats={navigationStats} onStop={onStopNavigation} onFindSafePlace={onCalculateRouteToNearestSafePlace} />}
            
            {isSummaryVisible && !isNavigating && safeRoute && <RouteSummaryPanel 
                route={safeRoute}
                alternativeRoute={alternativeRoute}
                safePlaces={safePlaces}
                animalsNearRoute={animalsNearRoute}
                otherModesInfo={otherModesInfo}
                onClose={handleClearRoute}
                onStartNavigation={onStartNavigation}
                onCalculateSafeRoute={onCalculateSafeRoute}
                nearbyRadiusKm={nearbyRadiusKm}
                onChangeRoute={handleChangeRoute}
            />}

            <RoutePlannerSheet 
                isOpen={isRoutePlannerOpen}
                onClose={() => setIsRoutePlannerOpen(false)}
                currentRoute={safeRoute}
                {...{onCalculateSafeRoute, routeStatus, routeMessage, suggestions, isSuggesting, onFetchSuggestions, onClearSuggestions, getCurrentLocation, nearbyRadiusKm, searchHistory}}
            />
        </div>
    );
};

export default MapView;