/**
 * LAST BEACON — Automatic Threat Simulator v4
 *
 * Each tick (every THREAT_TICK_MS ms):
 *   1. Raise threat on a random subset of roads.
 *   2. Auto-block roads that hit AUTO_BLOCK_THRESHOLD.
 *   3. BFS-spread zombie infection from infected nodes to one adjacent node
 *      (every ZONE_SPREAD_TICKS ticks).
 *   4. Auto-advance Aarav and Mira one step each along their routes.
 *
 * Exactly ONE interval ever runs. start/stop/reset are idempotent.
 */

'use strict';

const THREAT_TICK_MS          = 3000;   // tick interval (ms)
const AUTO_BLOCK_THRESHOLD    = 10;     // threat level that auto-blocks a road
const THREAT_INCREMENT_MIN    = 1;
const THREAT_INCREMENT_MAX    = 2;
const EDGES_PER_TICK_FRACTION = 0.25;
const ZONE_SPREAD_TICKS       = 5;     // ticks between BFS infection steps

// Edges that are never auto-escalated (keeps >= 1 path to beacon open)
const PROTECTED_EDGES = new Set(['e23', 'e24']);

// Node types the infection cannot spread into
const SPREAD_IMMUNE = new Set(['start', 'beacon', 'cache', 'cache_depleted']);

class ThreatSimulator {
  constructor(appState) {
    this._state     = appState;
    this._interval  = null;
    this._running   = false;
    this._tickCount = 0;
  }

  get isRunning() { return this._running; }

  // ── Start (idempotent) ──────────────────────────────────────────────────────
  start() {
    if (this._running) return;
    this._running  = true;
    this._interval = setInterval(() => this._tick(), THREAT_TICK_MS);
    this._state.log('🟢 Simulation ACTIVE — zombies are spreading.', 'warn');
    this._state.emit({ type: 'SIM_STARTED' });
  }

  // ── Stop (idempotent) ───────────────────────────────────────────────────────
  stop() {
    if (!this._running) return;
    clearInterval(this._interval);
    this._interval = null;
    this._running  = false;
    this._state.log('🔴 Simulation PAUSED.', 'info');
    this._state.emit({ type: 'SIM_STOPPED' });
  }

  // ── Reset (stop + clear tick counter; AppState restores map state) ─────────
  reset() {
    clearInterval(this._interval);
    this._interval  = null;
    this._running   = false;
    this._tickCount = 0;
  }

  // ── Main tick ───────────────────────────────────────────────────────────────
  _tick() {
    // Auto-halt when both survivors reach beacon
    if (this._state.bothDone) {
      this.stop();
      return;
    }

    // Step 1: block one random road this tick — forces an immediate reroute
    this._blockOneRoad();

    // Step 2: escalate threat colours on remaining open roads
    this._escalateThreats();

    // Step 3: spread infection every N ticks
    this._tickCount++;
    if (this._tickCount >= ZONE_SPREAD_TICKS) {
      this._tickCount = 0;
      this._spreadInfection();
    }

    // Step 4: auto-advance both survivors one road edge
    //         (routes were just recalculated above if a block or spread occurred)
    this._state.advanceSimulation();
  }

  // ── Block one road adjacent to an infected node per tick ─────────────────────
  _blockOneRoad() {
    const graph = this._state.graph;

    // Collect all currently infected node IDs
    const infectedIds = Object.values(graph.nodes)
      .filter(n => n.type === 'danger')
      .map(n => n.id);

    if (infectedIds.length === 0) return; // no infection yet

    // Gather candidate edges: open, not protected, AND touching an infected node
    const candidateSet = new Set();
    infectedIds.forEach(nodeId => {
      (graph.adjList[nodeId] || []).forEach(({ edgeId }) => {
        const e = graph.edges[edgeId];
        if (e && !e.blocked && !PROTECTED_EDGES.has(edgeId)) {
          candidateSet.add(edgeId);
        }
      });
    });

    const candidates = [...candidateSet];
    if (candidates.length === 0) return; // all adjacent roads already blocked

    // Pick one at random from the adjacent edges
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    const edge   = graph.edges[chosen];

    graph.blockEdge(chosen);
    graph.edges[chosen].threat = AUTO_BLOCK_THRESHOLD;

    this._state.log(
      `🧟 Zombie horde overruns ${chosen} ` +
      `(${this._state._nodeLabel(edge.from)} ↔ ${this._state._nodeLabel(edge.to)})!`,
      'danger'
    );
    this._state.emit({ type: 'ROAD_BLOCKED', edgeId: chosen, auto: true });

    // Recalculate both routes immediately so survivors pick optimal detour
    const onAarav = this._state.route     && this._state.route.edgePath     && this._state.route.edgePath.includes(chosen);
    const onMira  = this._state.miraRoute && this._state.miraRoute.edgePath && this._state.miraRoute.edgePath.includes(chosen);

    if (onAarav) {
      this._state.recalcRoute(`Road ${chosen} on Aarav's route was blocked — rerouting!`);
    }
    if (onMira) {
      this._state.recalcMiraRoute(`Road ${chosen} on Mira's route was blocked — rerouting!`);
    }
    this._state.emit({ type: 'THREAT_TICK' });
  }

