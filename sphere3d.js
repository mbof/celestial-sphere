// sphere3d.js - Interactive 3D Celestial Sphere Renderer
// Features:
// - Co-rotating Mean Solar reference frame (or Sidereal/Earth frame toggle)
// - 3D per-pixel shaded rotating Earth with continents, axial tilt, day/night terminator, and LA marker
// - Celestial sphere wireframe (Celestial Equator, Tropics, Meridians, Ecliptic, Zodiac stars)
// - Solar Analemma (figure-8) on the celestial sphere with glowing 3D Sun
// - Lunar 3D sphere tidally locked to Earth, lit by parallel solar rays from the Sun direction
//   (showing true 3D illumination including the far side when viewed from outside the sphere!)

import { DEG2RAD, RAD2DEG, LA_COORDS, OBLIQUITY, mod360 } from './astronomy.js?v=4';

// Simplified continent polygons (lon, lat in deg) for procedural Earth texture
const CONTINENTS = [
  // North America
  [[-165,65],[-140,70],[-125,70],[-95,72],[-75,62],[-65,58],[-55,48],[-70,42],[-80,25],[-82,10],[-90,16],[-105,20],[-112,30],[-124,40],[-130,55],[-160,60]],
  // Greenland
  [[-55,60],[-42,60],[-20,72],[-25,82],[-55,80],[-60,70]],
  // South America
  [[-80,10],[-62,10],[-35,-6],[-38,-18],[-48,-28],[-65,-54],[-73,-50],[-72,-30],[-78,-5]],
  // Europe
  [[-10,36],[5,38],[15,38],[28,40],[40,46],[55,68],[25,71],[10,62],[5,50],[-9,43]],
  // Africa
  [[-17,15],[-5,35],[10,37],[33,31],[50,12],[40,-15],[30,-34],[18,-34],[12,-15],[8,4],[-8,5]],
  // Asia
  [[28,40],[45,30],[55,22],[72,20],[78,8],[90,22],[103,2],[108,15],[122,25],[135,35],[142,50],[170,66],[100,74],[60,70],[40,46]],
  // Australia
  [[114,-22],[130,-12],[142,-11],[153,-26],[146,-38],[130,-33],[115,-34]],
  // Japan / UK / NZ / Madagascar hints
  [[130,31],[141,41],[140,44],[135,35]],
  [[44,-13],[50,-15],[47,-25],[43,-24]]
];

// Zodiac / bright stars (RA deg, Dec deg, mag)
const BRIGHT_STARS = [
  [101.28, -16.71, 1.5], [95.98, -52.69, 1.2], [213.91, 19.18, 1.2], [279.23, 38.78, 1.2],
  [79.17, 45.99, 1.1], [78.63, -8.20, 1.1], [114.82, 5.22, 1.0], [88.79, 7.40, 1.1],
  [297.69, 8.86, 1.0], [68.98, 16.50, 1.0], [247.35, -26.43, 1.0], [201.29, -11.16, 1.0],
  [116.32, 28.02, 0.9], [344.41, -29.62, 0.9], [310.35, 45.28, 0.9], [152.09, 11.96, 0.9],
  [15.18, 59.15, 0.7], [37.95, 89.26, 0.9], // Polaris
  [165.93, 61.75, 0.7], [193.50, 55.95, 0.7], [206.88, 49.31, 0.7],
  [30.97, 42.32, 0.6], [51.08, 49.86, 0.6], [130.82, 18.15, 0.6],
  [186.65, -63.09, 0.8], [219.90, -60.83, 1.1], [240.08, -22.62, 0.6],
  [263.89, -37.10, 0.7], [283.81, -26.29, 0.7], [306.41, -56.73, 0.7],
  [332.05, -46.96, 0.7], [6.43, -42.30, 0.7], [24.42, -57.23, 0.8]
];

