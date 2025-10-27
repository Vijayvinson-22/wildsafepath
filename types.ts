import { LocationIcon } from './icons';

export type TravelMode = 'car' | 'bike' | 'bus' | 'walk';

export interface Location {
    lat: number;
    lon: number;
    name: string;
}

export interface Sighting {
    lat: number;
    lon: number;
    image?: string;
    dist?: number; // Distance from user
}

export interface PredictionPoint {
    lat: number;
    lon: number;
    addr?: string;
}

export interface AnimalPrediction {
    id: string;
    scientific: string;
    common: string;
    emoji: string;
    color: string;
    riskLevel: 'High' | 'Medium' | 'Low';
    image?: string;
    current: PredictionPoint & { dist_km: number };
    preds: PredictionPoint[];
    fullPath: [number, number][];
    distanceToPathKm?: number;
}

export interface Route {
    path: [number, number][]; // [[lat, lon], ...]
    distanceKm: number;
    durationMinutes: number;
    start: Location;
    end: Location;
    mode: TravelMode;
    isHighRisk?: boolean;
}

export interface NavigationStats {
    remainingKm: number;
    etaMinutes: number;
    progressPercent: number;
}

export interface NavigationAlert {
    animal: AnimalPrediction | null;
    message: string;
}

export interface ChatMessage {
    role: 'user' | 'model';
    text: string;
}

export enum AppState {
    IDLE = 'idle',
    LOADING = 'loading',
    SUCCESS = 'success',
    ERROR = 'error',
}

export enum View {
    LOGIN = 'login',
    HOME = 'home',
    MAP = 'map',
    GUIDE = 'guide',
    REPORTS = 'reports',
    PROFILE = 'profile',
}

export interface Report {
    id: number;
    wildlifeType: string;
    location: string;
    description: string;
    timestamp: string;
}

export interface User {
    name: string;
    email: string;
    avatarId: string; // References an ID from the AVATARS constant
    nearbyRadiusKm?: number;
    isNewUser?: boolean;
}

export interface WeatherData {
    temperature: number;
    weatherCode: number;
    windSpeed: number;
    isDay: number;
}

export interface SafePlace {
    id: number;
    lat: number;
    lon: number;
    type: 'police' | 'ranger';
    name: string;
    address?: string;
    hours?: string;
    phone?: string;
}