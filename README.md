# Celestial sphere and sky simulator

Interactive browser simulation of the Sun and Moon on the 3D celestial sphere and in the local sky across the year.

**[Try it now](https://mbof.github.io/celestial-sphere/)**

## What the application does

The simulator shows how Earth's axial tilt, orbital eccentricity, and daily rotation shape what an observer sees in the sky from over 100 major cities around the world.

It combines two synchronized views:

- **3D celestial sphere (upper view):** Renders a rotating, sunlit Earth at the center of the celestial sphere in the mean solar reference frame. Shows the celestial equator, tropics, ecliptic, bright stars, the figure-8 solar analemma, and a 3D sunlit Moon along its orbital track (indicating whether the camera faces the near side or far side). Drag to rotate the camera and scroll or pinch to zoom.
- **Local east and west sky (lower view):** Shows side-by-side horizon views facing east (0° to 180° azimuth) and west (180° to 360° azimuth) for the selected city. Displays day, twilight, and night sky colors, background stars, daily paths for the Sun and Moon, the local-time solar analemma, and the Moon's disk with its Earth-observed phase and bright-limb angle.

## Controls and readouts

- **City selector:** Choose the observer location from over 100 metropolitan areas worldwide, updating latitude, longitude, and standard UTC offset.
- **Telemetry bar:** Displays the current local date and time, solar declination and equation of time (in minutes), and lunar phase name with illumination percentage.
- **Playback modes:** Play continuously at 1, 7, or 30 simulated days per 5 seconds, or use `Strobe 1d/step` mode to hold the local time of day fixed while stepping through the year so the Sun traces the analemma without daily spinning.
- **Date and time scrubbers:** Pick a specific date or drag the day-of-year and local-time sliders to inspect any moment directly.

## Project structure

- `index.html` — Page layout for the telemetry header, 3D sphere canvas, east/west sky canvases, and playback controls.
- `styles.css` — Responsive dark layout for mobile and desktop screens.
- `app.js` — Main controller managing simulation time, animation loop, city selection, and UI bindings.
- `astronomy.js` — Solar and lunar position calculations, equation of time, Greenwich mean sidereal time, equatorial-to-horizontal coordinate conversion, and analemma precomputation.
- `sphere3d.js` — Canvas 2D renderer for the interactive 3D celestial sphere, per-pixel shaded Earth, and tidally locked 3D Moon.
- `skyview.js` — Canvas 2D renderer for the east and west local horizon views, daily arcs, twilight gradients, and oriented lunar phase disk.
- `cities.js` — Coordinates and standard time zone offsets for over 100 world cities.

## Running locally

The app uses standard ES modules with no build step or external dependencies. Serve the directory over HTTP and open it in a browser:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
