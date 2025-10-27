import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { AVATARS, NEARBY_KM } from '../constants';
import AvatarSelectionModal from './AvatarSelectionModal';
import { EditIcon, PaperPlaneIcon, ReportIcon, ChartIcon } from './icons';

interface ProfileViewProps {
    user: User;
    onLogout: () => void;
    onUpdateUser: (user: User) => void;
}

const StatCard: React.FC<{ icon: React.ReactNode; value: string | number; label: string }> = ({ icon, value, label }) => (
    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200/80 flex flex-col items-center justify-center text-center">
        <div className="text-emerald-600 mb-2">{icon}</div>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</p>
    </div>
);

const ProfileView: React.FC<ProfileViewProps> = ({ user, onLogout, onUpdateUser }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState(user.name);
    const [notificationPermission, setNotificationPermission] = useState('Notification' in window ? Notification.permission : 'denied');
    
    useEffect(() => {
        const handleFocus = () => {
            if ('Notification' in window) {
                setNotificationPermission(Notification.permission);
            }
        };
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }, []);

    const requestNotifications = async () => {
        if (!('Notification' in window)) {
            alert('This browser does not support desktop notifications.');
            return;
        }
        const permission = await Notification.requestPermission();
        setNotificationPermission(permission);
        if (permission === 'granted') {
            new Notification('Notifications Enabled!', {
                body: 'You will now receive wildlife and safety alerts.',
            });
        }
    };

    const handleSendTestNotification = () => {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Wildlife Alert: Leopard 🐆', {
                body: 'Leopard detected near your path. Last sighted 1.2 km from the route. Proceed with caution.',
            });
        }
    };

    const AvatarComponent = AVATARS[user.avatarId]?.icon || AVATARS['tiger'].icon;

    const handleAvatarSave = (avatarId: string) => {
        onUpdateUser({ ...user, avatarId });
        setIsModalOpen(false);
    };

    const handleRadiusChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newRadius = parseInt(e.target.value, 10);
        onUpdateUser({ ...user, nearbyRadiusKm: newRadius });
    };

    const handleNameEditClick = () => {
        setEditedName(user.name);
        setIsEditingName(true);
    };

    const handleNameSave = () => {
        if (editedName.trim()) {
            onUpdateUser({ ...user, name: editedName.trim() });
        }
        setIsEditingName(false);
    };

    const handleNameCancel = () => {
        setIsEditingName(false);
        setEditedName(user.name);
    };

    const nearbyRadius = user.nearbyRadiusKm ?? NEARBY_KM;

    return (
        <div className="h-full w-full bg-gray-50 overflow-y-auto p-4 pb-24">
            <div className="max-w-2xl mx-auto space-y-6">
                <header className="text-center">
                    <div className="relative w-24 h-24 mx-auto">
                        <AvatarComponent className="w-full h-full rounded-full" />
                        <button 
                            onClick={() => setIsModalOpen(true)}
                            className="absolute bottom-0 right-0 bg-emerald-600 text-white rounded-full p-1.5 border-2 border-gray-50 hover:bg-emerald-700 transition-transform hover:scale-110"
                            aria-label="Edit profile picture"
                        >
                            <EditIcon className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="mt-4">
                        {!isEditingName ? (
                            <div className="flex justify-center items-center gap-2">
                                <h1 className="text-2xl font-bold text-gray-800">{user.name}</h1>
                                <button
                                    onClick={handleNameEditClick}
                                    className="p-1 text-gray-500 hover:text-emerald-600 rounded-full transition-colors"
                                    aria-label="Edit name"
                                >
                                    <EditIcon className="w-5 h-5" />
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-2">
                                <input
                                    type="text"
                                    value={editedName}
                                    onChange={(e) => setEditedName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleNameSave()}
                                    className="w-full max-w-xs px-3 py-2 text-center text-2xl font-bold text-gray-800 bg-white border border-emerald-500 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                    autoFocus
                                />
                                <div className="flex justify-center gap-2">
                                    <button onClick={handleNameSave} className="px-4 py-1.5 text-sm font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700">Save</button>
                                    <button onClick={handleNameCancel} className="px-4 py-1.5 text-sm font-semibold text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300">Cancel</button>
                                </div>
                            </div>
                        )}
                    </div>
                    <p className="text-sm text-gray-500">{user.email}</p>
                    <div className="mt-2 inline-flex items-center px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                        Safety Score: 94%
                    </div>
                </header>

                <div>
                    <h2 className="text-base font-bold text-gray-700 mb-3">Your Safety Journey</h2>
                    <div className="grid grid-cols-3 gap-3">
                        <StatCard icon={<PaperPlaneIcon className="w-6 h-6" />} value="47" label="Safe Trips" />
                        <StatCard icon={<ChartIcon className="w-6 h-6" />} value="312" label="Miles Tracked" />
                        <StatCard icon={<ReportIcon className="w-6 h-6" />} value="12" label="Reports" />
                    </div>
                </div>

                <div>
                    <h2 className="text-base font-bold text-gray-700 mb-3">Settings</h2>
                    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200/80 space-y-4">
                        <div>
                            <label htmlFor="radius-slider" className="block text-sm font-medium text-gray-700">
                                Nearby Alert Radius
                            </label>
                            <div className="flex items-center gap-4 mt-2">
                                <input
                                    id="radius-slider"
                                    type="range"
                                    min="1"
                                    max="20"
                                    step="1"
                                    value={nearbyRadius}
                                    onChange={handleRadiusChange}
                                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                />
                                <span className="font-semibold text-emerald-600 w-16 text-center">{nearbyRadius} km</span>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                                Adjust the distance for "nearby" wildlife alerts.
                            </p>
                        </div>
                        <div className="pt-4 border-t border-gray-200">
                            <label className="block text-sm font-medium text-gray-700">
                                Browser Alerts
                            </label>
                            <p className="text-xs text-gray-500 mt-1 mb-3">
                                Receive alerts for wildlife and severe weather during navigation.
                            </p>
                            {notificationPermission === 'granted' && (
                                <div className="space-y-3">
                                    <div className="text-sm text-emerald-700 bg-emerald-50 p-3 rounded-md border border-emerald-200">
                                        Notifications are enabled in your browser.
                                    </div>
                                    <button onClick={handleSendTestNotification} className="w-full text-center p-2 bg-white text-emerald-700 font-semibold rounded-lg border border-emerald-200 hover:bg-emerald-50 transition-colors text-sm">
                                        Send Test Notification
                                    </button>
                                </div>
                            )}
                            {notificationPermission === 'default' && (
                                <button onClick={requestNotifications} className="w-full text-center p-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition-colors">
                                    Enable Notifications
                                </button>
                            )}
                            {notificationPermission === 'denied' && (
                                <div className="text-sm text-red-700 bg-red-50 p-3 rounded-md border border-red-200">
                                    Notifications are blocked. You'll need to enable them in your browser settings to use this feature.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                
                <div>
                    <h2 className="text-base font-bold text-gray-700 mb-3">Achievements</h2>
                    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200/80">
                        <p className="text-center text-gray-500 text-sm py-4">Achievements feature coming soon!</p>
                    </div>
                </div>
                
                <div className="pt-4">
                     <button 
                        onClick={onLogout}
                        className="w-full text-center p-3 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition-colors"
                     >
                        Logout
                     </button>
                </div>

                {isModalOpen && (
                    <AvatarSelectionModal
                        currentAvatarId={user.avatarId}
                        onClose={() => setIsModalOpen(false)}
                        onSave={handleAvatarSave}
                    />
                )}
            </div>
        </div>
    );
};

export default ProfileView;