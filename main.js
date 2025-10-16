import { initUI, updateUI, showMessage, setUnit, getUnit } from 'ui';
import { GpsService } from 'gps';
import { Game } from 'game';
import { CONVERSION_FACTORS } from 'config';

const startStopBtn = document.getElementById('start-stop-btn');
const startStopIcon = document.getElementById('start-stop-icon');
const unitSwitch = document.getElementById('unit-switch');

let isRunning = false;
let game;
let gps;
let audioContext;
let pointSoundBuffer;

async function setupAudio() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const response = await fetch('point_sound.mp3');
    const arrayBuffer = await response.arrayBuffer();
    pointSoundBuffer = await audioContext.decodeAudioData(arrayBuffer);
}

function playPointSound() {
    if (!audioContext || !pointSoundBuffer) return;
    const source = audioContext.createBufferSource();
    source.buffer = pointSoundBuffer;
    source.connect(audioContext.destination);
    source.start(0);
}

function handlePositionUpdate(pos) {
    const coords = pos.coords;
    const speed = coords.speed; // meters per second

    if (speed === null) {
        showMessage("Waiting for speed data...");
        return;
    }

    const currentUnit = getUnit();
    const convertedSpeed = speed * CONVERSION_FACTORS[currentUnit];
    
    game.updateSpeed(convertedSpeed);
    const { score, speedLimit, message, status } = game.getState();
    
    const oldScore = parseInt(document.getElementById('score').textContent, 10);
    if(score > oldScore) {
        playPointSound();
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

function init() {
    initUI();
    const initialUnit = unitSwitch.checked ? 'KPH' : 'MPH';
    setUnit(initialUnit);
    game = new Game(initialUnit);
    gps = new GpsService(initialUnit);
    game.onSpeedLimitUpdate = (newLimit) => {
        gps.setSpeedLimit(newLimit);
    };
    gps.onSpeedLimitFound = (newLimit) => {
        game.setSpeedLimit(newLimit);
    };

    startStopBtn.addEventListener('click', toggleGame);
    unitSwitch.addEventListener('change', handleUnitChange);
    setupAudio().catch(err => console.error("Audio setup failed:", err));
}

init();

