/**
 * LAST BEACON — Main Application Controller
 *
 * Wires together: AppState, MapRenderer, ThreatSimulator, and all UI controls.
 * The ThreatSimulator runs automatically and is fully stopped before any reset.
 */

'use strict';

class App {
  constructor() {
    this.state    = new window.LastBeacon.AppState();
    this.renderer = new window.LastBeacon.MapRenderer(
      document.getElementById('city-map'),
      this.state
    );
    // One authoritative threat simulator instance — never create a second one
    this.threatSim = new window.LastBeacon.ThreatSimulator(this.state);

    this._resetTimer  = null;   // timeout for two-click reset confirmation
    this._notifTimer  = null;   // timeout for notification auto-hide

    this._initControls();
    this._initStateListeners();
    this.renderer.render();
    this._updateUI();
    this._renderLog();

    // Start automatic threat simulation immediately on load
    this.threatSim.start();
    this._updateSimToggleBtn();
  }

  // ─── State Listener ─────────────────────────────────────────────────────────
  _initStateListeners() {
    this.state.on(event => {
      // Always re-render map and UI on any state change
      this.renderer.render();
      this._updateUI();
      this._renderLog();

      switch (event.type) {
        case 'REROUTE':
          this._flashNotification(`🔄 Route Recalculated! ${event.reason}`, 'reroute');
          break;
        case 'NO_ROUTE':
          this._flashNotification('⚠ NO SAFE ROUTE EXISTS! Consider reopening roads.', 'danger');
          break;
        case 'ROAD_BLOCKED':
          if (event.auto) {
            this._flashNotification(
              `🧟 AUTO-BLOCK: Road ${event.edgeId} overrun by zombies!`, 'danger');
          } else {
            this._flashNotification(`🧟 Road ${event.edgeId} manually blocked!`, 'danger');
          }
          break;
        case 'ROAD_UNBLOCKED':
          this._flashNotification(`✅ Road ${event.edgeId} cleared!`, 'success');
          break;
        case 'CACHE_COLLECTED':
          this._flashNotification(`📦 Supply cache collected at ${event.nodeId}!`, 'success');
          break;
        case 'MISSION_COMPLETE':
          this._flashNotification('🏆 MISSION COMPLETE! You reached the Beacon!', 'success');
          document.getElementById('advance-btn').disabled = true;
          // Stop sim automatically on mission complete
          this.threatSim.stop();
          this._updateSimToggleBtn();
          break;
        case 'RESET':
          this._flashNotification('🔄 Simulation fully reset to initial state.', 'info');
          document.getElementById('advance-btn').disabled = false;
          document.getElementById('selected-edge-info').textContent =
            'Click a road on the map to inspect it.';
          this._cancelResetConfirm();
          this._updateSimToggleBtn();
          break;
        case 'IRRELEVANT_BLOCK':
          this._flashNotification(
            `ℹ Road ${event.edgeId} blocked — not on active route, no reroute needed.`, 'info');
          break;
        case 'SIM_STARTED':
        case 'SIM_STOPPED':
          this._updateSimToggleBtn();
          break;
        case 'PATIENT_ZEROS': {
          const labels = (event.nodes || []).map(id => {
            const n = this.state.graph.nodes[id];
            return n ? n.label.replace('\n', ' ') : id;
          }).join(' & ');
          this._flashNotification(`☣ OUTBREAK: ${labels} are Patient Zeros!`, 'danger');
          break;
        }
        case 'PATIENT_ZERO': {
          // legacy single-zero event
          const pzNode = this.state.graph.nodes[event.nodeId];
          const pzLabel = pzNode ? pzNode.label.replace('\n', ' ') : event.nodeId;
          this._flashNotification(`☣ OUTBREAK: ${pzLabel} is Patient Zero!`, 'danger');
          break;
        }
        case 'ZONE_MOVED': {
          const newLabels = (event.newZones || [])
            .map(id => { const n = this.state.graph.nodes[id]; return n ? n.label.replace('\n', ' ') : id; })
            .join(' & ');
          this._flashNotification(`☣ Infection spreads to ${newLabels}!`, 'warn');
          break;
        }
        case 'MIRA_REROUTE':
          this._flashNotification(`🔄 Mira rerouted!`, 'reroute');
          break;
        case 'MIRA_NO_ROUTE':
          this._flashNotification('⚠ Mira has NO SAFE ROUTE! She is staying put.', 'danger');
          break;
        case 'ALL_DONE':
          this._flashNotification('🏆 MISSION COMPLETE — Both survivors reached the Beacon!', 'success');
          this.threatSim.stop();
          this._updateSimToggleBtn();
          break;
        case 'MISSION_COMPLETE': {
          const who = event.who === 'mira' ? 'Mira 👩' : 'Aarav 🧑';
          this._flashNotification(`🏁 ${who} reached the Beacon!`, 'success');
          break;
        }
        case 'THREAT_TICK':
          break;
        default:
          break;
      }
    });
  }

