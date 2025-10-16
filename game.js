import { POINT_RATE, SPEED_BUFFER } from 'config';

export class Game {
    constructor(unit) {
        this.score = 0;
        this.speed = 0;
        this.speedLimit = null;
        this.message = "Press Start to Begin";
        this.status = "NEUTRAL"; // GOOD, BAD, NEUTRAL
        this.isRunning = false;
        this.intervalId = null;
        this.unit = unit;
        this.onSpeedLimitUpdate = () => {};
    }

    start() {
        this.isRunning = true;
        this.intervalId = setInterval(() => this.update(), 1000);
    }

    stop() {
        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
    
    setUnit(newUnit) {
        if(this.unit === newUnit) return;

        // Convert speed limit if it exists
        if (this.speedLimit !== null) {
            if (newUnit === 'KPH') {
                this.speedLimit = Math.round(this.speedLimit * 1.60934);
            } else { // newUnit is MPH
                this.speedLimit = Math.round(this.speedLimit / 1.60934);
            }
        }
        this.unit = newUnit;
        this.onSpeedLimitUpdate(this.speedLimit);
    }

    updateSpeed(newSpeed) {
        this.speed = newSpeed;
    }

    setSpeedLimit(newLimit) {
        this.speedLimit = newLimit;
    }

    update() {
        if (!this.isRunning) return;

        if (this.speedLimit === null) {
            this.message = "Searching for speed limit...";
            this.status = "NEUTRAL";
            return;
        }

        const buffer = SPEED_BUFFER[this.unit];
        const isSpeeding = this.speed > this.speedLimit;
        const isTooSlow = this.speed < this.speedLimit - buffer;

        if (isSpeeding) {
            this.message = "Too fast! Slow down.";
            this.status = "BAD";
        } else if (isTooSlow) {
            this.message = `A bit slow. Aim for ${this.speedLimit - buffer} to ${this.speedLimit} ${this.unit}.`;
            this.status = "NEUTRAL";
        } else {
            // Good driving
            this.score += POINT_RATE;
            this.message = "Great driving!";
            this.status = "GOOD";
        }
    }

    getState() {
        return {
            score: this.score,
            speed: this.speed,
            speedLimit: this.speedLimit,
            message: this.message,
            status: this.status,
        };
    }
}

