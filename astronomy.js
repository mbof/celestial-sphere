// astronomy.js - High-precision Solar, Lunar, and Horizontal (Los Angeles) ephemeris

export const LA_COORDS = {
  lat: 34.0522, // degrees North
  lon: -118.2437, // degrees East (West is negative)
  name: 'Los Angeles, CA'
};

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const OBLIQUITY = 23.4392911 * DEG2RAD; // J2000 mean obliquity

export function mod360(deg) {
  return ((deg % 360) + 360) % 360;
}

export function wrap180(deg) {
  const m = mod360(deg + 180);
  return m - 180;
}

/**
 * Convert JavaScript Date (ms UTC) to Julian Date
 */
export function dateToJD(ms) {
  return ms / 86400000 + 2440587.5;
}

/**
 * Days since J2000.0 (2000-01-01 12:00 TT)
 */
export function jdToD(jd) {
  return jd - 2451545.0;
}

/**
 * Compute Solar position:
 * - meanLon (deg): Mean ecliptic longitude L0
 * - trueLon (deg): Apparent ecliptic longitude lambda
 * - ra (deg): Right Ascension alpha
 * - dec (deg): Declination delta
 * - eotDeg (deg): Equation of Time in degrees (Mean RA - Apparent RA)
 * - eotMin (min): Equation of Time in minutes
 */
export function getSunPosition(jd) {
  const d = jdToD(jd);
  const T = d / 36525.0;

  // Mean longitude of the Sun (deg)
  const L0 = mod360(280.46646 + 0.98564736 * d);
  // Mean anomaly of the Sun (deg)
  const M = mod360(357.52911 + 0.98560028 * d);
  const Mrad = M * DEG2RAD;

  // Equation of Center (deg)
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mrad) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * Mrad) +
    0.000289 * Math.sin(3 * Mrad);

  // True ecliptic longitude (deg)
  const trueLon = mod360(L0 + C);
  const lam = trueLon * DEG2RAD;

  // Equatorial coordinates
  const raRad = Math.atan2(Math.cos(OBLIQUITY) * Math.sin(lam), Math.cos(lam));
  const decRad = Math.asin(Math.sin(OBLIQUITY) * Math.sin(lam));

  const ra = mod360(raRad * RAD2DEG);
  const dec = decRad * RAD2DEG;

  // Equation of Time: difference between Mean Sun RA (L0) and Apparent Sun RA
  // Positive EoT means Apparent Sun transits before Mean Sun (i.e. RA_sun < L0)
  const eotDeg = wrap180(L0 - ra);
  const eotMin = eotDeg * 4.0;

  return {
    meanLon: L0,
    meanAnomaly: M,
    trueLon,
    ra,
    dec,
    eotDeg,
    eotMin
  };
}

/**
 * Compute Lunar position and phase parameters:
 * - eclLon, eclLat (deg)
 * - ra, dec (deg)
 * - elongation (deg): angular separation from Sun
 * - phaseAngle (rad): 0 = New Moon, PI = Full Moon
 * - illuminatedFraction (0..1)
 * - synodicAge (0..1): 0 = New, 0.25 = First Quarter, 0.5 = Full, 0.75 = Last Quarter
 * - phaseName (string)
 */
