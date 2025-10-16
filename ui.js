let map, userMarker, unit = 'MPH';

const UIElements = {
    score: document.getElementById('score'),
    speed: document.getElementById('speed'),
    speedUnit: document.getElementById('speed-unit'),
    speedLimit: document.getElementById('speed-limit'),
    speedLimitUnit: document.getElementById('speed-limit-unit'),
    message: document.getElementById('message'),
    speedometer: document.getElementById('speedometer'),
};

const statusColors = {
    GOOD: 'var(--good-driving)',
    BAD: 'var(--bad-driving)',
    NEUTRAL: 'var(--neutral-driving)',
};

export function getUnit() {
    return unit;
}

export function setUnit(newUnit) {
    unit = newUnit;
}

export function initUI() {
    map = L.map('map').setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    const userIcon = L.icon({
        iconUrl: 'user_location_icon.png',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
    });
    
    userMarker = L.marker([0, 0], { icon: userIcon }).addTo(map);
    showMessage("Waiting for location...");
}

export function updateUI(state) {
    if (state.lat && state.lon) {
        const newLatLng = new L.LatLng(state.lat, state.lon);
        userMarker.setLatLng(newLatLng);
        map.panTo(newLatLng);
    }
    
    if (state.speed !== undefined) {
        UIElements.speed.textContent = state.speed;
    }

    if (state.score !== undefined) {
        UIElements.score.textContent = state.score;
    }

    if (state.speedLimit !== undefined) {
        UIElements.speedLimit.textContent = state.speedLimit !== null ? state.speedLimit : '--';
    }

    if(state.message) {
        showMessage(state.message);
    }
    
    if(state.status) {
        UIElements.speedometer.style.borderColor = statusColors[state.status];
    }

    if(state.unit) {
        UIElements.speedUnit.textContent = state.unit;
        UIElements.speedLimitUnit.textContent = state.unit;
    }
}

export function showMessage(msg) {
    UIElements.message.textContent = msg;
}