  // ── Road threat escalation ──────────────────────────────────────────────────
  _escalateThreats() {
    const graph      = this._state.graph;
    const allEdgeIds = Object.keys(graph.edges).filter(id => !PROTECTED_EDGES.has(id));
    const count      = Math.max(1, Math.round(allEdgeIds.length * EDGES_PER_TICK_FRACTION));
    const targets    = this._sample(allEdgeIds, count);

    let anyChange = false;
    let rerouteAarav = false;
    let rerouteMira  = false;

    targets.forEach(edgeId => {
      const edge = graph.edges[edgeId];
      if (!edge || edge.blocked) return;

      const inc      = THREAT_INCREMENT_MIN +
        Math.floor(Math.random() * (THREAT_INCREMENT_MAX - THREAT_INCREMENT_MIN + 1));
      const newThreat = Math.min(10, edge.threat + inc);
      if (newThreat === edge.threat) return;

      graph.edges[edgeId].threat = newThreat;
      anyChange = true;

      if (newThreat >= AUTO_BLOCK_THRESHOLD) {
        graph.blockEdge(edgeId);
        this._state.log(
          `🧟 AUTO-BLOCK: Road ${edgeId} ` +
          `(${this._state._nodeLabel(edge.from)} ↔ ${this._state._nodeLabel(edge.to)}) ` +
          `overrun! Threat: ${newThreat}`,
          'danger'
        );
        this._state.emit({ type: 'ROAD_BLOCKED', edgeId, auto: true });

        const r  = this._state.route;
        const mr = this._state.miraRoute;
        if (r  && r.edgePath  && r.edgePath.includes(edgeId))  rerouteAarav = true;
        if (mr && mr.edgePath && mr.edgePath.includes(edgeId)) rerouteMira  = true;
      }
    });

    if (anyChange) this._state.emit({ type: 'THREAT_TICK' });
    if (rerouteAarav) this._state.recalcRoute('Zombie horde blocked a road on Aarav\'s route!');
    if (rerouteMira)  this._state.recalcMiraRoute('Zombie horde blocked a road on Mira\'s route!');
  }

  // ── BFS infection spread: one adjacent node per call ───────────────────────
  _spreadInfection() {
    const graph   = this._state.graph;
    const aaravAt = this._state.currentPos;
    const miraAt  = this._state.miraPos;

    // All currently infected node IDs
    const infected = new Set(
      Object.values(graph.nodes)
        .filter(n => n.type === 'danger')
        .map(n => n.id)
    );
    if (infected.size === 0) return;

    // Gather candidate neighbours from all infected nodes
    const candidates = new Set();
    infected.forEach(infId => {
      (graph.adjList[infId] || []).forEach(({ neighbor }) => {
        const nb = graph.nodes[neighbor];
        if (!nb)                            return;
        if (infected.has(neighbor))         return; // already infected
        if (SPREAD_IMMUNE.has(nb.type))  return; // immune type
        if (neighbor === aaravAt)           return; // don't infect Aarav's current position
        if (neighbor === miraAt)            return; // don't infect Mira's current position
        candidates.add(neighbor);
      });
    });

    if (candidates.size === 0) return;

    // Spread to 1 random neighbour
    const chosen = this._sample([...candidates], 1);
    chosen.forEach(id => {
      const node = graph.nodes[id];
      if (!node) return;
      node.baseType = node.baseType || node.type;
      node.type     = 'danger';
      this._state.log(`☣ Infection spreads to ${this._state._nodeLabel(id)}!`, 'warn');
    });

    this._state.emit({ type: 'ZONE_MOVED', newZones: chosen });

    // Recalc both routes — a newly infected node may now be on a planned path
    this._state.recalcRoute('Infection spread — rechecking Aarav\'s route.');
    this._state.recalcMiraRoute('Infection spread — rechecking Mira\'s route.');
  }

  // ── Utility: Fisher-Yates sample ────────────────────────────────────────────
  _sample(arr, n) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
  }
}

window.LastBeacon = window.LastBeacon || {};
window.LastBeacon.ThreatSimulator      = ThreatSimulator;
window.LastBeacon.THREAT_TICK_MS       = THREAT_TICK_MS;
window.LastBeacon.AUTO_BLOCK_THRESHOLD = AUTO_BLOCK_THRESHOLD;
window.LastBeacon.PROTECTED_EDGES      = PROTECTED_EDGES;
