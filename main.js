import { initUI, updateUI, showMessage, setUnit, getUnit } from 'ui';
import { GpsService } from 'gps';
import { Game } from 'game';
import { CONVERSION_FACTORS } from 'config';

const startStopBtn = document.getElementById('start-stop-btn');
const startStopIcon = document.getElementById('start-stop-icon');
const unitSwitch = document.getElementById('unit-switch');
const enableLocationBtn = document.getElementById('enable-location-btn');
const startupOverlay = document.getElementById('startup-overlay');
const startupError = document.getElementById('startup-error');
const appElement = document.getElementById('app');

let isRunning = false;
let game;
let gps;
let audioContext;
let pointSoundBuffer;
let stationarySoundBuffer;
let goodDrivingSoundBuffer;
let speedingSoundBuffer;

async function setupAudio() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Load point sound
    const pointResponse = await fetch('point_sound.mp3');
    const pointArrayBuffer = await pointResponse.arrayBuffer();
    pointSoundBuffer = await audioContext.decodeAudioData(pointArrayBuffer);
    
    // Load stationary sound
    const stationaryResponse = await fetch('stationary_sound.mp3');
    const stationaryArrayBuffer = await stationaryResponse.arrayBuffer();
    stationarySoundBuffer = await audioContext.decodeAudioData(stationaryArrayBuffer);
    
    // Load good driving sound
    const goodResponse = await fetch('good_driving_sound.mp3');
    const goodArrayBuffer = await goodResponse.arrayBuffer();
    goodDrivingSoundBuffer = await audioContext.decodeAudioData(goodArrayBuffer);
    
    // Load speeding sound
    const speedingResponse = await fetch('speeding_sound.mp3');
    const speedingArrayBuffer = await speedingResponse.arrayBuffer();
    speedingSoundBuffer = await audioContext.decodeAudioData(speedingArrayBuffer);
}

function playSound(buffer) {
    if (!audioContext || !buffer) return;
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);
}

function playPointSound() {
    if (!audioContext || !pointSoundBuffer) return;
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const source = audioContext.createBufferSource();
    source.buffer = pointSoundBuffer;
    source.connect(audioContext.destination);
    source.start(0);
}

function handlePositionUpdate(pos) {
    const coords = pos.coords;
    const speed = coords.speed;

    if (speed === null) {
        showMessage("Waiting for speed data...");
        return;
    }

    const currentUnit = getUnit();
    const convertedSpeed = speed * CONVERSION_FACTORS[currentUnit];
    
    const oldState = game.getState();
    game.updateSpeed(convertedSpeed);
    const { score, speedLimit, message, status } = game.getState();
    
    console.log(`Current State - Speed: ${Math.round(convertedSpeed)} ${currentUnit}, Limit: ${speedLimit} ${currentUnit}, Status: ${status}`);
    
    // Play status change sounds
    if (oldState.status !== status && status !== 'NEUTRAL') {
        if (status === 'GOOD') {
            playSound(goodDrivingSoundBuffer);
        } else if (status === 'BAD') {
            playSound(speedingSoundBuffer);
        } else if (status === 'STATIONARY') {
            playSound(stationarySoundBuffer);
        }
    }
    
    const oldScore = parseInt(document.getElementById('score').textContent, 10);
    if(score > oldScore) {
        playSound(pointSoundBuffer);
    }

    updateUI({
        lat: coords.latitude,
        lon: coords.longitude,
        speed: Math.round(convertedSpeed),
        score,
        speedLimit,
        message,
        status,
        unit: currentUnit
    });
}

function handlePositionError(err) {
    console.error(`GPS Error: ${err.message}`);
    showMessage(`GPS Error: ${err.message}`);
    stopGame();
}

async function startGame() {
    if (isRunning) return;
    
    // Resume audio context on user gesture
    if(audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    try {
        await gps.start(handlePositionUpdate, handlePositionError);
        isRunning = true;
        game.start();
        startStopIcon.src = 'pause_icon.png';
        showMessage("Drive safely!");
        unitSwitch.disabled = true;
    } catch (error) {
        showMessage(error.message);
    }
}

function stopGame() {
    if (!isRunning) return;
    gps.stop();
    game.stop();
    isRunning = false;
    startStopIcon.src = 'play_icon.png';
    showMessage("Game paused. Press Start to resume.");
    unitSwitch.disabled = false;
}

function toggleGame() {
    if (isRunning) {
        stopGame();
    } else {
        startGame();
    }
}

function handleUnitChange() {
    const newUnit = unitSwitch.checked ? 'KPH' : 'MPH';
    setUnit(newUnit);
    game.setUnit(newUnit);
    updateUI({unit: newUnit, speedLimit: game.getState().speedLimit, speed: 0});
}

async function initGame() {
    try {
        // 1. Get initial position to confirm permission and location
        const initialPos = await gps.requestLocation();
        
        // 2. Hide overlay and show app
        startupOverlay.style.display = 'none';
        appElement.classList.remove('hidden');

        // 3. Initialize UI with the first location
        initUI(initialPos.coords.latitude, initialPos.coords.longitude);
        updateUI({
            lat: initialPos.coords.latitude,
            lon: initialPos.coords.longitude,
        });

        // 4. Setup the rest of the game
        const initialUnit = unitSwitch.checked ? 'KPH' : 'MPH';
        setUnit(initialUnit);
        game = new Game(initialUnit);
        gps.onSpeedLimitFound = (limitData) => { // limitData is { limit, isKph } or null
            game.setSpeedLimit(limitData);
        };

        // 5. Setup listeners
        startStopBtn.addEventListener('click', toggleGame);
        unitSwitch.addEventListener('change', handleUnitChange);
        await setupAudio();

    } catch (error) {
        startupError.textContent = error.message;
        console.error("Initialization failed:", error);
    }
}


function init() {
    gps = new GpsService();
    enableLocationBtn.addEventListener('click', initGame);
}

init();