  // ─── Controls ────────────────────────────────────────────────────────────────
  _initControls() {
    // ── Populate dropdowns ───────────────────────────────────────────────────
    this._populateEdgeSelector('block-road-select');
    this._populateEdgeSelector('unblock-road-select');
    this._populateEdgeSelector('threat-road-select');

    const cacheSelect = document.getElementById('cache-node-select');
    Object.keys(window.LastBeacon.CACHE_SUPPLIES).forEach(nodeId => {
      const opt = document.createElement('option');
      opt.value = nodeId;
      const node = this.state.graph.nodes[nodeId];
      opt.textContent = node ? node.label.replace('\n', ' ') : nodeId;
      cacheSelect.appendChild(opt);
    });

    // ── Manual road controls ─────────────────────────────────────────────────
    document.getElementById('block-btn').addEventListener('click', () => {
      const edgeId = document.getElementById('block-road-select').value;
      if (!edgeId) return;
      this.state.blockRoad(edgeId);
    });

    document.getElementById('unblock-btn').addEventListener('click', () => {
      const edgeId = document.getElementById('unblock-road-select').value;
      if (!edgeId) return;
      this.state.unblockRoad(edgeId);
    });

    document.getElementById('threat-btn').addEventListener('click', () => {
      const edgeId = document.getElementById('threat-road-select').value;
      const level  = parseInt(document.getElementById('threat-level-input').value, 10);
      if (!edgeId || isNaN(level)) return;
      this.state.setThreat(edgeId, level);
    });

    // ── Map click: block / unblock selected road ─────────────────────────────
    document.getElementById('block-selected-btn').addEventListener('click', () => {
      const edgeId = this.renderer.selectedEdge;
      if (!edgeId) {
        this._flashNotification('Click a road on the map first to select it.', 'warn');
        return;
      }
      this.state.blockRoad(edgeId);
      this.renderer.clearSelectedEdge();
    });

    document.getElementById('unblock-selected-btn').addEventListener('click', () => {
      const edgeId = this.renderer.selectedEdge;
      if (!edgeId) {
        this._flashNotification('Click a road on the map first to select it.', 'warn');
        return;
      }
      this.state.unblockRoad(edgeId);
      this.renderer.clearSelectedEdge();
    });

    // Sync map selection → dropdowns + info panel
    this.renderer.onEdgeSelect(edgeId => {
      ['block-road-select', 'unblock-road-select', 'threat-road-select'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) sel.value = edgeId;
      });
      this._updateSelectedEdgeInfo(edgeId);
    });

    // ── Simulation controls ──────────────────────────────────────────────────
    document.getElementById('advance-btn').addEventListener('click', () => {
      // Manual single-step (also works while sim is paused)
      this.state.advanceSimulation();
    });

    // Start / Pause toggle
    document.getElementById('sim-toggle-btn').addEventListener('click', () => {
      if (this.threatSim.isRunning) {
        this.threatSim.stop();
      } else {
        this.threatSim.start();
      }
      this._updateSimToggleBtn();
    });

    // ── Reset (two-click confirm, no browser dialog) ─────────────────────────
    document.getElementById('reset-btn').addEventListener('click', () => {
      const btn = document.getElementById('reset-btn');
      if (btn.dataset.confirm === 'pending') {
        this._doReset();
      } else {
        // First click: enter confirmation mode
        btn.dataset.confirm = 'pending';
        btn.textContent     = '⚠ Click again to confirm reset';
        btn.classList.replace('btn-ghost', 'btn-danger');
        this._resetTimer = setTimeout(() => this._cancelResetConfirm(), 3000);
      }
    });

    // ── Cache depletion ──────────────────────────────────────────────────────
    document.getElementById('deplete-cache-btn').addEventListener('click', () => {
      const nodeId = document.getElementById('cache-node-select').value;
      if (!nodeId) return;
      this.state.depleteCache(nodeId);
    });

    // ── Chaos Mode ──────────────────────────────────────────────────────────
    document.getElementById('chaos-btn').addEventListener('click', () => {
      ['e23', 'e24'].forEach(eid => this.state.blockRoad(eid));
    });
  }

  // ─── Reset helpers ──────────────────────────────────────────────────────────
  _doReset() {
    // 1. Stop the threat simulator FIRST
    this.threatSim.reset();

    // 2. Cancel any pending reset-confirm timer
    this._cancelResetConfirm();

    // 3. Clear map selection
    this.renderer.clearSelectedEdge();

    // 4. Reset all application state
    this.state.resetSimulation();

    // 5. Force a complete UI refresh
    this.renderer.render();
    this._updateUI();
    this._renderLog();

    // 6. Re-enable advance button (in case mission was complete)
    document.getElementById('advance-btn').disabled = false;
    document.getElementById('selected-edge-info').textContent =
      'Click a road on the map to inspect it.';

    // 7. Restart threat simulation after a small delay
    setTimeout(() => {
      this.threatSim.start();
      this._updateSimToggleBtn();
    }, 300);
  }

  _cancelResetConfirm() {
    clearTimeout(this._resetTimer);
    this._resetTimer = null;
    const btn = document.getElementById('reset-btn');
    if (!btn) return;
    delete btn.dataset.confirm;
    btn.textContent = '↺ Reset Simulation';
    if (btn.classList.contains('btn-danger')) {
      btn.classList.replace('btn-danger', 'btn-ghost');
    }
  }

  // ─── Sim-toggle button label ─────────────────────────────────────────────────
  _updateSimToggleBtn() {
    const btn = document.getElementById('sim-toggle-btn');
    if (!btn) return;
    if (this.threatSim.isRunning) {
      btn.textContent = '⏸ Pause Threat Sim';
      btn.className   = 'btn btn-warn btn-full';
    } else {
      btn.textContent = '▶ Start Threat Sim';
      btn.className   = 'btn btn-success btn-full';
    }
  }

  // ─── Edge selector helpers ───────────────────────────────────────────────────
  _populateEdgeSelector(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const cur = select.value;
    select.innerHTML = '<option value="">— Select Road —</option>';
    Object.values(this.state.graph.edges).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      const fn  = this.state.graph.nodes[e.from];
      const tn  = this.state.graph.nodes[e.to];
      opt.textContent = `${e.id}: ${fn ? fn.label.split('\n')[0] : e.from} ↔ ${tn ? tn.label.split('\n')[0] : e.to}`;
      select.appendChild(opt);
    });
    if (cur) select.value = cur;
  }

  _updateSelectedEdgeInfo(edgeId) {
    const edge  = this.state.graph.edges[edgeId];
    const panel = document.getElementById('selected-edge-info');
    if (!edge) { panel.textContent = 'Click a road on the map to inspect it.'; return; }
    const fn = this.state.graph.nodes[edge.from];
    const tn = this.state.graph.nodes[edge.to];
    panel.innerHTML = `
      <strong>${edgeId}</strong>: ${fn ? fn.label.split('\n')[0] : edge.from} ↔ ${tn ? tn.label.split('\n')[0] : edge.to}<br>
      Distance: <strong>${edge.distance}</strong> |
      Threat: <strong class="${edge.threat >= 6 ? 'danger-text' : ''}">${edge.threat}/10</strong> |
      Resource Cost: <strong>${edge.resourceCost}</strong> |
      Status: <strong class="${edge.blocked ? 'danger-text' : 'success-text'}">${edge.blocked ? '🧟 BLOCKED' : '✅ OPEN'}</strong>
    `;
  }

  // ─── UI Updates ─────────────────────────────────────────────────────────────
  _updateUI() {
    this._updateInventory();
    this._updateHealth();
    this._updateRouteInfo();
    this._updateProgress();
    this._updateEdgeSelects();
  }

  _updateInventory() {
    const inv = this.state.inventory;
    const LOW = window.LastBeacon.LOW_THRESHOLD;
    ['food', 'water', 'medicine', 'batteries'].forEach(k => {
      const el  = document.getElementById(`inv-${k}`);
      const bar = document.getElementById(`bar-${k}`);
      if (!el) return;
      el.textContent = Math.round(inv[k]);
      el.className   = inv[k] <= LOW[k] ? 'inv-val danger-text' : 'inv-val';
      if (bar) {
        const max = { food: 30, water: 30, medicine: 15, batteries: 12 }[k];
        bar.style.width = `${Math.min(100, (inv[k] / max) * 100)}%`;
        bar.className   = `inv-bar ${inv[k] <= LOW[k] ? 'bar-danger' : 'bar-normal'}`;
      }
    });
  }

  _updateHealth() {
    ['aarav', 'mira'].forEach(name => {
      const el  = document.getElementById(`health-${name}`);
      const bar = document.getElementById(`health-bar-${name}`);
      const hp  = Math.round(this.state.health[name]);
      if (el)  el.textContent = `${hp}%`;
      if (bar) {
        bar.style.width = `${hp}%`;
        bar.className   = `health-bar ${hp < 40 ? 'bar-danger' : hp < 70 ? 'bar-warn' : 'bar-normal'}`;
      }
    });
  }

  _updateRouteInfo() {
    const { route, miraRoute, graph } = this.state;
    const panel = document.getElementById('route-panel');

    const formatRoute = (r, name, emoji, posId) => {
      if (!r || !r.path) {
        return `<div class="no-route" style="margin-bottom:8px;">
          <div class="no-route-icon">⚠</div>
          <div class="no-route-text">${emoji} ${name}: NO SAFE ROUTE</div>
        </div>`;
      }
      const nodeNames = r.path.map(id => {
        const n = graph.nodes[id];
        return n ? n.label.split('\n')[0] : id;
      });
      const curNode = graph.nodes[posId];
      return `
        <div style="margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:10px;">
          <div style="font-size:0.75rem;color:var(--text-sec);margin-bottom:4px;">${emoji} <strong style="color:#e0e0e0">${name}</strong> — 📍 ${curNode ? curNode.label.split('\n')[0] : posId}</div>
          <div class="route-path" style="font-size:0.7rem;">
            ${nodeNames.map((nm, i) => `
              <span class="route-node">${nm}</span>
              ${i < nodeNames.length - 1 ? '<span class="route-arrow">→</span>' : ''}
            `).join('')}
          </div>
          <div class="route-stats" style="margin-top:6px;">
            <div class="route-stat"><span class="stat-label">Dist</span><span class="stat-val">${r.totalDistance}</span></div>
            <div class="route-stat"><span class="stat-label">Threat</span><span class="stat-val ${r.totalThreat > 20 ? 'danger-text' : ''}">${r.totalThreat}</span></div>
            <div class="route-stat"><span class="stat-label">Cost</span><span class="stat-val">${Math.round(r.cost)}</span></div>
          </div>
          <div class="feasibility ${r.feasible ? 'feasible-yes' : 'feasible-no'}" style="font-size:0.7rem;margin-top:4px;">
            ${r.feasible ? '✅ Feasible' : '⚠ Low Resources!'}
          </div>
        </div>
      `;
    };

    panel.innerHTML =
      formatRoute(route,     'Aarav', '🧑', this.state.currentPos) +
      formatRoute(miraRoute, 'Mira',  '👩', this.state.miraPos);
  }

  _updateProgress() {
    const prog = this.state.missionProgress;
    const bar  = document.getElementById('progress-bar');
    const txt  = document.getElementById('progress-text');
    const time = document.getElementById('sim-time');
    if (bar) bar.style.width = `${prog}%`;
    if (txt) txt.textContent = `${prog}%`;
    if (time) time.textContent = this.state._formatTime(this.state.simTime);
  }

  _updateEdgeSelects() {
    ['block-road-select', 'unblock-road-select', 'threat-road-select'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const cur = sel.value;
      this._populateEdgeSelector(id);
      if (cur) sel.value = cur;
    });
  }

  // ─── Event Log ───────────────────────────────────────────────────────────────
  _renderLog() {
    const container = document.getElementById('event-log');
    if (!container) return;
    container.innerHTML = this.state.eventLog.map(entry => `
      <div class="log-entry log-${entry.type}">
        <span class="log-time">[${entry.time}]</span>
        <span class="log-msg">${entry.msg}</span>
      </div>
    `).join('');
  }

  // ─── Notification Toast ───────────────────────────────────────────────────────
  _flashNotification(msg, type = 'info') {
    const el = document.getElementById('notification');
    if (!el) return;
    el.textContent = msg;
    el.className   = `notification show notif-${type}`;
    clearTimeout(this._notifTimer);
    this._notifTimer = setTimeout(() => el.classList.remove('show'), 4000);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.lastBeaconApp = new App();
});