export function getMoonPosition(jd, sunPos = null) {
  const sun = sunPos || getSunPosition(jd);
  const d = jdToD(jd);

  // Fundamental lunar arguments (degrees)
  const Lp = mod360(218.3164477 + 13.17639648 * d); // Mean longitude
  const D = mod360(297.8501921 + 12.19074912 * d);  // Mean elongation
  const M = sun.meanAnomaly;                        // Sun mean anomaly
  const Mp = mod360(134.9633964 + 13.06499295 * d); // Moon mean anomaly
  const F = mod360(93.2720950 + 13.22935024 * d);   // Argument of latitude

  const Dr = D * DEG2RAD;
  const Mr = M * DEG2RAD;
  const Mpr = Mp * DEG2RAD;
  const Fr = F * DEG2RAD;

  // Ecliptic longitude perturbations (deg)
  const dLon =
    6.288774 * Math.sin(Mpr) +
    1.274027 * Math.sin(2 * Dr - Mpr) +
    0.658314 * Math.sin(2 * Dr) +
    0.213618 * Math.sin(2 * Mpr) -
    0.185116 * Math.sin(Mr) -
    0.114332 * Math.sin(2 * Fr) +
    0.058793 * Math.sin(2 * Dr - 2 * Mpr) +
    0.057066 * Math.sin(2 * Dr - Mr - Mpr) +
    0.053322 * Math.sin(2 * Dr + Mpr);

  // Ecliptic latitude perturbations (deg)
  const dLat =
    5.128122 * Math.sin(Fr) +
    0.280602 * Math.sin(Mpr + Fr) +
    0.277693 * Math.sin(Mpr - Fr) +
    0.173237 * Math.sin(2 * Dr - Fr) +
    0.055413 * Math.sin(2 * Dr - Mpr + Fr) +
    0.046271 * Math.sin(2 * Dr - Mpr - Fr);

  const eclLon = mod360(Lp + dLon);
  const eclLat = dLat;

  const lam = eclLon * DEG2RAD;
  const bet = eclLat * DEG2RAD;

  // Convert ecliptic (lam, bet) to equatorial (ra, dec)
  const sinDec =
    Math.sin(bet) * Math.cos(OBLIQUITY) +
    Math.cos(bet) * Math.sin(OBLIQUITY) * Math.sin(lam);
  const decRad = Math.asin(Math.max(-1, Math.min(1, sinDec)));

  const y =
    Math.sin(lam) * Math.cos(OBLIQUITY) -
    Math.tan(bet) * Math.sin(OBLIQUITY);
  const x = Math.cos(lam);
  const raRad = Math.atan2(y, x);

  const ra = mod360(raRad * RAD2DEG);
  const dec = decRad * RAD2DEG;

  // Angular elongation between Sun and Moon
  const raSunRad = sun.ra * DEG2RAD;
  const decSunRad = sun.dec * DEG2RAD;
  const cosPsi =
    Math.sin(decSunRad) * Math.sin(decRad) +
    Math.cos(decSunRad) * Math.cos(decRad) * Math.cos(raSunRad - raRad);
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi))); // 0 at New Moon, PI at Full Moon
  const illuminatedFraction = (1 - Math.cos(psi)) / 2;

  // Synodic cycle progress (0..360 deg from ecliptic longitude difference)
  const synodicDeg = mod360(eclLon - sun.trueLon);
  const synodicAge = synodicDeg / 360;

  // Position angle of the Moon's bright limb (chi) measured eastward from Celestial North
  const numChi = Math.cos(decSunRad) * Math.sin(raSunRad - raRad);
  const denChi =
    Math.sin(decSunRad) * Math.cos(decRad) -
    Math.cos(decSunRad) * Math.sin(decRad) * Math.cos(raSunRad - raRad);
  const brightLimbPA = Math.atan2(numChi, denChi); // radians

  return {
    eclLon,
    eclLat,
    ra,
    dec,
    elongation: psi * RAD2DEG,
     illuminatedFraction,
    synodicDeg,
    synodicAge,
    brightLimbPA,
    phaseName: getPhaseName(synodicAge)
  };
}

function getPhaseName(age) {
  if (age < 0.03 || age > 0.97) return 'New Moon';
  if (age < 0.22) return 'Waxing Crescent';
  if (age < 0.28) return 'First Quarter';
  if (age < 0.47) return 'Waxing Gibbous';
  if (age < 0.53) return 'Full Moon';
  if (age < 0.72) return 'Waning Gibbous';
  if (age < 0.78) return 'Last Quarter';
  return 'Waning Crescent';
}

/**
 * Greenwich Mean Sidereal Time (degrees)
 */
export function getGMST(jd) {
  const d = jdToD(jd);
  return mod360(280.46061837 + 360.98564736629 * d);
}

/**
 * Convert Equatorial (RA, Dec in deg) to Horizontal (Azimuth, Altitude in deg)
 * at observer (lat, lon in deg) and Julian Date jd.
 * Also returns parallactic angle q (radians) for rotating lunar limb orientation.
 */
export function equatorialToHorizontal(raDeg, decDeg, jd, latDeg = LA_COORDS.lat, lonDeg = LA_COORDS.lon) {
  const gmst = getGMST(jd);
  const lst = mod360(gmst + lonDeg); // Local Sidereal Time (deg)
  const haDeg = wrap180(lst - raDeg); // Hour Angle (deg)

  const ha = haDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const lat = latDeg * DEG2RAD;

  const sinAlt =
    Math.sin(lat) * Math.sin(dec) +
    Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const altRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  // Azimuth measured eastward from North (0=N, 90=E, 180=S, 270=W)
  const y = -Math.sin(ha) * Math.cos(dec);
  const x = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(ha);
  const azRad = Math.atan2(y, x);

  // Parallactic angle q (angle between celestial pole and zenith at the body)
  const qY = Math.sin(ha);
  const qX = Math.tan(lat) * Math.cos(dec) - Math.sin(dec) * Math.cos(ha);
  const parallacticAngle = Math.atan2(qY, qX);

  return {
    az: mod360(azRad * RAD2DEG),
    alt: altRad * RAD2DEG,
    ha: haDeg,
    parallacticAngle
  };
}

/**
 * Precompute the 365-day Solar Analemma points:
 * Each point contains { dayOfYear, raOffsetDeg, decDeg, eotMin, meanLon }
 */
export function precomputeAnalemma(year = 2026) {
  const startMs = Date.UTC(year, 0, 1, 20, 0, 0); // ~12:00 Noon PST in LA
  const points = [];
  for (let i = 0; i <= 365; i++) {
    const ms = startMs + i * 86400000;
    const jd = dateToJD(ms);
    const sun = getSunPosition(jd);
    points.push({
      dayOfYear: i,
      jd,
      // Relative RA in the mean-solar co-rotating frame:
      // Apparent RA - Mean Sun RA = -eotDeg
      raRelDeg: -sun.eotDeg,
      decDeg: sun.dec,
      eotMin: sun.eotMin,
      ra: sun.ra,
      meanLon: sun.meanLon
    });
  }
  return points;
}
