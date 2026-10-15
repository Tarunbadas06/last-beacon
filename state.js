/**
 * LAST BEACON — Application State & Game Logic
 * v4 — Two survivors, two routes, two initial infection zones, auto-movement.
 */

'use strict';

const STORAGE_KEY = 'lastbeacon_state_v4';

const DEFAULT_INVENTORY = {
  food:      20,
  water:     20,
  medicine:  10,
  batteries: 8,
};

const LOW_THRESHOLD = { food: 5, water: 5, medicine: 3, batteries: 2 };

// Supply cache contents at cache nodes
const CACHE_SUPPLIES = {
  N3: { food: 6, water: 4, medicine: 3, batteries: 2 },
  S3: { food: 5, water: 6, medicine: 2, batteries: 3 },
};

// Resource consumption per resourceCost unit
const RESOURCE_SCALE = { food: 1.0, water: 1.2, medicine: 0, batteries: 0.3 };

// Node types that cannot become infection origins
const INFECTION_IMMUNE = new Set(['start', 'beacon', 'cache', 'cache_depleted']);

class AppState {
  constructor() {
    this.graph          = new window.LastBeacon.Graph(
      JSON.parse(JSON.stringify(window.LastBeacon.CITY_NODES)),
      JSON.parse(JSON.stringify(window.LastBeacon.CITY_EDGES))
    );
    this.currentPos     = 'S';   // Aarav
    this.miraPos        = 'S';   // Mira
    this.goalPos        = 'B';
    this.inventory      = { ...DEFAULT_INVENTORY };
    this.health         = { aarav: 100, mira: 100 };
    this.cachesDepleted = new Set();
    this.eventLog       = [];
    this.simTime        = 0;
    this.route          = null;
    this.miraRoute      = null;
    this.aaravDone      = false;
    this.miraDone       = false;
    this.listeners      = [];

    const hadSave = this._loadState();
    if (!hadSave) this._seedTwoPatientZeros();
    this.recalcRoute('Initial route calculated (Aarav).');
    this.recalcMiraRoute('Initial route calculated (Mira).');
  }

  // ─── Event System ──────────────────────────────────────────────────────────
  on(fn)      { this.listeners.push(fn); }
  emit(event) { this.listeners.forEach(fn => fn(event)); }

  // ─── Logging ───────────────────────────────────────────────────────────────
  log(msg, type = 'info') {
    const entry = {
      id:   Date.now() + Math.random(),
      time: this._formatTime(this.simTime),
      msg,
      type,
    };
    this.eventLog.unshift(entry);
    if (this.eventLog.length > 80) this.eventLog.pop();
    return entry;
  }

