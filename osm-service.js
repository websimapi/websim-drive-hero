import { API_URL, US_SPEED_LIMITS, HIGHWAY_TYPE_SPEED_LIMITS } from 'config';

export class OsmService {
    async getSpeedLimit(lat, lon, heading = null, speed = null) {
        console.log(`🔍 Fetching speed limit for coordinates: ${lat}, ${lon}, heading: ${heading}, speed: ${speed}`);
        
        // Try progressively larger search radii
        const radii = [50, 100, 200, 500];
        
        for (const radius of radii) {
            console.log(`Attempting radius: ${radius}m`);
            const query = `
            [out:json][timeout:10];
            way(around:${radius}, ${lat}, ${lon})[highway][highway!~"^(footway|cycleway|path|steps|pedestrian|track|construction)$"];
            out geom;
            `;

            const url = `${API_URL}?data=${encodeURIComponent(query)}`;

            try {
                const response = await fetch(url);
                const data = await response.json();

                console.log(`Found ${data.elements.length} roads within ${radius}m`);

                if (data.elements.length > 0) {
                    // Score each road based on proximity and heading alignment
                    const scoredRoads = data.elements.map(road => {
                        const score = this.scoreRoad(road, lat, lon, heading, speed);
                        return { road, score };
                    });
                    
                    // Sort by score (highest first)
                    scoredRoads.sort((a, b) => b.score - a.score);
                    
                    console.log(`Top 3 roads by score:`, scoredRoads.slice(0, 3).map(r => ({
                        name: r.road.tags.name || 'Unnamed',
                        highway: r.road.tags.highway,
                        score: r.score.toFixed(2)
                    })));
                    
                    // Try roads in order of score
                    for (const { road } of scoredRoads) {
                        const speedLimit = this.parseSpeedLimit(road.tags);
                        if (speedLimit) {
                            console.log(`✅ Speed limit found: ${speedLimit.limit} ${speedLimit.isKph ? 'KPH' : 'MPH'}`);
                            console.log(`Road type: ${road.tags.highway}, Road name: ${road.tags.name || 'Unnamed'}`);
                            return speedLimit;
                        }
                    }
                    
                    console.log(`No explicit speed limits found, using top-scored road fallback...`);
                    const fallbackLimit = this.parseSpeedLimit(scoredRoads[0].road.tags);
                    if (fallbackLimit) {
                        console.log(`✅ Using fallback speed limit: ${fallbackLimit.limit} ${fallbackLimit.isKph ? 'KPH' : 'MPH'}`);
                        return fallbackLimit;
                    }
                }
            } catch (error) {
                console.error(`Error at radius ${radius}m:`, error);
            }
        }
        
        console.warn('⚠️ No roads found within 500m - using default 35 MPH');
        return { limit: 35, isKph: false };
    }
    
    scoreRoad(road, userLat, userLon, userHeading, userSpeed) {
        if (!road.geometry || road.geometry.length < 2) {
            return 0;
        }
        
        // Find closest segment of the road to user
        let minDist = Infinity;
        let closestSegmentIndex = 0;
        
        for (let i = 0; i < road.geometry.length - 1; i++) {
            const p1 = road.geometry[i];
            const p2 = road.geometry[i + 1];
            const dist = this.distanceToSegment(userLat, userLon, p1.lat, p1.lon, p2.lat, p2.lon);
            
            if (dist < minDist) {
                minDist = dist;
                closestSegmentIndex = i;
            }
        }
        
        let score = 1000 / (minDist + 1); // Base score on proximity
        
        // If we have heading and speed, boost score for roads aligned with direction of travel
        if (userHeading !== null && userSpeed !== null && userSpeed > 1) {
            const p1 = road.geometry[closestSegmentIndex];
            const p2 = road.geometry[closestSegmentIndex + 1];
            
            // Calculate road segment bearing
            const roadBearing = this.calculateBearing(p1.lat, p1.lon, p2.lat, p2.lon);
            
            // Calculate heading difference (accounting for 0/360 wrap)
            let headingDiff = Math.abs(userHeading - roadBearing);
            if (headingDiff > 180) {
                headingDiff = 360 - headingDiff;
            }
            
            // Boost score if heading aligns (within 45 degrees = good alignment)
            const alignmentFactor = 1 - (headingDiff / 180);
            score *= (1 + alignmentFactor * 2); // Up to 3x multiplier for perfect alignment
            
            console.log(`Road ${road.tags.name || 'Unnamed'}: bearing=${roadBearing.toFixed(1)}°, userHeading=${userHeading.toFixed(1)}°, diff=${headingDiff.toFixed(1)}°, alignment=${alignmentFactor.toFixed(2)}`);
        }
        
        // Predict future position (2-3 seconds ahead) if moving
        if (userHeading !== null && userSpeed !== null && userSpeed > 1) {
            const futureSeconds = 2.5;
            const metersAhead = userSpeed * 0.44704 * futureSeconds; // Convert mph to m/s and project ahead
            const futureLat = this.projectLatitude(userLat, userHeading, metersAhead);
            const futureLon = this.projectLongitude(userLat, userLon, userHeading, metersAhead);
            
            // Check if predicted position is closer to this road
            let minFutureDist = Infinity;
            for (let i = 0; i < road.geometry.length - 1; i++) {
                const p1 = road.geometry[i];
                const p2 = road.geometry[i + 1];
                const dist = this.distanceToSegment(futureLat, futureLon, p1.lat, p1.lon, p2.lat, p2.lon);
                minFutureDist = Math.min(minFutureDist, dist);
            }
            
            // If future position is closer to this road, boost score
            if (minFutureDist < minDist) {
                score *= 1.5;
                console.log(`Road ${road.tags.name || 'Unnamed'}: Future position closer! Current: ${minDist.toFixed(1)}m, Future: ${minFutureDist.toFixed(1)}m`);
            }
        }
        
        return score;
    }
    