export class CelestialSphere3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Camera spherical coordinates around the celestial sphere
    // yaw = 0 faces the Mean Sun meridian from the outside
    this.camYaw = -0.32;   // radians (slightly angled so analemma & Earth rotation are clear)
    this.camPitch = 0.30;  // radians (~17 deg north elevation)
    this.camZoom = 1.0;

    // Visual options
    this.eotScale = 1.0;
    this.showFarSideLabel = true;

    // Pre-generate Earth land bitmap (360 x 180) for fast per-pixel lookup
    this.earthMap = this._buildEarthBitmap(360, 180);

    // Offscreen buffers for shaded 3D Earth and 3D Moon
    this.earthCanvas = document.createElement('canvas');
    this.earthCanvas.width = 160;
    this.earthCanvas.height = 160;
    this.earthCtx = this.earthCanvas.getContext('2d');

    this.moonCanvas = document.createElement('canvas');
    this.moonCanvas.width = 96;
    this.moonCanvas.height = 96;
    this.moonCtx = this.moonCanvas.getContext('2d');

    // Lunar orbit trail buffer (stores recent positions in co-rotating frame)
    this.moonTrail = [];

    this._initInteraction();
  }

  _buildEarthBitmap(w, h) {
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const c = off.getContext('2d');
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff';
    for (const poly of CONTINENTS) {
      c.beginPath();
      poly.forEach(([lon, lat], idx) => {
        const x = ((lon + 180) / 360) * w;
        const y = ((90 - lat) / 180) * h;
        if (idx === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      });
      c.closePath();
      c.fill();
    }
    const img = c.getImageData(0, 0, w, h).data;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      mask[i] = img[i * 4] > 128 ? 1 : 0;
    }
    return { w, h, mask };
  }

  _initInteraction() {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let pinchDist = 0;

    const onDown = (x, y) => {
      dragging = true;
      lastX = x;
      lastY = y;
    };

    const onMove = (x, y) => {
      if (!dragging) return;
      const dx = x - lastX;
      const dy = y - lastY;
      lastX = x;
      lastY = y;
      this.camYaw -= dx * 0.007;
      this.camPitch = Math.max(-1.35, Math.min(1.35, this.camPitch + dy * 0.007));
      if (this.onCameraMove) this.onCameraMove();
    };

    const onUp = () => {
      dragging = false;
    };

    this.canvas.addEventListener('mousedown', (e) => onDown(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onUp);

    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        onDown(e.touches[0].clientX, e.touches[0].clientY);
      } else if (e.touches.length === 2) {
        dragging = false;
        pinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && dragging) {
        onMove(e.touches[0].clientX, e.touches[0].clientY);
      } else if (e.touches.length === 2 && pinchDist > 0) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        this.camZoom = Math.max(0.7, Math.min(1.6, this.camZoom * (d / pinchDist)));
        pinchDist = d;
        if (this.onCameraMove) this.onCameraMove();
      }
    }, { passive: true });

    this.canvas.addEventListener('touchend', onUp, { passive: true });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camZoom = Math.max(0.7, Math.min(1.6, this.camZoom * (e.deltaY < 0 ? 1.08 : 0.92)));
      if (this.onCameraMove) this.onCameraMove();
    }, { passive: false });
  }

  /**
   * Convert co-rotating spherical angles (relRA deg, dec deg, radius) to 3D world coordinates.
   * Convention:
   * +Y = North Celestial Pole (Dec = +90 deg)
   * +Z = Mean Sun Meridian (relRA = 0 deg, Dec = 0 deg)
   * +X = Eastward along Celestial Equator (relRA = +90 deg, Dec = 0 deg)
   */
  sphericalToVec3(relRaDeg, decDeg, radius = 1.0) {
    const phi = relRaDeg * DEG2RAD;
    const dec = decDeg * DEG2RAD;
    const cosDec = Math.cos(dec);
    return {
      x: radius * cosDec * Math.sin(phi),
      y: radius * Math.sin(dec),
      z: radius * cosDec * Math.cos(phi)
    };
  }

  /**
   * Rotate world 3D vector into Camera space:
   * Camera looks at origin from (camYaw, camPitch).
   * In camera space: +X is right, +Y is up, +Z is toward viewer (depth).
   */
  worldToCamera(v) {
    // Rotate around Y by -camYaw
    const cy = Math.cos(-this.camYaw);
    const sy = Math.sin(-this.camYaw);
    const x1 = v.x * cy + v.z * sy;
    const y1 = v.y;
    const z1 = -v.x * sy + v.z * cy;

    // Rotate around X by camPitch
    const cp = Math.cos(this.camPitch);
    const sp = Math.sin(this.camPitch);
    const x2 = x1;
    const y2 = y1 * cp - z1 * sp;
    const z2 = y1 * sp + z1 * cp;

    return { x: x2, y: y2, z: z2 };
  }

  /**
   * Transform camera-space unit normal back to world space
   */
  cameraToWorld(vc) {
    const cp = Math.cos(-this.camPitch);
    const sp = Math.sin(-this.camPitch);
    const x1 = vc.x;
    const y1 = vc.y * cp - vc.z * sp;
    const z1 = vc.y * sp + vc.z * cp;

    const cy = Math.cos(this.camYaw);
    const sy = Math.sin(this.camYaw);
    return {
      x: x1 * cy + z1 * sy,
      y: y1,
      z: -x1 * sy + z1 * cy
    };
  }

  project(v, cx, cy, scale) {
    const cam = this.worldToCamera(v);
    // Perspective factor (mild perspective so sphere stays clean)
    const fovDist = 4.2;
    const persp = fovDist / (fovDist - cam.z);
    return {
      x: cx + cam.x * scale * persp,
      y: cy - cam.y * scale * persp,
      z: cam.z,
      persp
    };
  }

  /**
   * Render per-pixel 3D shaded Earth onto offscreen canvas
   */
  _renderShadedEarth(size, sunVecWorld, earthRotAngleRad) {
    const w = Math.max(48, Math.min(160, Math.round(size)));
    if (this.earthCanvas.width !== w) {
      this.earthCanvas.width = w;
      this.earthCanvas.height = w;
    }
    const imgData = this.earthCtx.createImageData(w, w);
    const data = imgData.data;

    // Transform Sun light direction into camera space for fast dot product
    const sunCam = this.worldToCamera(sunVecWorld);
    const sLen = Math.hypot(sunCam.x, sunCam.y, sunCam.z) || 1;
    const sx = sunCam.x / sLen;
    const sy = sunCam.y / sLen;
    const sz = sunCam.z / sLen;

    const r = w / 2 - 1;
    const cx = w / 2;
    const cy = w / 2;

    const mapW = this.earthMap.w;
    const mapH = this.earthMap.h;
    const mask = this.earthMap.mask;

    for (let py = 0; py < w; py++) {
      const ny = (cy - py) / r;
      for (let px = 0; px < w; px++) {
        const nx = (px - cx) / r;
        const r2 = nx * nx + ny * ny;
        if (r2 > 1) continue;
        const nz = Math.sqrt(1 - r2);

        // Normal in world space
        const nw = this.cameraToWorld({ x: nx, y: ny, z: nz });

        // Geographic latitude & longitude on rotating Earth
        const latRad = Math.asin(Math.max(-1, Math.min(1, nw.y)));
        const worldLonRad = Math.atan2(nw.x, nw.z);
        const geoLonDeg = mod360((worldLonRad - earthRotAngleRad) * RAD2DEG + 180) - 180;
        const geoLatDeg = latRad * RAD2DEG;

        // Lookup continent mask
        const mx = Math.min(mapW - 1, Math.max(0, Math.floor(((geoLonDeg + 180) / 360) * mapW)));
        const my = Math.min(mapH - 1, Math.max(0, Math.floor(((90 - geoLatDeg) / 180) * mapH)));
        const isLand = mask[my * mapW + mx] === 1;
        const isIce = Math.abs(geoLatDeg) > 74;

        // Solar illumination dot product
        const dotSun = nx * sx + ny * sy + nz * sz;
        // Smooth twilight transition
        const light = Math.max(0.14, Math.min(1.0, 0.18 + 0.85 * Math.max(0, dotSun + 0.08)));

        let br, bg, bb;
        if (isIce) {
          br = 225; bg = 238; bb = 250;
        } else if (isLand) {
          // Verdant green/ochre continents
          const arid = Math.abs(geoLatDeg) > 18 && Math.abs(geoLatDeg) < 35 ? 0.45 : 0.0;
          br = 54 + arid * 95;
          bg = 138 - arid * 20;
          bb = 74 - arid * 25;
        } else {
          // Deep ocean blue + specular highlight
          const spec = dotSun > 0 ? Math.pow(Math.max(0, (nx * sx + ny * sy + (nz + 1) * (sz + 1)) / 2.2), 16) * 75 : 0;
          br = 22 + spec;
          bg = 74 + spec;
          bb = 158 + spec * 0.8;
        }

        // City lights hint on nightside land
        let nightGlowR = 0, nightGlowG = 0;
        if (dotSun < -0.05 && isLand && !isIce) {
          const hash = Math.sin(geoLonDeg * 12.7 + geoLatDeg * 19.3);
          if (hash > 0.72) {
            nightGlowR = 110 * (-dotSun);
            nightGlowG = 78 * (-dotSun);
          }
        }

        // Atmospheric blue limb fresnel
        const fresnel = Math.pow(1 - nz, 2.6);

        const idx = (py * w + px) * 4;
        data[idx] = Math.min(255, br * light + nightGlowR + fresnel * 65);
        data[idx + 1] = Math.min(255, bg * light + nightGlowG + fresnel * 135);
        data[idx + 2] = Math.min(255, bb * light + fresnel * 235);
        data[idx + 3] = 255;
      }
    }
    this.earthCtx.putImageData(imgData, 0, 0);
  }

  /**
   * Render per-pixel 3D shaded Moon onto offscreen canvas.
   * Crucially:
   * - Sunlight comes from the Sun direction vector (sunVecWorld) in 3D space!
   * - The Moon is tidally locked to Earth: its near side (-moonVecWorld) has dark Maria,
   *   while its far side (+moonVecWorld) has bright cratered highlands.
   * - Thus from outside the celestial sphere, when the Moon is between Earth and Sun (New Moon on Earth),
   *   we see the bright illuminated FAR side of the Moon!
   */
  _renderShadedMoon(size, sunVecWorld, moonVecWorld) {
    const w = Math.max(36, Math.min(96, Math.round(size)));
    if (this.moonCanvas.width !== w) {
      this.moonCanvas.width = w;
      this.moonCanvas.height = w;
    }
    const imgData = this.moonCtx.createImageData(w, w);
    const data = imgData.data;

    // Sun direction in camera space (unit vector pointing toward Sun)
    const sunCam = this.worldToCamera(sunVecWorld);
    const sLen = Math.hypot(sunCam.x, sunCam.y, sunCam.z) || 1;
    const sx = sunCam.x / sLen;
    const sy = sunCam.y / sLen;
    const sz = sunCam.z / sLen;

    // Moon radial outward direction in camera space (+moonCam = Far Side center, -moonCam = Near Side center)
    const moonCam = this.worldToCamera(moonVecWorld);
    const mLen = Math.hypot(moonCam.x, moonCam.y, moonCam.z) || 1;
    const mx = moonCam.x / mLen;
    const my = moonCam.y / mLen;
    const mz = moonCam.z / mLen;

    const r = w / 2 - 1;
    const cx = w / 2;
    const cy = w / 2;

    for (let py = 0; py < w; py++) {
      const ny = (cy - py) / r;
      for (let px = 0; px < w; px++) {
        const nx = (px - cx) / r;
        const r2 = nx * nx + ny * ny;
        if (r2 > 1) continue;
        const nz = Math.sqrt(1 - r2);

        // True 3D illumination from Sun direction
        const dotSun = nx * sx + ny * sy + nz * sz;
        // Sharp lunar terminator (no atmosphere on Moon, plus subtle earthshine on dark side)
        const sunLit = dotSun > 0 ? Math.pow(dotSun, 0.55) : 0;
        const light = 0.13 + 0.87 * sunLit;

        // Determine if pixel is on Near Side (dotOutward < 0) or Far Side (dotOutward > 0)
        const dotOutward = nx * mx + ny * my + nz * mz;

        // Procedural lunar surface albedo (Maria on near side, cratered highlands on far side)
        const nw = this.cameraToWorld({ x: nx, y: ny, z: nz });
        const craterNoise =
          0.08 * Math.sin(nw.x * 9.2 + nw.y * 7.1) * Math.cos(nw.z * 8.4) +
          0.04 * Math.cos(nw.x * 19.0 - nw.z * 16.0);

        let albedo = 0.84 + craterNoise;
        if (dotOutward < 0) {
          // Near side maria patches (Mare Imbrium, Serenitatis, Tranquillitatis)
          const maria = Math.sin(nw.x * 4.5 + 0.5) * Math.cos(nw.y * 4.2 - 0.3);
          if (maria > 0.15) {
            albedo -= 0.24 * (-dotOutward);
          }
        } else {
          // Far side highlands (slightly brighter + South Pole-Aitken basin at south)
          if (nw.y < -0.45) albedo -= 0.10;
          else albedo += 0.05;
        }

        // Warm-silver sunlit tone vs cool blue-slate shadow/earthshine tone
        const idx = (py * w + px) * 4;
        if (dotSun > 0) {
          data[idx] = Math.min(255, 248 * albedo * light);
          data[idx + 1] = Math.min(255, 243 * albedo * light);
          data[idx + 2] = Math.min(255, 228 * albedo * light);
        } else {
          data[idx] = Math.min(255, 165 * albedo * light);
          data[idx + 1] = Math.min(255, 185 * albedo * light);
          data[idx + 2] = Math.min(255, 225 * albedo * light);
        }
        data[idx + 3] = 255;
      }
    }
    this.moonCtx.putImageData(imgData, 0, 0);
  }

  /**
   * Main render call for the 3D Celestial Sphere
   */
  render(state) {
    const { jd, sun, moon, analemmaPoints, gmst, city = LA_COORDS } = state;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(10, Math.floor(rect.width * dpr));
    const height = Math.max(10, Math.floor(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    // Deep space background with subtle radial nebula glow
    const bgGrad = ctx.createRadialGradient(W * 0.5, H * 0.5, 10, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
    bgGrad.addColorStop(0, '#0d1629');
    bgGrad.addColorStop(0.55, '#070b16');
    bgGrad.addColorStop(1, '#03050a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const cx = W * 0.5;
    const cy = H * 0.52;
    const sphereRadiusPx = Math.min(W, H) * 0.39 * this.camZoom;

    // Compute 3D positions in the Co-rotating Mean Solar Frame:
    // Mean Sun is at relRA = 0 deg.
    // Apparent Sun is at relRA = -sun.eotDeg * eotScale, dec = sun.dec
    const sunRelRA = -sun.eotDeg * this.eotScale;
    const sunVec = this.sphericalToVec3(sunRelRA, sun.dec, 1.0);

    // True physical Sun direction (un-exaggerated) for lighting if needed, or matched to visual Sun
    const sunLightVec = this.sphericalToVec3(sunRelRA, sun.dec, 1.0);

    // Moon in co-rotating Mean Solar frame: relRA = moon.ra - sun.meanLon
    const moonRelRA = mod360(moon.ra - sun.meanLon);
    const moonVec = this.sphericalToVec3(moonRelRA, moon.dec, 1.0);

    // Record lunar trail point
    if (
      this.moonTrail.length === 0 ||
      Math.hypot(
        this.moonTrail[this.moonTrail.length - 1].x - moonVec.x,
        this.moonTrail[this.moonTrail.length - 1].y - moonVec.y,
        this.moonTrail[this.moonTrail.length - 1].z - moonVec.z
      ) > 0.03
    ) {
      this.moonTrail.push({ ...moonVec, jd });
      if (this.moonTrail.length > 160) this.moonTrail.shift();
    }

    // Earth rotation angle in Co-rotating Mean Solar frame:
    // Greenwich meridian hour angle relative to Mean Sun is (GMST - sun.meanLon)
    const earthRotRad = (gmst - sun.meanLon) * DEG2RAD;

    // 1. Draw back hemisphere of the Celestial Sphere (z < 0)
    this._drawCelestialStars(ctx, cx, cy, sphereRadiusPx, sun.meanLon, false);
    this._drawSphereGrid(ctx, cx, cy, sphereRadiusPx, sun.meanLon, false);
    this._drawAnalemmaCurve(ctx, cx, cy, sphereRadiusPx, analemmaPoints, false);
    this._drawMoonTrail(ctx, cx, cy, sphereRadiusPx, false);

    // Collect 3D bodies (Earth at center, Sun on sphere, Moon on sphere) and sort back-to-front by camera Z
    const earthProj = this.project({ x: 0, y: 0, z: 0 }, cx, cy, sphereRadiusPx);
    const sunProj = this.project(sunVec, cx, cy, sphereRadiusPx);
    const moonProj = this.project(moonVec, cx, cy, sphereRadiusPx);

    const bodies = [
      { type: 'earth', z: earthProj.z, proj: earthProj },
      { type: 'sun', z: sunProj.z, proj: sunProj, vec: sunVec },
      { type: 'moon', z: moonProj.z, proj: moonProj, vec: moonVec }
    ].sort((a, b) => a.z - b.z);

    // Draw bodies that are behind the center (z < 0)
    for (const b of bodies) {
      if (b.z < 0) {
        this._drawBody(ctx, b, cx, cy, sphereRadiusPx, sunLightVec, earthRotRad, moon, city, dpr);
      }
    }

    // Draw North-South Celestial Pole Axis through Earth
    this._drawPolarAxis(ctx, cx, cy, sphereRadiusPx);

    // Draw Sun-to-Earth and Sun-to-Moon light rays (subtle dashed vectors)
    this._drawLightRays(ctx, earthProj, sunProj, moonProj);

    // Draw bodies at or in front of center (z >= 0)
    for (const b of bodies) {
      if (b.z >= 0) {
        this._drawBody(ctx, b, cx, cy, sphereRadiusPx, sunLightVec, earthRotRad, moon, city, dpr);
      }
    }

    // 2. Draw front hemisphere of the Celestial Sphere (z >= 0)
    this._drawCelestialStars(ctx, cx, cy, sphereRadiusPx, sun.meanLon, true);
    this._drawSphereGrid(ctx, cx, cy, sphereRadiusPx, sun.meanLon, true);
    this._drawAnalemmaCurve(ctx, cx, cy, sphereRadiusPx, analemmaPoints, true);
    this._drawMoonTrail(ctx, cx, cy, sphereRadiusPx, true);

    // Outer glass rim of the Celestial Sphere
    ctx.beginPath();
    ctx.arc(cx, cy, sphereRadiusPx * 1.005, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120, 175, 255, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw HUD annotations on 3D view
    this._draw3DHud(ctx, W, H, moonProj, moon, sun);

    ctx.restore();
  }

  _drawCelestialStars(ctx, cx, cy, scale, meanLonDeg, front) {
    for (const [ra, dec, mag] of BRIGHT_STARS) {
      const relRA = ra - meanLonDeg;
      const v = this.sphericalToVec3(relRA, dec, 1.0);
      const p = this.project(v, cx, cy, scale);
      if ((front && p.z < 0) || (!front && p.z >= 0)) continue;
      const alpha = front ? 0.65 : 0.25;
      ctx.fillStyle = `rgba(215, 230, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, mag * (front ? 1.2 : 0.8), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawSphereGrid(ctx, cx, cy, scale, meanLonDeg, front) {
    // Latitude rings: Celestial Equator (0), Tropics (+23.44, -23.44)
    const rings = [
      { dec: 0, color: front ? 'rgba(96, 165, 250, 0.52)' : 'rgba(96, 165, 250, 0.16)', width: 1.4, dash: [] },
      { dec: 23.439, color: front ? 'rgba(251, 191, 36, 0.30)' : 'rgba(251, 191, 36, 0.10)', width: 1.0, dash: [4, 4] },
      { dec: -23.439, color: front ? 'rgba(251, 191, 36, 0.30)' : 'rgba(251, 191, 36, 0.10)', width: 1.0, dash: [4, 4] }
    ];

    for (const ring of rings) {
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.width;
      ctx.setLineDash(ring.dash);
      this._strokeCircle3D(ctx, (deg) => this.sphericalToVec3(deg, ring.dec, 1.0), cx, cy, scale, front);
    }

    // Ecliptic great circle (tilted by obliquity, rotated by -meanLonDeg in co-rotating frame)
    ctx.strokeStyle = front ? 'rgba(245, 158, 11, 0.42)' : 'rgba(245, 158, 11, 0.14)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 4]);
    this._strokeCircle3D(ctx, (eclLonDeg) => {
      const lam = eclLonDeg * DEG2RAD;
      const ra = Math.atan2(Math.cos(OBLIQUITY) * Math.sin(lam), Math.cos(lam)) * RAD2DEG;
      const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(lam)) * RAD2DEG;
      return this.sphericalToVec3(ra - meanLonDeg, dec, 1.0);
    }, cx, cy, scale, front);

    // Mean Solar Meridian (relRA = 0 deg, where the Analemma is centered)
    ctx.strokeStyle = front ? 'rgba(255, 210, 100, 0.32)' : 'rgba(255, 210, 100, 0.08)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([2, 3]);
    this._strokeArc3D(ctx, -90, 90, 4, (dec) => this.sphericalToVec3(0, dec, 1.0), cx, cy, scale, front);

    // Other meridians every 45 deg
    ctx.strokeStyle = front ? 'rgba(148, 163, 184, 0.15)' : 'rgba(148, 163, 184, 0.06)';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([]);
    for (let lon = 45; lon < 360; lon += 45) {
      this._strokeArc3D(ctx, -90, 90, 6, (dec) => this.sphericalToVec3(lon, dec, 1.0), cx, cy, scale, front);
    }
    ctx.setLineDash([]);
  }

  _strokeCircle3D(ctx, pointFn, cx, cy, scale, front) {
    let started = false;
    ctx.beginPath();
    for (let deg = 0; deg <= 360; deg += 4) {
      const v = pointFn(deg);
      const p = this.project(v, cx, cy, scale);
      const vis = front ? p.z >= 0 : p.z < 0;
      if (vis) {
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();
  }

  _strokeArc3D(ctx, startDeg, endDeg, stepDeg, pointFn, cx, cy, scale, front) {
    let started = false;
    ctx.beginPath();
    for (let deg = startDeg; deg <= endDeg; deg += stepDeg) {
      const v = pointFn(deg);
      const p = this.project(v, cx, cy, scale);
      const vis = front ? p.z >= 0 : p.z < 0;
      if (vis) {
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();
  }

  _drawAnalemmaCurve(ctx, cx, cy, scale, analemmaPoints, front) {
    if (!analemmaPoints || analemmaPoints.length === 0) return;

    ctx.save();
    ctx.strokeStyle = front ? '#fbbf24' : 'rgba(251, 191, 36, 0.25)';
    ctx.lineWidth = front ? 2.4 : 1.3;
    if (front) {
      ctx.shadowColor = 'rgba(251, 191, 36, 0.65)';
      ctx.shadowBlur = 8;
    }

    let started = false;
    ctx.beginPath();
    for (let i = 0; i < analemmaPoints.length; i++) {
      const pt = analemmaPoints[i];
      const v = this.sphericalToVec3(pt.raRelDeg * this.eotScale, pt.decDeg, 1.0);
      const p = this.project(v, cx, cy, scale);
      const vis = front ? p.z >= 0 : p.z < 0;
      if (vis) {
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawMoonTrail(ctx, cx, cy, scale, front) {
    if (this.moonTrail.length < 2) return;
    ctx.save();
    ctx.strokeStyle = front ? 'rgba(192, 218, 255, 0.55)' : 'rgba(192, 218, 255, 0.18)';
    ctx.lineWidth = front ? 1.6 : 1.0;

    let started = false;
    ctx.beginPath();
    for (let i = 0; i < this.moonTrail.length; i++) {
      const p = this.project(this.moonTrail[i], cx, cy, scale);
      const vis = front ? p.z >= 0 : p.z < 0;
      if (vis) {
        if (i > 0) {
          const prev = this.project(this.moonTrail[i - 1], cx, cy, scale);
          if (Math.hypot(p.x - prev.x, p.y - prev.y) > scale * 0.4) {
            started = false;
          }
        }
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawPolarAxis(ctx, cx, cy, scale) {
    const nPole = this.project({ x: 0, y: 1.12, z: 0 }, cx, cy, scale);
    const sPole = this.project({ x: 0, y: -1.12, z: 0 }, cx, cy, scale);

    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(nPole.x, nPole.y);
    ctx.lineTo(sPole.x, sPole.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#93c5fd';
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NCP', nPole.x, nPole.y - 5);
    ctx.fillStyle = 'rgba(147, 197, 253, 0.6)';
    ctx.fillText('SCP', sPole.x, sPole.y + 11);
    ctx.restore();
  }

  _drawLightRays(ctx, earthProj, sunProj, moonProj) {
    ctx.save();
    // Subtle solar beam from Sun to Earth
    const grad = ctx.createLinearGradient(sunProj.x, sunProj.y, earthProj.x, earthProj.y);
    grad.addColorStop(0, 'rgba(251, 191, 36, 0.38)');
    grad.addColorStop(1, 'rgba(251, 191, 36, 0.05)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(sunProj.x, sunProj.y);
    ctx.lineTo(earthProj.x, earthProj.y);
    ctx.stroke();

    // Subtle solar illumination line from Sun direction toward Moon
    ctx.strokeStyle = 'rgba(253, 224, 71, 0.16)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(sunProj.x, sunProj.y);
    ctx.lineTo(moonProj.x, moonProj.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawBody(ctx, body, cx, cy, scale, sunLightVec, earthRotRad, moonData, city, dpr) {
    if (body.type === 'earth') {
      const earthR = scale * 0.23;
      this._renderShadedEarth(earthR * 2 * dpr, sunLightVec, earthRotRad);
      ctx.save();
      // Subtle atmospheric halo
      const halo = ctx.createRadialGradient(
        body.proj.x, body.proj.y, earthR * 0.85,
        body.proj.x, body.proj.y, earthR * 1.22
      );
      halo.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
      halo.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(body.proj.x, body.proj.y, earthR * 1.22, 0, Math.PI * 2);
      ctx.fill();

      ctx.drawImage(
        this.earthCanvas,
        body.proj.x - earthR,
        body.proj.y - earthR,
        earthR * 2,
        earthR * 2
      );

      // Draw active city marker on the rotating Earth
      const cityLonWorld = city.lon * DEG2RAD + earthRotRad;
      const cityLatWorld = city.lat * DEG2RAD;
      const cityVec = {
        x: 0.23 * Math.cos(cityLatWorld) * Math.sin(cityLonWorld),
        y: 0.23 * Math.sin(cityLatWorld),
        z: 0.23 * Math.cos(cityLatWorld) * Math.cos(cityLonWorld)
      };
      const cityCam = this.worldToCamera(cityVec);
      if (cityCam.z > -0.02) {
        const cityProj = this.project(cityVec, cx, cy, scale);
        ctx.fillStyle = '#f43f5e';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(cityProj.x, cityProj.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fda4af';
        ctx.font = '700 9px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(city.code || 'LA', cityProj.x + 5, cityProj.y + 3);
      }
      ctx.restore();
    } else if (body.type === 'sun') {
      const sunR = Math.max(9, scale * 0.075 * body.proj.persp);
      ctx.save();
      const glow = ctx.createRadialGradient(
        body.proj.x, body.proj.y, sunR * 0.2,
        body.proj.x, body.proj.y, sunR * 2.8
      );
      glow.addColorStop(0, '#ffffff');
      glow.addColorStop(0.25, '#fde047');
      glow.addColorStop(0.55, 'rgba(251, 146, 60, 0.55)');
      glow.addColorStop(1, 'rgba(251, 146, 60, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(body.proj.x, body.proj.y, sunR * 2.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(body.proj.x, body.proj.y, sunR * 0.85, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fde047';
      ctx.font = '600 10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Sun', body.proj.x + sunR + 4, body.proj.y + 3);
      ctx.restore();
    } else if (body.type === 'moon') {
      const moonR = Math.max(8, scale * 0.068 * body.proj.persp);
      this._renderShadedMoon(moonR * 2 * dpr, sunLightVec, body.vec);

      ctx.save();
      // Subtle outline so dark side of Moon is visible against space
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(body.proj.x, body.proj.y, moonR + 0.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.drawImage(
        this.moonCanvas,
        body.proj.x - moonR,
        body.proj.y - moonR,
        moonR * 2,
        moonR * 2
      );

      // Compute whether the camera is currently seeing mostly the Far Side or Near Side of the Moon
      const moonCam = this.worldToCamera(body.vec);
      const mLen = Math.hypot(moonCam.x, moonCam.y, moonCam.z) || 1;
      // Camera looks from +Z toward -Z, so surface facing camera has +Z normal.
      // Outward radial vector (Far Side normal) has Z component moonCam.z / mLen.
      const farSideFraction = Math.round(((moonCam.z / mLen + 1) / 2) * 100);
      const sideLabel = farSideFraction >= 50 ? `Far side (${farSideFraction}%)` : `Near side (${100 - farSideFraction}%)`;

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '600 10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Moon', body.proj.x + moonR + 5, body.proj.y - 2);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 9px Inter, system-ui, sans-serif';
      ctx.fillText(sideLabel, body.proj.x + moonR + 5, body.proj.y + 9);
      ctx.restore();
    }
  }

  _draw3DHud(ctx, W, H, moonProj, moon, sun) {
    ctx.save();
    // Top-left legend inside 3D viewport
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
    ctx.fillText('3D CELESTIAL SPHERE (Mean Solar Frame)', 12, 18);

    ctx.font = '500 10px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.fillText('Sun analemma & lunar orbit • Drag to rotate', 12, 32);
    ctx.restore();
  }
}
