// app.js - Main application controller for Celestial sphere & sky simulator

import {
  dateToJD,
  getSunPosition,
  getMoonPosition,
  getGMST,
  precomputeAnalemma
} from './astronomy.js?v=4';
import { CelestialSphere3D } from './sphere3d.js?v=4';
import { SkyHorizonView } from './skyview.js?v=4';
import { WORLD_CITIES } from './cities.js?v=4';

const YEAR_START_UTC_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3600000;

class CelestialApp {
  constructor() {
    this.cities = WORLD_CITIES;
    this.currentCity = this.cities[0]; // Default: Los Angeles

    // Default start: March 20, 2026 (vernal equinox) at 09:30 local time
    this.dayOfYear = 78;
    this.localHour = 9.5;

    this.isPlaying = false;
    this.mode = 'continuous'; // 'continuous' | 'strobe'
    this.daysPer5Sec = 1;     // Default: 1 day per 5 seconds

    this.lastFrameTs = null;
    this.analemmaPoints = precomputeAnalemma(2026);

    // Initialize view renderers
    this.sphereView = new CelestialSphere3D(document.getElementById('sphereCanvas'));
    this.skyEastView = new SkyHorizonView(document.getElementById('skyEastCanvas'), 'east');
    this.skyWestView = new SkyHorizonView(document.getElementById('skyWestCanvas'), 'west');

    this.sphereView.onCameraMove = () => {
      if (!this.isPlaying) this.renderCurrentState();
    };

    this._bindUI();
    window.addEventListener('resize', () => this.renderCurrentState());

    this.renderCurrentState();
  }

  getSimTimestampMs() {
    const cityStartMs = YEAR_START_UTC_MS - this.currentCity.tz * MS_PER_HOUR;
    return cityStartMs + Math.floor(this.dayOfYear) * MS_PER_DAY + this.localHour * MS_PER_HOUR;
  }

  _bindUI() {
    this.citySelect = document.getElementById('citySelect');
    this.playPauseBtn = document.getElementById('playPauseBtn');
    this.playIcon = document.getElementById('playIcon');
    this.playLabel = document.getElementById('playLabel');
    this.daySlider = document.getElementById('daySlider');
    this.timeSlider = document.getElementById('timeSlider');
    this.timeSliderLabel = document.getElementById('timeSliderLabel');
    this.timeSliderVal = document.getElementById('timeSliderVal');
    this.datePicker = document.getElementById('datePicker');

    this.dateDisplay = document.getElementById('dateDisplay');
    this.timeDisplay = document.getElementById('timeDisplay');
    this.sunMetric = document.getElementById('sunMetric');
    this.moonMetric = document.getElementById('moonMetric');

    this.camResetBtn = document.getElementById('camResetBtn');
    this.speedPills = Array.from(document.querySelectorAll('.speed-pill'));

    // Populate city dropdown with Los Angeles + 100 largest metropolises
    if (this.citySelect) {
      this.citySelect.innerHTML = '';
      this.cities.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        const latHem = c.lat >= 0 ? 'N' : 'S';
        opt.textContent = `${c.name}, ${c.country} (${Math.abs(c.lat).toFixed(1)}°${latHem})`;
        this.citySelect.appendChild(opt);
      });
      this.citySelect.value = this.currentCity.id;

