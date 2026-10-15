/**
 * LAST BEACON — SVG City Map Renderer
 */

'use strict';

const NODE_RADIUS = 22;

const NODE_STYLE = {
  start:          { fill: '#00e5ff', stroke: '#00b8d4', emoji: '🏠', glow: '#00e5ff' },
  beacon:         { fill: '#ff6b35', stroke: '#ff3d00', emoji: '🚨', glow: '#ff6b35' },
  safe:           { fill: '#69f0ae', stroke: '#00c853', emoji: '🛡', glow: '#69f0ae' },
  cache:          { fill: '#ffd740', stroke: '#ff8f00', emoji: '📦', glow: '#ffd740' },
  cache_depleted: { fill: '#546e7a', stroke: '#455a64', emoji: '📭', glow: '#546e7a' },
  junction:       { fill: '#b0bec5', stroke: '#78909c', emoji: '🔘', glow: '#b0bec5' },
  danger:         { fill: '#ef5350', stroke: '#b71c1c', emoji: '☢', glow: '#ef5350'  },
  current:        { fill: '#e040fb', stroke: '#aa00ff', emoji: '📍', glow: '#e040fb' },
};

const EDGE_COLORS = {
  blocked:     '#ff1744',
  active:      '#00e5ff',   // Aarav's route
  miraActive:  '#ce93d8',   // Mira's route (soft purple)
  normal:      '#4fc3f7',
};

class MapRenderer {
  constructor(svgEl, state) {
    this.svg   = svgEl;
    this.state = state;
    this.W     = 960;
    this.H     = 680;
    this._hoveredEdge  = null;
    this._selectedEdge = null;
    this._onEdgeSelect = null;

    this.svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
    this.svg.setAttribute('width', '100%');
    this.svg.setAttribute('height', '100%');
    this._buildDefs();
    this._buildLayers();
  }

  _buildDefs() {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // Glow filters
    Object.entries(NODE_STYLE).forEach(([type, style]) => {
      const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
      filter.setAttribute('id', `glow-${type}`);
      filter.setAttribute('x', '-50%'); filter.setAttribute('y', '-50%');
      filter.setAttribute('width', '200%'); filter.setAttribute('height', '200%');
      const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
      feGaussianBlur.setAttribute('stdDeviation', '4');
      feGaussianBlur.setAttribute('result', 'blur');
      const feMerge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
      const node1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
      node1.setAttribute('in', 'blur');
      const node2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
      node2.setAttribute('in', 'SourceGraphic');
      feMerge.appendChild(node1); feMerge.appendChild(node2);
      filter.appendChild(feGaussianBlur); filter.appendChild(feMerge);
      defs.appendChild(filter);
    });

    // Active route glow
    const activeFilter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    activeFilter.setAttribute('id', 'glow-active');
    const blur2 = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    blur2.setAttribute('stdDeviation', '5'); blur2.setAttribute('result', 'blur');
    const merge2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
    const mn1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    mn1.setAttribute('in', 'blur');
    const mn2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
    mn2.setAttribute('in', 'SourceGraphic');
    merge2.appendChild(mn1); merge2.appendChild(mn2);
    activeFilter.appendChild(blur2); activeFilter.appendChild(merge2);
    defs.appendChild(activeFilter);

    // Marker for arrow
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', '0 0, 8 3, 0 6');
    poly.setAttribute('fill', EDGE_COLORS.active);
    marker.appendChild(poly);
    defs.appendChild(marker);

    this.svg.appendChild(defs);
  }

  _buildLayers() {
    this.layerEdges = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.layerEdges.setAttribute('id', 'layer-edges');
    // Nodes and labels must NOT intercept pointer events meant for road hit areas
    this.layerNodes = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.layerNodes.setAttribute('id', 'layer-nodes');
    this.layerNodes.setAttribute('pointer-events', 'none');
    this.layerLabels = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.layerLabels.setAttribute('id', 'layer-labels');
    this.layerLabels.setAttribute('pointer-events', 'none');
    this.svg.appendChild(this.layerEdges);
    this.svg.appendChild(this.layerNodes);
    this.svg.appendChild(this.layerLabels);
  }

  onEdgeSelect(fn) { this._onEdgeSelect = fn; }

  render() {
    this._clearLayer(this.layerEdges);
    this._clearLayer(this.layerNodes);
    this._clearLayer(this.layerLabels);
    this._drawBackground();
    this._drawEdges();
    this._drawNodes();
  }

  _clearLayer(layer) {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
  }

  _drawBackground() {
    // Grid
    const existing = this.svg.querySelector('#bg-grid');
    if (!existing) {
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('id', 'bg-grid');
      bg.setAttribute('width', this.W); bg.setAttribute('height', this.H);
      bg.setAttribute('fill', 'url(#grid-bg)');
      this.svg.insertBefore(bg, this.layerEdges);
    }
  }

