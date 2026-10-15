/**
 * LAST BEACON — Graph & Pathfinding Engine
 * Implements a weighted directed graph with Dijkstra's algorithm.
 * Cost formula: distance + (threat * THREAT_WEIGHT) + (resourceCost * RESOURCE_WEIGHT)
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────
const THREAT_WEIGHT    = 15;
const RESOURCE_WEIGHT  = 8;

// ─── City Map Definition ──────────────────────────────────────────────────────
const CITY_NODES = [
  { id: 'S',   label: 'Aarav & Mira\n(Start)',   x: 80,  y: 420, type: 'start'    },
  { id: 'N1',  label: 'North Gate',               x: 200, y: 300, type: 'junction' },
  { id: 'N2',  label: 'Radio Tower',              x: 340, y: 200, type: 'safe'     },
  { id: 'N3',  label: 'Hospital Ruins',           x: 490, y: 130, type: 'cache'    },
  { id: 'C1',  label: 'Old Market',               x: 230, y: 420, type: 'junction' },
  { id: 'C2',  label: 'Central Plaza',            x: 370, y: 380, type: 'junction' },
  { id: 'C3',  label: 'Power Station',            x: 510, y: 300, type: 'junction' },
  { id: 'C4',  label: 'Factory District',         x: 620, y: 390, type: 'junction' },
  { id: 'S1',  label: 'Riverside Park',           x: 190, y: 540, type: 'safe'     },
  { id: 'S2',  label: 'Flooded Tunnel',           x: 330, y: 590, type: 'junction' },
  { id: 'S3',  label: 'Warehouse Cache',          x: 470, y: 540, type: 'cache'    },
  { id: 'S4',  label: 'South Bridge',             x: 590, y: 480, type: 'junction' },
  { id: 'E1',  label: 'University Hill',          x: 650, y: 220, type: 'safe'     },
  { id: 'E2',  label: 'Last Shelter',             x: 720, y: 340, type: 'safe'     },
  { id: 'B',   label: 'BEACON\n(Survivor Camp)', x: 840, y: 290, type: 'beacon' },
];

const CITY_EDGES_DEF = [
  { id: 'e1',  from: 'S',  to: 'N1', distance: 140, threat: 2, resourceCost: 1, blocked: false },
  { id: 'e2',  from: 'S',  to: 'C1', distance: 155, threat: 1, resourceCost: 1, blocked: false },
  { id: 'e3',  from: 'S',  to: 'S1', distance: 130, threat: 3, resourceCost: 1, blocked: false },
  { id: 'e4',  from: 'N1', to: 'N2', distance: 155, threat: 2, resourceCost: 1, blocked: false },
  { id: 'e5',  from: 'N2', to: 'N3', distance: 160, threat: 4, resourceCost: 2, blocked: false },
  { id: 'e6',  from: 'N3', to: 'C3', distance: 180, threat: 5, resourceCost: 2, blocked: false },
  { id: 'e7',  from: 'N1', to: 'C1', distance: 130, threat: 2, resourceCost: 1, blocked: false },
  { id: 'e8',  from: 'N2', to: 'C2', distance: 190, threat: 3, resourceCost: 1, blocked: false },
  { id: 'e9',  from: 'N3', to: 'E1', distance: 165, threat: 2, resourceCost: 1, blocked: false },
  { id: 'e10', from: 'C1', to: 'C2', distance: 145, threat: 3, resourceCost: 1, blocked: false },
  { id: 'e11', from: 'C2', to: 'C3', distance: 150, threat: 6, resourceCost: 3, blocked: false },
  { id: 'e12', from: 'C3', to: 'C4', distance: 130, threat: 7, resourceCost: 3, blocked: false },
  { id: 'e13', from: 'C4', to: 'E2', distance: 120, threat: 5, resourceCost: 2, blocked: false },
  { id: 'e14', from: 'C4', to: 'S4', distance: 100, threat: 4, resourceCost: 2, blocked: false },
  { id: 'e15', from: 'S1', to: 'S2', distance: 150, threat: 2, resourceCost: 2, blocked: false },
  { id: 'e16', from: 'S2', to: 'S3', distance: 145, threat: 3, resourceCost: 2, blocked: false },
  { id: 'e17', from: 'S3', to: 'S4', distance: 135, threat: 3, resourceCost: 2, blocked: false },
  { id: 'e18', from: 'S4', to: 'E2', distance: 145, threat: 4, resourceCost: 2, blocked: false },
  { id: 'e19', from: 'S2', to: 'C2', distance: 200, threat: 3, resourceCost: 2, blocked: false },
  { id: 'e20', from: 'S1', to: 'C1', distance: 120, threat: 1, resourceCost: 1, blocked: false },
  { id: 'e21', from: 'S3', to: 'C3', distance: 180, threat: 5, resourceCost: 2, blocked: false },
  { id: 'e22', from: 'E1', to: 'E2', distance: 140, threat: 2, resourceCost: 1, blocked: false },
  { id: 'e23', from: 'E1', to: 'B',  distance: 210, threat: 3, resourceCost: 2, blocked: false },
  { id: 'e24', from: 'E2', to: 'B',  distance: 175, threat: 3, resourceCost: 2, blocked: false },
  { id: 'e25', from: 'C3', to: 'E1', distance: 185, threat: 4, resourceCost: 2, blocked: false },
];

// ─── Graph Class ──────────────────────────────────────────────────────────────
class Graph {
  constructor(nodes, edgeDefs) {
    this.nodes    = {};
    this.edges    = {};
    this.adjList  = {};

    nodes.forEach(n => {
      this.nodes[n.id] = {
        ...n,
        baseType: n.baseType || (n.type === 'danger' ? 'junction' : n.type)
      };
      this.adjList[n.id] = [];
    });

    edgeDefs.forEach(e => {
      this.edges[e.id] = { ...e };
      this._addAdj(e.from, e.to, e.id);
      this._addAdj(e.to, e.from, e.id);
    });
  }

  _addAdj(from, to, edgeId) {
    this.adjList[from].push({ neighbor: to, edgeId });
  }

  edgeCost(edgeId) {
    const e = this.edges[edgeId];
    if (!e || e.blocked) return Infinity;
    // Danger nodes are traversable — survivors take damage but can always pass through.
    // Do NOT add an infinite or very-high penalty here; health damage is handled in state.js.
    return e.distance + (e.threat * THREAT_WEIGHT) + (e.resourceCost * RESOURCE_WEIGHT);
  }

  dijkstra(startId, goalId) {
    const dist    = {};
    const prev    = {};
    const visited = new Set();

    Object.keys(this.nodes).forEach(id => { dist[id] = Infinity; });
    dist[startId] = 0;

    const pq = [{ id: startId, cost: 0 }];

    while (pq.length > 0) {
      pq.sort((a, b) => a.cost - b.cost);
      const { id: u, cost: uCost } = pq.shift();

      if (visited.has(u)) continue;
      visited.add(u);
      if (u === goalId) break;

      for (const { neighbor: v, edgeId } of this.adjList[u]) {
        const e = this.edges[edgeId];
        if (!e || e.blocked) continue;

        const newCost = uCost + this.edgeCost(edgeId);
        if (newCost < dist[v]) {
          dist[v] = newCost;
          prev[v] = { node: u, edgeId };
          pq.push({ id: v, cost: newCost });
        }
      }
    }

    if (dist[goalId] === Infinity) {
      return { path: null, edgePath: null, cost: Infinity, totalDistance: 0, totalThreat: 0, totalResourceCost: 0 };
    }

    const path     = [];
    const edgePath = [];
    let cur = goalId;
    while (cur !== startId) {
      path.unshift(cur);
      const p = prev[cur];
      edgePath.unshift(p.edgeId);
      cur = p.node;
    }
    path.unshift(startId);

    let totalDistance = 0, totalThreat = 0, totalResourceCost = 0;
    edgePath.forEach(eid => {
      const e = this.edges[eid];
      totalDistance     += e.distance;
      totalThreat       += e.threat;
      totalResourceCost += e.resourceCost;
    });

    return { path, edgePath, cost: dist[goalId], totalDistance, totalThreat, totalResourceCost };
  }

  blockEdge(edgeId) {
    if (this.edges[edgeId]) this.edges[edgeId].blocked = true;
  }

  unblockEdge(edgeId) {
    if (this.edges[edgeId]) this.edges[edgeId].blocked = false;
  }

  setThreat(edgeId, level) {
    if (this.edges[edgeId]) this.edges[edgeId].threat = Math.max(0, Math.min(10, level));
  }

  pathContainsBlocked(edgePath) {
    if (!edgePath) return false;
    return edgePath.some(eid => this.edges[eid] && this.edges[eid].blocked);
  }

  serialise() {
    return {
      edges: Object.fromEntries(
        Object.entries(this.edges).map(([id, e]) => [id, { blocked: e.blocked, threat: e.threat }])
      ),
      nodes: Object.fromEntries(
        Object.entries(this.nodes).map(([id, n]) => [id, { type: n.type, baseType: n.baseType }])
      )
    };
  }

  restore(snapshot) {
    if (!snapshot) return;
    Object.entries(snapshot.edges || {}).forEach(([id, data]) => {
      if (this.edges[id]) {
        this.edges[id].blocked = data.blocked;
        this.edges[id].threat  = data.threat;
      }
    });
    Object.entries(snapshot.nodes || {}).forEach(([id, data]) => {
      if (this.nodes[id]) {
        this.nodes[id].type = data.type;
        if (data.baseType) this.nodes[id].baseType = data.baseType;
      }
    });
  }
}

window.LastBeacon = window.LastBeacon || {};
window.LastBeacon.Graph       = Graph;
window.LastBeacon.CITY_NODES  = CITY_NODES;
window.LastBeacon.CITY_EDGES  = CITY_EDGES_DEF;
window.LastBeacon.THREAT_WEIGHT   = THREAT_WEIGHT;
window.LastBeacon.RESOURCE_WEIGHT = RESOURCE_WEIGHT;