  _formatTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  }

  // ─── Route Calculation — Aarav ─────────────────────────────────────────────
  recalcRoute(reason) {
    if (this.aaravDone) return;
    const result      = this.graph.dijkstra(this.currentPos, this.goalPos);
    const oldRouteStr = this.route ? this.route.path.join('->') : '';

    if (!result.path) {
      this.route = null;
      const logEntry = this.log(`⚠ [Aarav] NO ROUTE from ${this.currentPos} to Beacon! ${reason}`, 'danger');
      this.emit({ type: 'NO_ROUTE', log: logEntry, reason });
      this._saveState();
      return;
    }

    this._attachFeasibility(result);
    const newRouteStr = result.path.join('->');
    const changed     = newRouteStr !== oldRouteStr;
    this.route = result;

    if (changed) {
      const logEntry = this.log(
        `🔄 REROUTE (Aarav): ${reason} New: ${result.path.map(id => this._nodeLabel(id)).join(' → ')}`,
        'reroute'
      );
      this.emit({ type: 'REROUTE', route: result, log: logEntry, reason });
    } else {
      this.log(reason, 'info');
      this.emit({ type: 'ROUTE_UNCHANGED', route: result, reason });
    }
    this._saveState();
  }

  // ─── Route Calculation — Mira ──────────────────────────────────────────────
  recalcMiraRoute(reason) {
    if (this.miraDone) return;
    const result      = this.graph.dijkstra(this.miraPos, this.goalPos);
    const oldRouteStr = this.miraRoute ? this.miraRoute.path.join('->') : '';

    if (!result.path) {
      this.miraRoute = null;
      this.log(`⚠ [Mira] NO ROUTE from ${this.miraPos} to Beacon! ${reason}`, 'danger');
      this.emit({ type: 'MIRA_NO_ROUTE', reason });
      this._saveState();
      return;
    }

    this._attachFeasibility(result);
    const newRouteStr = result.path.join('->');
    const changed     = newRouteStr !== oldRouteStr;
    this.miraRoute = result;

    if (changed) {
      this.log(
        `🔄 REROUTE (Mira): ${reason} New: ${result.path.map(id => this._nodeLabel(id)).join(' → ')}`,
        'reroute'
      );
      this.emit({ type: 'MIRA_REROUTE', route: result, reason });
    }
    this._saveState();
  }

  _attachFeasibility(result) {
    const { totalResourceCost } = result;
    result.requiredFood  = Math.ceil(totalResourceCost * RESOURCE_SCALE.food);
    result.requiredWater = Math.ceil(totalResourceCost * RESOURCE_SCALE.water);
    result.requiredBatt  = Math.ceil(totalResourceCost * RESOURCE_SCALE.batteries);
    result.feasible = (
      this.inventory.food      >= result.requiredFood  &&
      this.inventory.water     >= result.requiredWater &&
      this.inventory.batteries >= result.requiredBatt
    );
  }

  _nodeLabel(id) {
    const n = this.graph.nodes[id];
    return n ? n.label.replace('\n', ' ') : id;
  }

  // ─── Road Controls ─────────────────────────────────────────────────────────
  blockRoad(edgeId) {
    if (!this.graph.edges[edgeId]) return;
    const e = this.graph.edges[edgeId];
    if (e.blocked) {
      this.log(`Road ${edgeId} is already blocked.`, 'warn');
      this.emit({ type: 'ALREADY_BLOCKED' });
      return;
    }
    this.graph.blockEdge(edgeId);
    this.log(
      `🧟 Zombie horde! Road ${edgeId} (${this._nodeLabel(e.from)} ↔ ${this._nodeLabel(e.to)}) BLOCKED.`,
      'danger'
    );
    this.emit({ type: 'ROAD_BLOCKED', edgeId });

    const aaravAffected = this.route && this.route.edgePath && this.route.edgePath.includes(edgeId);
    const miraAffected  = this.miraRoute && this.miraRoute.edgePath && this.miraRoute.edgePath.includes(edgeId);

    if (aaravAffected) {
      this.recalcRoute(`Road ${edgeId} on Aarav's route blocked!`);
    } else {
      this.emit({ type: 'IRRELEVANT_BLOCK', edgeId });
      this._saveState();
    }
    if (miraAffected) {
      this.recalcMiraRoute(`Road ${edgeId} on Mira's route blocked!`);
    }
  }

  unblockRoad(edgeId) {
    if (!this.graph.edges[edgeId]) return;
    const e = this.graph.edges[edgeId];
    if (!e.blocked) {
      this.log(`Road ${edgeId} is not blocked.`, 'info');
      return;
    }
    this.graph.unblockEdge(edgeId);
    this.log(`✅ Road ${edgeId} (${this._nodeLabel(e.from)} ↔ ${this._nodeLabel(e.to)}) CLEAR.`, 'success');
    this.emit({ type: 'ROAD_UNBLOCKED', edgeId });
    this.recalcRoute(`Road ${edgeId} reopened.`);
    this.recalcMiraRoute(`Road ${edgeId} reopened.`);
  }

  setThreat(edgeId, level) {
    if (!this.graph.edges[edgeId]) return;
    const old = this.graph.edges[edgeId].threat;
    this.graph.setThreat(edgeId, level);
    this.log(`☢ Threat on ${edgeId}: ${old} → ${level}`, 'warn');
    this.emit({ type: 'THREAT_CHANGED', edgeId, level });
    this.recalcRoute(`Threat on ${edgeId} changed.`);
    this.recalcMiraRoute(`Threat on ${edgeId} changed.`);
  }

  // ─── Auto-advance both survivors (called by ThreatSimulator each tick) ─────
  advanceSimulation() {
    if (this.aaravDone && this.miraDone) {
      this.emit({ type: 'ALL_DONE' });
      return;
    }
    if (!this.aaravDone) this._advanceSurvivor('aarav');
    if (!this.miraDone)  this._advanceSurvivor('mira');
  }

  _advanceSurvivor(who) {
    const isAarav = who === 'aarav';
    const pos     = isAarav ? this.currentPos : this.miraPos;
    const route   = isAarav ? this.route      : this.miraRoute;
    const recalc  = isAarav
      ? (r) => this.recalcRoute(r)
      : (r) => this.recalcMiraRoute(r);
    const setPos  = (p) => { if (isAarav) this.currentPos = p; else this.miraPos = p; };
    const label   = isAarav ? 'Aarav' : 'Mira';
    const emoji   = isAarav ? '🧑' : '👩';

    if (pos === this.goalPos) {
      if (isAarav) this.aaravDone = true;
      else         this.miraDone  = true;
      this.emit({ type: 'MISSION_COMPLETE', who });
      return;
    }

    if (!route || !route.path) {
      this.log(`${emoji} ${label} has no valid route — staying put.`, 'warn');
      this.emit({ type: 'ADVANCE_FAIL', who });
      return;
    }

    const idx = route.path.indexOf(pos);
    if (idx < 0 || idx + 1 >= route.path.length) {
      recalc(`${label} position not found in route — recalculating.`);
      return;
    }

    const nextNode = route.path[idx + 1];
    const edgeId   = route.edgePath[idx];
    const edge     = this.graph.edges[edgeId];

    if (!edge || edge.blocked) {
      this.log(`${emoji} ${label}: road to ${this._nodeLabel(nextNode)} blocked! Recalculating…`, 'danger');
      recalc(`Road ahead blocked — recalculating ${label}'s route.`);
      return;
    }

    // Consume shared resources
    const consumed = {
      food:      Math.ceil(edge.resourceCost * RESOURCE_SCALE.food),
      water:     Math.ceil(edge.resourceCost * RESOURCE_SCALE.water),
      medicine:  0,
      batteries: Math.ceil(edge.resourceCost * RESOURCE_SCALE.batteries),
    };
    const threatDmg = edge.threat * 1.5;
    if (threatDmg > 0) {
      this.health[who] = Math.max(0, this.health[who] - threatDmg);
      if (edge.threat >= 5 && this.inventory.medicine > 0) consumed.medicine = 1;
    }
    Object.keys(consumed).forEach(k => {
      this.inventory[k] = Math.max(0, this.inventory[k] - consumed[k]);
    });

    this.simTime += Math.ceil(edge.distance / 5);
    setPos(nextNode);

    // Infected-zone damage on arrival
    const arrivedNode = this.graph.nodes[nextNode];
    if (arrivedNode && arrivedNode.type === 'danger') {
      const zoneDmg = 12;
      this.health[who] = Math.max(0, this.health[who] - zoneDmg);
      if (this.inventory.medicine > 0) {
        this.inventory.medicine = Math.max(0, this.inventory.medicine - 1);
      }
      this.log(`☣ ${emoji} ${label} entered INFECTED: ${this._nodeLabel(nextNode)}! -${zoneDmg}HP`, 'danger');
    }

    this.log(
      `${emoji} ${label} → ${this._nodeLabel(nextNode)}. ` +
      `Food:${this.inventory.food} Water:${this.inventory.water} Med:${this.inventory.medicine}`,
      edge.threat >= 6 ? 'danger' : 'info'
    );

    Object.entries(LOW_THRESHOLD).forEach(([k, threshold]) => {
      if (this.inventory[k] <= threshold) {
        this.log(`⚠ LOW ${k.toUpperCase()}: ${this.inventory[k]} remaining!`, 'warn');
      }
    });

    this.emit({ type: 'ADVANCED', who, node: nextNode });

    if (arrivedNode && arrivedNode.type === 'cache' && !this.cachesDepleted.has(nextNode)) {
      this._collectCache(nextNode);
    }

    if (nextNode === this.goalPos) {
      if (isAarav) this.aaravDone = true;
      else         this.miraDone  = true;
      this.log(`🏁 ${label} reached the BEACON! Survivor saved!`, 'success');
      this.emit({ type: 'MISSION_COMPLETE', who });
      if (this.aaravDone && this.miraDone) {
        this.log('🏆 BOTH survivors reached the Beacon! Mission COMPLETE!', 'success');
        this.emit({ type: 'ALL_DONE' });
      }
    } else {
      recalc(`${label} moved — recalculating.`);
    }
  }

  _collectCache(nodeId) {
    const supplies = CACHE_SUPPLIES[nodeId];
    if (!supplies) return;
    Object.entries(supplies).forEach(([k, v]) => {
      this.inventory[k] = (this.inventory[k] || 0) + v;
    });
    this.cachesDepleted.add(nodeId);
    this.graph.nodes[nodeId].type = 'cache_depleted';
    this.log(`📦 Cache at ${this._nodeLabel(nodeId)}! +Food:${supplies.food} +Water:${supplies.water}`, 'success');
    this.emit({ type: 'CACHE_COLLECTED', nodeId });
  }

  depleteCache(nodeId) {
    if (!CACHE_SUPPLIES[nodeId]) {
      this.log(`No cache at node ${nodeId}.`, 'warn');
      return;
    }
    this.cachesDepleted.add(nodeId);
    this.graph.nodes[nodeId].type = 'cache_depleted';
    this.log(`💀 Cache at ${this._nodeLabel(nodeId)} depleted.`, 'warn');
    this.emit({ type: 'CACHE_DEPLETED', nodeId });
    this._saveState();
  }

  // ─── Reset ─────────────────────────────────────────────────────────────────
  resetSimulation() {
    this.graph          = new window.LastBeacon.Graph(
      JSON.parse(JSON.stringify(window.LastBeacon.CITY_NODES)),
      JSON.parse(JSON.stringify(window.LastBeacon.CITY_EDGES))
    );
    this.currentPos     = 'S';
    this.miraPos        = 'S';
    this.goalPos        = 'B';
    this.inventory      = { ...DEFAULT_INVENTORY };
    this.health         = { aarav: 100, mira: 100 };
    this.cachesDepleted = new Set();
    this.eventLog       = [];
    this.simTime        = 0;
    this.route          = null;
    this.miraRoute      = null;
    this.aaravDone      = false;
    this.miraDone       = false;
    // NOTE: do NOT reset this.listeners

    localStorage.removeItem(STORAGE_KEY);

    this._seedTwoPatientZeros();

    this.log('🔄 Simulation reset — new zombie outbreak seeded.', 'info');
    this.recalcRoute('Simulation started fresh.');
    this.recalcMiraRoute('Simulation started fresh.');

    this.emit({ type: 'RESET' });
  }

  // ─── Seed exactly two random infection nodes ───────────────────────────────
  _seedTwoPatientZeros() {
    const eligible = Object.values(this.graph.nodes).filter(
      n => !INFECTION_IMMUNE.has(n.type) && n.id !== 'S' && n.id !== 'B'
    );
    if (eligible.length < 2) return;

    // Fisher-Yates shuffle, pick first 2
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    const z1 = eligible[0];
    const z2 = eligible[1];

    [z1, z2].forEach(node => {
      node.baseType = node.baseType || node.type;
      node.type     = 'danger';
    });

    this.log(
      `☣ OUTBREAK: Patient Zeros at ${this._nodeLabel(z1.id)} & ${this._nodeLabel(z2.id)}`,
      'danger'
    );
    this.emit({ type: 'PATIENT_ZEROS', nodes: [z1.id, z2.id] });
  }

  // ─── Persistence ───────────────────────────────────────────────────────────
  _saveState() {
    try {
      const data = {
        graphSnapshot:  this.graph.serialise(),
        currentPos:     this.currentPos,
        miraPos:        this.miraPos,
        inventory:      this.inventory,
        health:         this.health,
        cachesDepleted: [...this.cachesDepleted],
        eventLog:       this.eventLog.slice(0, 30),
        simTime:        this.simTime,
        aaravDone:      this.aaravDone,
        miraDone:       this.miraDone,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save state:', e);
    }
  }

  _loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data.graphSnapshot)  this.graph.restore(data.graphSnapshot);
      if (data.currentPos)     this.currentPos     = data.currentPos;
      if (data.miraPos)        this.miraPos        = data.miraPos;
      if (data.inventory)      this.inventory      = data.inventory;
      if (data.health)         this.health         = data.health;
      if (data.cachesDepleted) this.cachesDepleted = new Set(data.cachesDepleted);
      if (data.eventLog)       this.eventLog       = data.eventLog;
      if (data.simTime)        this.simTime        = data.simTime;
      if (data.aaravDone)      this.aaravDone      = data.aaravDone;
      if (data.miraDone)       this.miraDone       = data.miraDone;
      this.log('💾 State restored from storage.', 'info');
      return true;
    } catch (e) {
      console.warn('Failed to load state:', e);
      return false;
    }
  }

  // ─── Getters ───────────────────────────────────────────────────────────────
  get missionProgress() {
    const total        = window.LastBeacon.CITY_NODES.length;
    const aaravRemain  = this.route      ? this.route.path.length      : total;
    const miraRemain   = this.miraRoute  ? this.miraRoute.path.length  : total;
    const avgRemain    = (aaravRemain + miraRemain) / 2;
    return Math.min(100, Math.round(((total - avgRemain) / total) * 100));
  }

  get resourceStatus() {
    const hasRoute = this.route && this.route.path;
    if (!hasRoute) return { feasible: false, warnings: ['No valid route.'] };
    const warnings = [];
    Object.entries(LOW_THRESHOLD).forEach(([k, threshold]) => {
      if (this.inventory[k] <= threshold) warnings.push(`Low ${k}`);
    });
    return { feasible: this.route.feasible, warnings };
  }

  get bothDone() { return this.aaravDone && this.miraDone; }
}

window.LastBeacon.AppState       = AppState;
window.LastBeacon.LOW_THRESHOLD  = LOW_THRESHOLD;
window.LastBeacon.CACHE_SUPPLIES = CACHE_SUPPLIES;

