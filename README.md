# Last Beacon - Offline Survival Coordination System

![Last Beacon Banner](https://img.shields.io/badge/Status-Operational-brightgreen?style=for-the-badge)
![Tech Stack](https://img.shields.io/badge/Stack-Vanilla%20JS%20%7C%20HTML5%20Canvas%20%7C%20CSS3-blue?style=for-the-badge)
![PWA](https://img.shields.io/badge/PWA-Offline--First-orange?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-purple?style=for-the-badge)

> **"When central infrastructure fails, routing becomes a question of survival."**

**Last Beacon** is an offline-first, browser-native tactical emergency coordination system designed for post-outbreak and infrastructure-collapse scenarios. Operating with **zero cloud dependencies**, it simulates contagion diffusion across an urban road network, dynamic physical blockages, and autonomous multi-survivor escape routing using graph algorithms.

---

## 🌟 Key Features

- 🧠 **Dynamic Threat-Aware Routing**: Real-time pathfinding via Dijkstra's Algorithm with dynamic threat weighting, recalculating escape paths instantaneously as safe nodes get compromised.
- 👥 **Multi-Survivor Autonomous Navigation**: Simulates simultaneous survivors (e.g., Aarav and Mira) starting from distinct city sectors navigating toward designated safe havens while managing resource health (HP).
- ☣️ **Contagion Diffusion & Road Closures**:
  - **Patient Zero Outbreaks**: Procedurally seeded infection hotspots.
  - **Contagion Spread**: BFS-based radial infection expansion to adjacent topological nodes.
  - **Infection-Driven Road Blockages**: Physical road debris and barricades that radiate directly from contaminated sectors.
- ⚡ **100% Offline-First Architecture**: Built using standard Web APIs, Canvas 2D, and Service Workers (`sw.js`). No internet or external server required after first load.
- 🎨 **Tactical HUD & Visualizer**: Glassmorphic dark-mode tactical interface with animated edge pulses, survivor tokens, risk badges, and real-time mission telemetry.

---

## 🔬 Algorithms & Technical Architecture

### 1. Shortest Path with Dynamic Penalization (Dijkstra)
- **Time Complexity**: $\mathcal{O}((V + E) \log V)$ using a priority queue / min-heap abstraction.
- **Dynamic Cost Function**: Safe roads retain base traversal costs. Roads nearing infected zones incur steep cost multipliers, forcing the algorithm to seek longer but safer detours. If no safe path exists, survivors navigate through contaminated sectors as a calculated hazard.

### 2. Radial Infection Spread (Breadth-First Search)
- **Topological Contagion**: Infection does not spread purely geographically, but along connected infrastructure (transit corridors and physical road links) modeled as graph edges.

### 3. Dynamic Hazard Barriers
- Blocked road segments emerge from active infection perimeters per tick, simulating crowd stampedes, abandoned vehicles, or military quarantine perimeters.

---

## 📂 Project Structure

```text
last-beacon/
├── index.html       # Primary application entry point & HUD layout
├── style.css        # Responsive dark tactical glassmorphism theme
├── app.js           # Controller & event orchestration
├── state.js         # Central simulation state & survivor lifecycle
├── threat-sim.js    # Contagion spread & dynamic road closure engine
├── renderer.js      # High-performance HTML5 Canvas graph visualizer
├── graph.js         # Graph data structure & Dijkstra pathfinder
├── sw.js            # PWA Service Worker for offline caching
├── manifest.json    # Progressive Web App manifest
└── test.html        # Test suite & unit validation runner
```

---

## 🚀 Getting Started

### Option 1: Direct Browser Launch (No Installation Required)
Simply open `index.html` in any modern web browser (Chrome, Firefox, Edge, Safari):
```bash
# Double-click index.html or launch via terminal
start index.html
```

### Option 2: Local Static Server (Recommended for PWA Service Worker)
```bash
# Using Python
python -m http.server 8080

# Then open in browser:
# http://localhost:8080
```

---

## 🎮 How to Use

1. **Start / Resume**: Press the **START** button in the control console to begin the simulation.
2. **Step-by-Step Mode**: Use the **STEP** button to advance the clock tick-by-tick and observe how survivors react when roads are blocked in real-time.
3. **Reset**: Resets the simulation, clears past routes, and randomly selects new Patient Zero outbreak sites.
4. **Live Telemetry**: Watch survivor health, active contagion nodes, blocked corridors, and reroute frequency update in real time.

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