    distanceToSegment(px, py, x1, y1, x2, y2) {
        // Calculate distance from point (px, py) to line segment (x1,y1)-(x2,y2)
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) {
            param = dot / lenSq;
        }
        
        let xx, yy;
        
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }
        
        const dx = px - xx;
        const dy = py - yy;
        
        // Convert to meters (rough approximation)
        const latMeters = dy * 111000;
        const lonMeters = dx * 111000 * Math.cos(px * Math.PI / 180);
        
        return Math.sqrt(latMeters * latMeters + lonMeters * lonMeters);
    }
    
    calculateBearing(lat1, lon1, lat2, lon2) {
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
        const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
                  Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
        const bearing = Math.atan2(y, x) * 180 / Math.PI;
        return (bearing + 360) % 360;
    }
    
    projectLatitude(lat, heading, meters) {
        const headingRad = heading * Math.PI / 180;
        const latChange = (meters * Math.cos(headingRad)) / 111000;
        return lat + latChange;
    }
    
    projectLongitude(lat, lon, heading, meters) {
        const headingRad = heading * Math.PI / 180;
        const lonChange = (meters * Math.sin(headingRad)) / (111000 * Math.cos(lat * Math.PI / 180));
        return lon + lonChange;
    }

    parseSpeedLimit(tags) {
        console.log(`Parsing tags:`, tags);
        
        if (tags.maxspeed) {
            const speedStr = tags.maxspeed.toLowerCase();
            const limit = parseInt(speedStr, 10);
            if (isNaN(limit)) {
                console.log(`Invalid maxspeed value: ${speedStr}`);
                return this.getImpliedSpeedLimit(tags);
            }

            const isKph = !speedStr.includes('mph');
            console.log(`Found explicit maxspeed: ${limit} ${isKph ? 'KPH' : 'MPH'}`);
            return { limit, isKph };
        }

        if (tags['maxspeed:type']) {
            const speedType = tags['maxspeed:type'];
            if (speedType.startsWith('US:') && US_SPEED_LIMITS[speedType]) {
                console.log(`Found maxspeed:type: ${speedType} = ${US_SPEED_LIMITS[speedType]} MPH`);
                return { limit: US_SPEED_LIMITS[speedType], isKph: false };
            }
        }
        
        return this.getImpliedSpeedLimit(tags);
    }

    getImpliedSpeedLimit(tags) {
        if (tags.highway && HIGHWAY_TYPE_SPEED_LIMITS[tags.highway]) {
            console.log(`Using implied speed limit for ${tags.highway}: ${HIGHWAY_TYPE_SPEED_LIMITS[tags.highway]} MPH`);
            return { limit: HIGHWAY_TYPE_SPEED_LIMITS[tags.highway], isKph: false };
        }
        console.log(`No speed limit found for highway type: ${tags.highway}`);
        return null;
    }
}