      this.citySelect.addEventListener('change', (e) => {
        const found = this.cities.find((c) => c.id === e.target.value);
        if (found) {
          this.currentCity = found;
          this.renderCurrentState();
        }
      });
    }

    // Play / pause button
    this.playPauseBtn.addEventListener('click', () => {
      this.isPlaying = !this.isPlaying;
      if (this.isPlaying) {
        this.lastFrameTs = performance.now();
        requestAnimationFrame((ts) => this._tick(ts));
      }
      this._updatePlayButtonUI();
    });

    // Speed pills
    this.speedPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        this.speedPills.forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        this.mode = pill.getAttribute('data-mode') || 'continuous';
        const rawSpeed = pill.getAttribute('data-speed') || pill.getAttribute('data-days-per-5s') || '1';
        const parsed = parseFloat(rawSpeed);
        this.daysPer5Sec = Number.isFinite(parsed) ? parsed : 1;
        this._updatePlayButtonUI();
        this.renderCurrentState();
      });
    });

    // Day of year slider
    this.daySlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (Number.isFinite(val)) {
        this.dayOfYear = val;
        this.renderCurrentState();
      }
    });

    // Time of day slider (local standard hours 0..24)
    this.timeSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (Number.isFinite(val)) {
        this.localHour = val;
        this.renderCurrentState();
      }
    });

    // Date picker
    this.datePicker.addEventListener('change', (e) => {
      if (!e.target.value) return;
      const parts = e.target.value.split('-').map(Number);
      if (parts.length === 3) {
        const pickedMs = Date.UTC(2026, parts[1] - 1, parts[2], 0, 0, 0);
        const diffDays = Math.max(0, Math.min(365, Math.round((pickedMs - YEAR_START_UTC_MS) / MS_PER_DAY)));
        this.dayOfYear = diffDays;
        this.renderCurrentState();
      }
    });

    // Reset 3D camera
    if (this.camResetBtn) {
      this.camResetBtn.addEventListener('click', () => {
        this.sphereView.camYaw = -0.32;
        this.sphereView.camPitch = 0.30;
        this.sphereView.camZoom = 1.0;
        this.renderCurrentState();
      });
    }
  }

  _updatePlayButtonUI() {
    this.playPauseBtn.classList.toggle('playing', this.isPlaying);
    this.playIcon.textContent = this.isPlaying ? '⏸' : '▶';
    const rateLabel =
      this.mode === 'strobe'
        ? 'Strobe 1d/step'
        : `${this.daysPer5Sec}d = 5s`;
    this.playLabel.textContent = `${this.isPlaying ? 'Pause' : 'Play'} (${rateLabel})`;
  }

  _tick(now) {
    if (!this.isPlaying) return;
    const dtSec = Math.min(0.1, (now - (this.lastFrameTs || now)) / 1000);
    this.lastFrameTs = now;

    const speed = Number.isFinite(this.daysPer5Sec) ? this.daysPer5Sec : 1;
    const deltaDays = (dtSec / 5.0) * speed;

    if (this.mode === 'continuous') {
      const totalHours = this.localHour + deltaDays * 24.0;
      const addedDays = Math.floor(totalHours / 24.0);
      this.localHour = ((totalHours % 24.0) + 24.0) % 24.0;
      this.dayOfYear = ((this.dayOfYear + addedDays) % 365 + 365) % 365;
    } else {
      // Strobe mode: keeps this.localHour fixed while advancing dayOfYear
      this.dayOfYear = ((this.dayOfYear + deltaDays) % 365 + 365) % 365;
    }

    this.renderCurrentState();
    requestAnimationFrame((ts) => this._tick(ts));
  }

  renderCurrentState() {
    const simMs = this.getSimTimestampMs();
    const jd = dateToJD(simMs);
    const sun = getSunPosition(jd);
    const moon = getMoonPosition(jd, sun);
    const gmst = getGMST(jd);

    const state = {
      jd,
      sun,
      moon,
      gmst,
      city: this.currentCity,
      analemmaPoints: this.analemmaPoints
    };

    // Render all 3 canvases
    this.sphereView.render(state);
    this.skyEastView.render(state);
    this.skyWestView.render(state);

    // Update UI readouts & sliders
    this._updateTelemetryUI(simMs, sun, moon);
  }

  _updateTelemetryUI(simMs, sun, moon) {
    const localDate = new Date(simMs + this.currentCity.tz * MS_PER_HOUR);
    const yyyy = localDate.getUTCFullYear();
    const mm = String(localDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(localDate.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const hrs = Math.floor(this.localHour);
    const mins = Math.floor((this.localHour - hrs) * 60);
    const timeStr = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

    const tzSign = this.currentCity.tz >= 0 ? '+' : '';
    const tzStr = `UTC${tzSign}${this.currentCity.tz}`;

    this.dateDisplay.textContent = dateStr;
    this.timeDisplay.textContent = `${timeStr} ${tzStr}`;
    this.timeSliderVal.textContent = timeStr;
    if (this.timeSliderLabel) {
      this.timeSliderLabel.textContent = `${this.currentCity.code} local time`;
    }

    if (document.activeElement !== this.datePicker) {
      this.datePicker.value = dateStr;
    }
    this.daySlider.value = this.dayOfYear;
    this.timeSlider.value = this.localHour;

    const decSign = sun.dec >= 0 ? '+' : '';
    const eotSign = sun.eotMin >= 0 ? '+' : '';
    this.sunMetric.textContent = `${decSign}${sun.dec.toFixed(1)}° • ${eotSign}${sun.eotMin.toFixed(1)}m`;

    const pct = Math.round(moon.illuminatedFraction * 100);
    this.moonMetric.textContent = `${moon.phaseName} (${pct}%)`;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new CelestialApp();
});
