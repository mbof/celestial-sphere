// skyview.js - Simulated East & West sky views from the selected city (default: Los Angeles)
// East View: Azimuth 0° (N) -> 90° (E) -> 180° (S)
// West View: Azimuth 180° (S) -> 270° (W) -> 360° (N)

import {
  LA_COORDS,
  DEG2RAD,
  RAD2DEG,
  equatorialToHorizontal,
  mod360
} from './astronomy.js?v=4';

export class SkyHorizonView {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {'east'|'west'} direction
   */
  constructor(canvas, direction) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.direction = direction; // 'east' (0..180) or 'west' (180..360)
    this.minAz = direction === 'east' ? 0 : 180;
    this.maxAz = direction === 'east' ? 180 : 360;
    this.minAlt = -14; // degrees (shows slightly below horizon for upcoming rise/set)
    this.maxAlt = 88;  // degrees

    // Pre-generate background stars in equatorial coords
    this.stars = [
      [88.79, 7.4, 1.3], [78.63, -8.2, 1.3], [101.28, -16.7, 1.6], [68.98, 16.5, 1.2],
      [114.82, 5.2, 1.1], [152.09, 12.0, 1.1], [201.29, -11.2, 1.1], [247.35, -26.4, 1.2],
      [279.23, 38.8, 1.3], [297.69, 8.9, 1.2], [310.35, 45.3, 1.1], [213.91, 19.2, 1.3],
      [79.17, 46.0, 1.2], [116.32, 28.0, 1.1], [344.41, -29.6, 1.1], [30.97, 42.3, 0.9],
      [130.82, 18.2, 0.8], [240.08, -22.6, 0.9], [283.81, -26.3, 0.9], [6.43, -42.3, 0.9],
      [186.65, -63.1, 1.3], [219.90, -60.8, 1.4], [95.98, -52.7, 1.5]
    ];
  }

  azAltToXY(azDeg, altDeg, W, H) {
    let az = azDeg;
    if (this.direction === 'west' && az < 10) az += 360;
    const x = ((az - this.minAz) / (this.maxAz - this.minAz)) * W;
    const y = H - ((altDeg - this.minAlt) / (this.maxAlt - this.minAlt)) * H;
    return { x, y };
  }

  isAzInView(azDeg) {
    if (this.direction === 'east') {
      return azDeg >= -8 && azDeg <= 188;
    } else {
      return azDeg >= 172 || azDeg <= 8;
    }
  }

  render(state) {
    const { jd, sun, moon, analemmaPoints, city = LA_COORDS } = state;
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

    const sunHoriz = equatorialToHorizontal(sun.ra, sun.dec, jd, city.lat, city.lon);
    const moonHoriz = equatorialToHorizontal(moon.ra, moon.dec, jd, city.lat, city.lon);

    // 1. Dynamic sky gradient based on Sun's current altitude in the selected city
    this._drawSkyBackground(ctx, W, H, sunHoriz);

    // 2. Stars (visible during night / twilight)
    const starAlpha = Math.max(0, Math.min(0.85, (-sunHoriz.alt + 4) / 14));
    if (starAlpha > 0.02) {
      this._drawStars(ctx, W, H, jd, starAlpha, city);
    }

    // 3. Altitude / Azimuth Grid & Diurnal Reference Tracks
    this._drawSkyGridAndTracks(ctx, W, H, city);

    // 4. Local Sky Analemma at current time-of-day
    this._drawLocalSkyAnalemma(ctx, W, H, jd, analemmaPoints, city);

    // 5. Today's active Sun & Moon diurnal paths across the local sky
    this._drawDiurnalArc(ctx, W, H, sun.dec, city.lat, 'rgba(251, 191, 36, 0.35)', [3, 3]);
    this._drawDiurnalArc(ctx, W, H, moon.dec, city.lat, 'rgba(186, 230, 253, 0.25)', [2, 3]);

    // 6. Draw Sun if in this hemisphere view
    if (this.isAzInView(sunHoriz.az)) {
      this._drawSunInSky(ctx, W, H, sunHoriz);
    }

    // 7. Draw Moon with accurate Earth-observed phase & bright-limb orientation if in this hemisphere view
    if (this.isAzInView(moonHoriz.az)) {
      this._drawMoonInSky(ctx, W, H, moonHoriz, moon, sunHoriz);
    }

    // 8. Draw Horizon Silhouette & Ground
    this._drawLAHorizon(ctx, W, H);

    // 9. Cardinal Labels & View Header
    this._drawLabels(ctx, W, H, sunHoriz, moonHoriz, moon, city);

    ctx.restore();
  }

  _drawSkyBackground(ctx, W, H, sunHoriz) {
    const horizonY = this.azAltToXY(90, 0, W, H).y;
    const alt = sunHoriz.alt;

    let topColor, midColor, horizColor;
    const isSunSide =
      (this.direction === 'east' && sunHoriz.az < 180) ||
      (this.direction === 'west' && sunHoriz.az >= 180);

    if (alt <= -12) {
      topColor = '#040711';
      midColor = '#091124';
      horizColor = '#111c35';
    } else if (alt < 4) {
      const t = (alt + 12) / 16;
      const warm = isSunSide ? 1.0 : 0.45;
      topColor = this._lerpColor('#040711', '#1d4ed8', t);
      midColor = this._lerpColor('#091124', isSunSide ? '#7c3aed' : '#1e3a8a', t);
      horizColor = this._lerpColor('#111c35', warm > 0.7 ? '#f97316' : '#3b82f6', t);
    } else {
      const d = Math.min(1, (alt - 4) / 40);
      topColor = this._lerpColor('#1d4ed8', '#0284c7', d);
      midColor = this._lerpColor('#3b82f6', '#38bdf8', d);
      horizColor = this._lerpColor('#93c5fd', '#bae6fd', d);
    }

    const grad = ctx.createLinearGradient(0, 0, 0, horizonY);
    grad.addColorStop(0, topColor);
    grad.addColorStop(0.62, midColor);
    grad.addColorStop(1, horizColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, horizonY);

    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, horizonY, W, H - horizonY);
  }

  _lerpColor(hex1, hex2, t) {
    const c1 = parseInt(hex1.slice(1), 16);
    const c2 = parseInt(hex2.slice(1), 16);
    const r = Math.round(((c1 >> 16) & 255) * (1 - t) + ((c2 >> 16) & 255) * t);
    const g = Math.round(((c1 >> 8) & 255) * (1 - t) + ((c2 >> 8) & 255) * t);
    const b = Math.round((c1 & 255) * (1 - t) + (c2 & 255) * t);
    return `rgb(${r},${g},${b})`;
  }

  _drawStars(ctx, W, H, jd, alpha, city) {
    ctx.save();
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    for (const [ra, dec, mag] of this.stars) {
      const h = equatorialToHorizontal(ra, dec, jd, city.lat, city.lon);
      if (h.alt > 0 && this.isAzInView(h.az)) {
        const pt = this.azAltToXY(h.az, h.alt, W, H);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, mag * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  _drawSkyGridAndTracks(ctx, W, H, city) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 0.8;

    for (const alt of [30, 60]) {
      const y = this.azAltToXY(this.minAz, alt, W, H).y;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    for (let az = this.minAz + 45; az < this.maxAz; az += 45) {
      const x = this.azAltToXY(az, 0, W, H).x;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    // Celestial Equator path (dec = 0°)
    this._drawDiurnalArc(ctx, W, H, 0, city.lat, 'rgba(96, 165, 250, 0.22)', []);
    ctx.restore();
  }

  _drawDiurnalArc(ctx, W, H, decDeg, latDeg, color, dash) {
    const lat = latDeg * DEG2RAD;
    const dec = decDeg * DEG2RAD;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.1;
    ctx.setLineDash(dash);
    ctx.beginPath();

    let started = false;
    const haStart = this.direction === 'east' ? -180 : 0;
    const haEnd = this.direction === 'east' ? 0 : 180;
    for (let haDeg = haStart; haDeg <= haEnd; haDeg += 3) {
      const ha = haDeg * DEG2RAD;
      const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
      const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD2DEG;
      const y = -Math.sin(ha) * Math.cos(dec);
      const x = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(ha);
      const az = mod360(Math.atan2(y, x) * RAD2DEG);

      if (alt >= this.minAlt && this.isAzInView(az)) {
        const pt = this.azAltToXY(az, alt, W, H);
        if (!started) {
          ctx.moveTo(pt.x, pt.y);
          started = true;
        } else {
          ctx.lineTo(pt.x, pt.y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawLocalSkyAnalemma(ctx, W, H, currentJd, analemmaPoints, city) {
    if (!analemmaPoints || analemmaPoints.length === 0) return;

    const dayFrac = (currentJd - 0.5) - Math.floor(currentJd - 0.5);

    ctx.save();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.50)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();

    let started = false;
    for (let i = 0; i < analemmaPoints.length; i += 3) {
      const pt = analemmaPoints[i];
      const baseDay = Math.floor(pt.jd - 0.5) + 0.5 + dayFrac;
      const h = equatorialToHorizontal(pt.ra, pt.decDeg, baseDay, city.lat, city.lon);
      if (h.alt >= this.minAlt && this.isAzInView(h.az)) {
        const xy = this.azAltToXY(h.az, h.alt, W, H);
        if (!started) {
          ctx.moveTo(xy.x, xy.y);
          started = true;
        } else {
          ctx.lineTo(xy.x, xy.y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawSunInSky(ctx, W, H, sunHoriz) {
    const { x, y } = this.azAltToXY(sunHoriz.az, sunHoriz.alt, W, H);
    const belowHorizon = sunHoriz.alt < 0;

    ctx.save();
    if (belowHorizon) ctx.globalAlpha = 0.45;

    const r = 9;
    const glow = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 2.8);
    glow.addColorStop(0, '#ffffff');
    glow.addColorStop(0.3, '#fde047');
    glow.addColorStop(0.65, 'rgba(249, 115, 22, 0.55)');
    glow.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fef9c3';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fef08a';
    ctx.font = '600 9px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`☀ ${Math.round(sunHoriz.alt)}°`, x, y - r - 4);
    ctx.restore();
  }

  _drawMoonInSky(ctx, W, H, moonHoriz, moon, sunHoriz) {
    const { x, y } = this.azAltToXY(moonHoriz.az, moonHoriz.alt, W, H);
    const belowHorizon = moonHoriz.alt < 0;

    ctx.save();
    if (belowHorizon) ctx.globalAlpha = 0.45;

    const r = 9.5;
    const zenithLimbAngle = moon.brightLimbPA - moonHoriz.parallacticAngle;

    this.drawEarthPhaseMoonDisk(ctx, x, y, r, moon.synodicAge, moon.illuminatedFraction, zenithLimbAngle);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 9px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`☽ ${Math.round(moonHoriz.alt)}°`, x, y - r - 4);
    ctx.restore();
  }

  drawEarthPhaseMoonDisk(ctx, cx, cy, r, synodicAge, k, rotationRad = 0) {
    ctx.save();
    ctx.translate(cx, cy);
    const isWaxing = synodicAge <= 0.5;
    const defaultLimbAngle = isWaxing ? Math.PI / 2 : -Math.PI / 2;
    ctx.rotate(rotationRad - defaultLimbAngle);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();

    const phaseCos = 2 * k - 1;
    const rx = Math.abs(phaseCos) * r;

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    if (isWaxing) {
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.ellipse(0, 0, rx, r, 0, Math.PI / 2, -Math.PI / 2, phaseCos < 0);
    } else {
      ctx.arc(0, 0, r, Math.PI / 2, -Math.PI / 2, false);
      ctx.ellipse(0, 0, rx, r, 0, -Math.PI / 2, Math.PI / 2, phaseCos < 0);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(71, 85, 105, 0.22)';
    ctx.beginPath();
    ctx.arc(-r * 0.25, -r * 0.22, r * 0.28, 0, Math.PI * 2);
    ctx.arc(r * 0.18, -r * 0.10, r * 0.24, 0, Math.PI * 2);
    ctx.arc(r * 0.28, r * 0.15, r * 0.20, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _drawLAHorizon(ctx, W, H) {
    const horizonY = this.azAltToXY(this.minAz, 0, W, H).y;

    ctx.save();
    ctx.fillStyle = 'rgba(8, 12, 22, 0.72)';
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, horizonY);

    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const x = u * W;
      let elevPx = 0;
      if (this.direction === 'east') {
        elevPx =
          Math.exp(-Math.pow((u - 0.35) / 0.22, 2)) * 12 +
          Math.sin(u * 18) * 1.8 * (u < 0.7 ? 1 : 0.3);
      } else {
        if (u > 0.62) {
          elevPx = Math.exp(-Math.pow((u - 0.82) / 0.16, 2)) * 9 + Math.sin(u * 15) * 1.2;
        }
      }
      ctx.lineTo(x, horizonY - Math.max(0, elevPx));
    }
    ctx.lineTo(W, horizonY);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(W, horizonY);
    ctx.stroke();
    ctx.restore();
  }

  _drawLabels(ctx, W, H, sunHoriz, moonHoriz, moon, city) {
    const horizonY = this.azAltToXY(this.minAz, 0, W, H).y;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillRect(6, 6, 136, 20);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.strokeRect(6, 6, 136, 20);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    const code = city.code || 'LA';
    const title = this.direction === 'east' ? `${code} SKY • FACING EAST` : `${code} SKY • FACING WEST`;
    ctx.fillText(title, 11, 19);

    const cardinals =
      this.direction === 'east'
        ? [
            { az: 10, label: 'N' },
            { az: 45, label: 'NE' },
            { az: 90, label: 'E (Rise)' },
            { az: 135, label: 'SE' },
            { az: 170, label: 'S' }
          ]
        : [
            { az: 190, label: 'S' },
            { az: 225, label: 'SW' },
            { az: 270, label: 'W (Set)' },
            { az: 315, label: 'NW' },
            { az: 350, label: 'N' }
          ];

    ctx.font = '600 9px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const c of cardinals) {
      const x = this.azAltToXY(c.az, 0, W, H).x;
      ctx.fillStyle = c.az === 90 || c.az === 270 ? '#38bdf8' : 'rgba(203, 213, 225, 0.8)';
      ctx.fillText(c.label, x, horizonY + 11);
    }

    if (this.direction === 'west') {
      const boxW = 86;
      const boxH = 32;
      const bx = W - boxW - 6;
      const by = 6;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
      ctx.strokeRect(bx, by, boxW, boxH);

      const zenithLimbAngle = moon.brightLimbPA - moonHoriz.parallacticAngle;
      this.drawEarthPhaseMoonDisk(
        ctx,
        bx + 16,
        by + 16,
        10,
        moon.synodicAge,
        moon.illuminatedFraction,
        zenithLimbAngle
      );

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '600 9px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Earth view', bx + 31, by + 14);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 8px Inter, system-ui, sans-serif';
      ctx.fillText(`${Math.round(moon.illuminatedFraction * 100)}% lit`, bx + 31, by + 25);
    }

    ctx.restore();
  }
}