  _drawEdges() {
    const { graph, route, miraRoute } = this.state;
    const activeEdges     = new Set(route     && route.edgePath     ? route.edgePath     : []);
    const miraActiveEdges = new Set(miraRoute  && miraRoute.edgePath ? miraRoute.edgePath : []);

    Object.values(graph.edges).forEach(edge => {
      const fromNode = graph.nodes[edge.from];
      const toNode   = graph.nodes[edge.to];
      if (!fromNode || !toNode) return;

      const isActive     = activeEdges.has(edge.id);
      const isMiraActive = miraActiveEdges.has(edge.id);
      const isBlocked    = edge.blocked;
      const isSelected   = edge.id === this._selectedEdge;

      // Shorten line to not overlap node circles
      const dx = toNode.x - fromNode.x;
      const dy = toNode.y - fromNode.y;
      const len = Math.sqrt(dx*dx + dy*dy);
      const ux = dx/len, uy = dy/len;
      const x1 = fromNode.x + ux * (NODE_RADIUS + 2);
      const y1 = fromNode.y + uy * (NODE_RADIUS + 2);
      const x2 = toNode.x   - ux * (NODE_RADIUS + 2);
      const y2 = toNode.y   - uy * (NODE_RADIUS + 2);

      // Hit area — must use stroke-opacity:0, NOT stroke:transparent.
      // SVG only fires pointer events on painted geometry; 'transparent' is
      // treated as no paint, so clicks pass straight through.
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hit.setAttribute('x1', x1); hit.setAttribute('y1', y1);
      hit.setAttribute('x2', x2); hit.setAttribute('y2', y2);
      hit.setAttribute('stroke', '#ffffff');       // any colour
      hit.setAttribute('stroke-opacity', '0');     // invisible but hittable
      hit.setAttribute('stroke-width', '24');      // fat target
      hit.setAttribute('stroke-linecap', 'round');
      hit.setAttribute('cursor', 'pointer');
      hit.setAttribute('pointer-events', 'stroke'); // only the stroke area triggers events
      hit.dataset.edgeId = edge.id;
      hit.addEventListener('click', (e) => {
        e.stopPropagation();
        this._selectedEdge = edge.id;
        if (this._onEdgeSelect) this._onEdgeSelect(edge.id);
        this.render();
      });
      hit.addEventListener('mouseenter', () => {
        this._hoveredEdge = edge.id;
        this.render();
      });
      hit.addEventListener('mouseleave', () => {
        this._hoveredEdge = null;
        this.render();
      });

      // Visual line
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x2); line.setAttribute('y2', y2);

      let stroke, sw;
      if (isBlocked) {
        stroke = EDGE_COLORS.blocked;
        sw = isSelected ? 7 : 5;
        line.setAttribute('stroke-dasharray', '10,6');
        line.setAttribute('filter', 'url(#glow-danger)');
      } else if (isActive && isMiraActive) {
        // Both routes share this road — draw as Aarav's colour but slightly wider
        stroke = EDGE_COLORS.active;
        sw = isSelected ? 9 : 7;
        line.setAttribute('filter', 'url(#glow-active)');
        line.setAttribute('marker-end', 'url(#arrowhead)');
      } else if (isActive) {
        stroke = EDGE_COLORS.active;
        sw = isSelected ? 8 : 6;
        line.setAttribute('filter', 'url(#glow-active)');
        line.setAttribute('marker-end', 'url(#arrowhead)');
      } else if (isMiraActive) {
        stroke = EDGE_COLORS.miraActive;
        sw = isSelected ? 7 : 5;
        line.setAttribute('stroke-dasharray', '8,4');
        line.setAttribute('filter', 'url(#glow-current)');
      } else if (isSelected || this._hoveredEdge === edge.id) {
        stroke = '#fff';
        sw = 4;
      } else {
        const threatColor = this._threatColor(edge.threat);
        stroke = threatColor;
        sw = 2.5;
      }

      line.setAttribute('stroke', stroke);
      line.setAttribute('stroke-width', sw);
      line.setAttribute('stroke-linecap', 'round');

      this.layerEdges.appendChild(line);
      this.layerEdges.appendChild(hit);

      // Edge label (threat + distance on hover/select)
      if (isSelected || this._hoveredEdge === edge.id || isBlocked || isActive) {
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const lbl = this._makeSvgText(
          mx, my - 8,
          isBlocked ? '🧟 BLOCKED' : `T:${edge.threat} D:${edge.distance}`,
          isBlocked ? '#ff1744' : (isActive ? '#00e5ff' : '#fff'),
          10
        );
        lbl.setAttribute('text-anchor', 'middle');
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const textWidth = isBlocked ? 70 : 60;
        bg.setAttribute('x', mx - textWidth/2); bg.setAttribute('y', my - 20);
        bg.setAttribute('width', textWidth); bg.setAttribute('height', 15);
        bg.setAttribute('rx', '4'); bg.setAttribute('fill', 'rgba(0,0,0,0.75)');
        this.layerLabels.appendChild(bg);
        this.layerLabels.appendChild(lbl);
      }
    });
  }

  _threatColor(threat) {
    // 0→green, 10→red gradient
    const r = Math.round(255 * (threat / 10));
    const g = Math.round(255 * (1 - threat / 10));
    return `rgb(${r},${g},60)`;
  }

  _drawNodes() {
    const { graph } = this.state;
    const aaravPos  = this.state.currentPos;
    const miraPos   = this.state.miraPos;

    Object.values(graph.nodes).forEach(node => {
      const isAarav   = node.id === aaravPos;
      const isMira    = node.id === miraPos && !isAarav; // if same node, treat as Aarav
      const isCurrent = isAarav;
      const type      = isCurrent ? 'current' : node.type;
      const style     = NODE_STYLE[type] || NODE_STYLE.junction;
      const r         = (isCurrent || isMira) ? NODE_RADIUS + 4 : NODE_RADIUS;

      // Outer glow ring
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('cx', node.x); ring.setAttribute('cy', node.y);
      ring.setAttribute('r', r + 5);
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', isMira ? '#ce93d8' : style.glow);
      ring.setAttribute('stroke-width', '2');
      ring.setAttribute('opacity', '0.4');
      this.layerNodes.appendChild(ring);

      // Main circle
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', node.x); circle.setAttribute('cy', node.y);
      circle.setAttribute('r', r);
      circle.setAttribute('fill', isMira ? '#ab47bc' : style.fill);
      circle.setAttribute('stroke', isMira ? '#7b1fa2' : style.stroke);
      circle.setAttribute('stroke-width', (isCurrent || isMira) ? '3' : '2');
      circle.setAttribute('filter', `url(#glow-${type.includes('cache') ? 'cache' : type})`);
      this.layerNodes.appendChild(circle);

      // Emoji — show both survivors if on same node
      if (isAarav && miraPos === aaravPos) {
        // Both on same node
        const e1 = this._makeSvgText(node.x - 6, node.y + 5, '🧑', '#000', 11);
        e1.setAttribute('text-anchor', 'middle');
        this.layerNodes.appendChild(e1);
        const e2 = this._makeSvgText(node.x + 6, node.y + 5, '👩', '#000', 11);
        e2.setAttribute('text-anchor', 'middle');
        this.layerNodes.appendChild(e2);
      } else {
        const emojiChar = isAarav ? '🧑' : isMira ? '👩' : style.emoji;
        const emoji = this._makeSvgText(node.x, node.y + 5, emojiChar, '#000', 14);
        emoji.setAttribute('text-anchor', 'middle');
        this.layerNodes.appendChild(emoji);
      }

      // Label
      const labelLines = node.label.split('\n');
      labelLines.forEach((line, i) => {
        const lbl = this._makeSvgText(
          node.x,
          node.y + r + 14 + i * 12,
          line,
          '#e0e0e0',
          9
        );
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('font-weight', (isCurrent || isMira) ? 'bold' : 'normal');
        this.layerLabels.appendChild(lbl);
      });

      // If Mira is at this node and not the same node as Aarav, add her position label
      if (isMira) {
        const miraLbl = this._makeSvgText(node.x, node.y - r - 6, '👩 Mira', '#ce93d8', 9);
        miraLbl.setAttribute('text-anchor', 'middle');
        this.layerLabels.appendChild(miraLbl);
      }
      if (isAarav) {
        const aaravLbl = this._makeSvgText(node.x, node.y - r - 6, '🧑 Aarav', '#00e5ff', 9);
        aaravLbl.setAttribute('text-anchor', 'middle');
        this.layerLabels.appendChild(aaravLbl);
      }
    });
  }

  _makeSvgText(x, y, text, fill, fontSize) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('fill', fill);
    t.setAttribute('font-size', fontSize);
    t.setAttribute('font-family', 'Inter, system-ui, sans-serif');
    t.textContent = text;
    return t;
  }

  get selectedEdge() { return this._selectedEdge; }
  clearSelectedEdge() { this._selectedEdge = null; }
}

window.LastBeacon.MapRenderer = MapRenderer;
window.LastBeacon.NODE_STYLE  = NODE_STYLE;
