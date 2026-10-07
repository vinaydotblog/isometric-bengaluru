// Layered isometric metro map, shared by the Namma Metro and Delhi Metro pages.
// A page passes its lines, timeline and notes to mountMetro(); everything else (scene, ledger,
// timeline rail, settings panel, tooltips, tables) is built here.
import * as THREE from 'three/webgpu';
import { color, float, uniform, attribute, uv, positionWorld, mix, step, smoothstep, fract, abs, max, length, pass, vec2 } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const THEMES = {
  night: { label: 'Night', scheme: 'dark', bg: '#0A0F24', ink: '#EEF0FF', muted: '#98A1C8', rule: '#273056', panel: '#111833',
    slabTop: '#0E1430', slabGlow: '#1B2350', grid: '#34407A', slabSide: '#161D40', water: '#1B3E8F', pillar: '#3A4478',
    sky: '#8FA0FF', ground: '#1A1030', open: '#F5F3FF', shut: '#353C66', glow: 0.75, emissive: 1 },
  dusk: { label: 'Dusk', scheme: 'dark', bg: '#1C0D22', ink: '#FCEFF5', muted: '#C69CB6', rule: '#45284C', panel: '#2A1531',
    slabTop: '#24112B', slabGlow: '#3D1E44', grid: '#6A3E70', slabSide: '#2A1431', water: '#2E3F8C', pillar: '#5E3A66',
    sky: '#FFB3C8', ground: '#2A0F20', open: '#FFF3F8', shut: '#5A3D62', glow: 0.7, emissive: 0.95 },
  paper: { label: 'Paper', scheme: 'light', bg: '#E2E5EC', ink: '#141826', muted: '#596178', rule: '#D2D7E2', panel: '#FFFFFF',
    slabTop: '#F7F8FB', slabGlow: '#FFFFFF', grid: '#D0D6E3', slabSide: '#BCC4D4', water: '#9EC0EA', pillar: '#9AA3B8',
    sky: '#FFFFFF', ground: '#B8BFD0', open: '#1A1F2E', shut: '#C3C8D4', glow: 0.15, emissive: 0.32 },
};
const DEFAULTS = { tooltips: true, labels: 'key', planned: true, trains: true, speed: 1, glow: 1, thickness: 1, height: 1, ground: 0.2, tilt: 54.7, autoRotate: false, theme: 'night', hidden: [] };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthYear = (y) => { const yr = Math.floor(y + 1e-6), m = Math.min(11, Math.floor((y - yr) * 12 + 1e-6)); return MON[m] + ' ' + yr; };
const shortDate = (s) => s ? s.replace(/(\d+) (\w{3})\w* (\d{4})/, '$1 $2 $3') : s;
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function mountMetro(cfg) {
  const $ = (s, r = document) => r.querySelector(s);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const KEY = 'layered-metro:' + cfg.key;
  const defaults = { ...DEFAULTS, ...(cfg.defaults || {}) };
  const state = { ...defaults, hidden: [] };
  // film mode: a page drives every frame itself (camera, year, focus), so saved settings are ignored
  const FILM = cfg.film || null;
  if (FILM) Object.assign(state, { labels: 'off', tooltips: false, planned: true, trains: true, autoRotate: false }, FILM.state || {});
  else try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* storage unavailable */ }
  if (!THEMES[state.theme]) state.theme = 'night';
  const save = () => { if (FILM) return; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } };

  /* ---------------- data ---------------- */
  const LINES = cfg.lines.map((L, li) => ({ ...L, li, group: L.group || L.id, status: L.status || 'open', expectYear: L.expectYear || ((L.expect || '').match(/\d{4}/) || [])[0],
    st: L.st.map(a => ({ name: a[0], lat: a[1], lon: a[2], year: a[3], depth: a[4] || 'e', date: a[5] || null, note: a[6] || null })) }));
  for (const L of LINES) L.st.forEach((s, i) => { // fill missing coordinates by index between known neighbours
    if (s.lat != null) return;
    let a = i - 1; while (L.st[a].lat == null) a--;
    let b = i + 1; while (L.st[b].lat == null) b++;
    const t = (i - a) / (b - a);
    s.lat = L.st[a].lat + (L.st[b].lat - L.st[a].lat) * t; s.lon = L.st[a].lon + (L.st[b].lon - L.st[a].lon) * t; s.interp = true;
  });
  const GROUPS = [];
  for (const L of LINES) {
    let g = GROUPS.find(q => q.id === L.group);
    if (!g) { g = { id: L.group, name: (cfg.groupNames || {})[L.group] || L.name, hex: L.hex, lines: [] }; GROUPS.push(g); }
    g.lines.push(L);
  }
  const lat0 = cfg.origin.lat, lon0 = cfg.origin.lon, KX = 111.32 * Math.cos(lat0 * Math.PI / 180), KY = 110.57, S2 = Math.SQRT1_2;
  const toEN = (lat, lon) => [(lon - lon0) * KX, (lat - lat0) * KY];
  const toWorld = (lat, lon) => { const [e, n] = toEN(lat, lon); return { x: (e - n) * S2, z: (-e - n) * S2 }; };
  for (const L of LINES) {
    let d = 0; L.cum = [0];
    for (let i = 1; i < L.st.length; i++) { const [e1, n1] = toEN(L.st[i - 1].lat, L.st[i - 1].lon), [e2, n2] = toEN(L.st[i].lat, L.st[i].lon); d += Math.hypot(e2 - e1, n2 - n1); L.cum.push(d); }
    L.mapKm = d;
    L.segYear = L.st.slice(1).map((s, i) => L.status === 'open' ? Math.max(s.year ?? 9999, L.st[i].year ?? 9999) : 9999);
    // runs of neighbouring segments that open on the same day, so each run can draw itself in from its already-open end
    L.runOf = []; const sy = L.segYear;
    for (let a = 0; a < sy.length;) { let b = a; while (b + 1 < sy.length && sy[b + 1] === sy[a]) b++; for (let k = a; k <= b; k++) L.runOf[k] = [a, b]; a = b + 1; }
  }
  const GROW = 0.3; // years a newly opened stretch takes to draw in while the timeline plays
  // opening year and draw-in position (0 = drawn first, 1 = drawn last) at arc position u along a line
  function runAt(L, u, seg) {
    let k = seg ?? 0; if (seg == null) while (k < L.u.length - 2 && u > L.u[k + 1]) k++;
    const sy = L.segYear, [a, b] = L.runOf[k], u0 = L.u[a], u1 = L.u[b + 1];
    const f = Math.min(1, Math.max(0, (u - u0) / ((u1 - u0) || 1)));
    const left = a > 0 && sy[a - 1] < sy[a], right = b < sy.length - 1 && sy[b + 1] < sy[a];
    return { k, oy: sy[k], runT: left && right ? 2 * Math.min(f, 1 - f) : right ? 1 - f : f };
  }
  let minE = 1e9, maxE = -1e9, minN = 1e9, maxN = -1e9;
  LINES.forEach(L => L.st.forEach(s => { const [e, n] = toEN(s.lat, s.lon); minE = Math.min(minE, e); maxE = Math.max(maxE, e); minN = Math.min(minN, n); maxN = Math.max(maxN, n); }));
  const S = Math.max(maxE - minE, maxN - minN) / 43; // scene scale relative to the Bengaluru map
  const T0 = cfg.timeline.start, TNOW = cfg.timeline.now;

  const kmOpen = (y) => LINES.reduce((sum, L) => {
    if (L.status !== 'open') return sum;
    let open = 0; L.segYear.forEach((sy, i) => { if (sy <= y + 1e-6) open += L.cum[i + 1] - L.cum[i]; });
    return sum + (L.km ? L.km * open / L.mapKm : open);
  }, 0);
  const openNames = (y) => { const set = new Set(); LINES.forEach(L => { if (L.status === 'open') L.st.forEach(s => { if (s.year != null && s.year <= y + 1e-6) set.add(s.name); }); }); return set; };
  const groupsOpen = (y) => GROUPS.filter(g => g.lines.some(L => L.status === 'open' && L.st.some(s => s.year != null && s.year <= y + 1e-6))).length;

  /* ---------------- DOM ---------------- */
  const app = $('#app');
  app.innerHTML = `
    <div class="stage" id="stage"></div>
    <header class="intro">
      <p class="eyebrow"><span class="kn${cfg.nativeClass ? ' ' + cfg.nativeClass : ''}" lang="${cfg.nativeLang || ''}">${cfg.native}</span>${cfg.eyebrow}</p>
      <h1 class="title">${cfg.title}</h1>
      <p class="dek">${cfg.dek}</p>
    </header>
    <div class="note" aria-hidden="true">
      <div class="row"><b></b>Elevated viaduct</div>
      <div class="row"><b class="u"></b>Underground, seen through the city</div>
      <div class="row"><b class="p"></b>Under construction or approved</div>
    </div>
    <aside class="ledger" aria-live="polite">
      <div class="when" id="when"></div>
      <div class="what" id="what"></div>
      <div class="kpis">
        <div class="kpi"><b id="kKm"></b><span>${cfg.kmLabel || 'km open'}</span></div>
        <div class="kpi"><b id="kSt"></b><span>stations</span></div>
        <div class="kpi"><b id="kLn"></b><span>lines</span></div>
      </div>
      <div class="lines-head"><span>Click a line to hide it</span><button type="button" id="showAll">Show all</button></div>
      <div class="lines" id="lines"></div>
    </aside>
    <section class="rail">
      <div class="side">
        <button class="btn" id="play" aria-pressed="false">▶ Replay</button>
        <button class="btn" id="tipBtn" aria-pressed="true" title="Toggle tooltips (T)"><span class="dot"></span>Tooltips</button>
        <button class="btn" id="custBtn" aria-expanded="false" aria-controls="panel">⚙ Customise</button>
        <button class="btn" id="dataBtn">Data table</button>
      </div>
      <div class="tl"><div class="tl-inner">
        <div class="marks" id="marks"></div>
        <input class="range" id="year" type="range" min="${T0}" max="${TNOW}" step="0.01" value="${TNOW}" aria-label="Year">
        <div class="range-scale"><span>${monthYear(T0)}</span><span>${cfg.timeline.nowLabel}</span></div>
      </div></div>
      <div class="inset"><h2>${cfg.inset.title}</h2><svg id="insetSvg" viewBox="0 0 280 124" role="img" aria-label="${esc(cfg.inset.title)}"></svg></div>
    </section>
    <div class="sheet" id="sheet" hidden>
      <button class="btn close" id="closeSheet">Close</button>
      ${cfg.tables.map(t => `<h2 style="margin-top:12px">${t.title}</h2><div class="table-wrap"><table><thead><tr>${t.head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('')}
      <p class="source" style="margin-top:12px">${cfg.source}</p>
    </div>
    <div class="panel" id="panel" hidden role="dialog" aria-label="Customise the map">
      <header><h2>Customise</h2><button class="btn" id="closePanel">Close</button></header>
      <div class="grp"><h3>Information</h3>
        <div class="ctl"><label for="c-tooltips">Tooltips on hover <span class="kbd">T</span></label><button class="switch" role="switch" id="c-tooltips"></button></div>
        <div class="ctl wide"><span>Station labels <span class="kbd">L</span></span><div class="seg" id="c-labels"><button data-v="off">Off</button><button data-v="key">Key</button><button data-v="all">Interchanges</button></div></div>
        <div class="ctl"><label for="c-planned">Lines under construction</label><button class="switch" role="switch" id="c-planned"></button></div>
        <p class="hint" style="margin:0;font-size:0.72rem;color:var(--muted)">Press <span class="kbd">/</span> to hide every menu and keep only the map. Press it again or Esc to bring them back.</p>
      </div>
      <div class="grp"><h3>Motion</h3>
        <div class="ctl"><label for="c-trains">Trains</label><button class="switch" role="switch" id="c-trains"></button></div>
        <div class="ctl"><label for="c-speed">Train speed</label><output id="o-speed"></output><input type="range" id="c-speed" min="0.25" max="3" step="0.05"></div>
        <div class="ctl"><label for="c-rotate">Slow turntable</label><button class="switch" role="switch" id="c-rotate"></button></div>
      </div>
      <div class="grp"><h3>Look</h3>
        <div class="ctl wide"><span>Scene</span><div class="seg" id="c-theme">${Object.entries(THEMES).map(([k, t]) => `<button data-v="${k}">${t.label}</button>`).join('')}</div></div>
        <div class="ctl"><label for="c-glow">Glow</label><output id="o-glow"></output><input type="range" id="c-glow" min="0" max="2.5" step="0.05"></div>
        <div class="ctl"><label for="c-thick">Line thickness</label><output id="o-thick"></output><input type="range" id="c-thick" min="0.4" max="2.5" step="0.05"></div>
        <div class="ctl"><label for="c-height">Viaduct and tunnel depth</label><output id="o-height"></output><input type="range" id="c-height" min="0.2" max="3" step="0.05"></div>
        <div class="ctl"><label for="c-ground">Ground see-through</label><output id="o-ground"></output><input type="range" id="c-ground" min="0" max="1" step="0.01"><span class="hint">Higher shows more of the tunnels.</span></div>
      </div>
      <div class="grp"><h3>Camera</h3>
        <div class="ctl"><label for="c-tilt">Tilt</label><output id="o-tilt"></output><input type="range" id="c-tilt" min="2" max="78" step="0.5"><span class="hint">2° is a plan view, 54.7° is true isometric. Drag to turn, right-drag to pan, scroll to zoom.</span></div>
        <div class="ctl wide"><div class="seg" id="c-view"><button data-v="2">Plan</button><button data-v="54.7">Isometric</button><button data-v="72">Low</button></div></div>
      </div>
      <div class="foot"><button class="btn" id="resetView">Reset camera</button><button class="btn" id="resetAll">Reset all</button></div>
    </div>`;
  const stage = $('#stage');

  /* ---------------- renderer ---------------- */
  let renderer;
  try { renderer = new THREE.WebGPURenderer({ antialias: true }); await renderer.init(); }
  catch (err) { stage.innerHTML = '<p class="fallback">This browser could not start WebGPU or WebGL 2, so the 3D view is off. The data table still has every figure.</p>'; throw err; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(THEMES[state.theme].bg);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
  const CENTER = new THREE.Vector3(); { const w = toWorld(cfg.center?.lat ?? lat0, cfg.center?.lon ?? lon0); CENTER.set(w.x, 0, w.z); }
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, enablePan: true, screenSpacePanning: true, minZoom: 0.6, maxZoom: 8, rotateSpeed: 0.55, autoRotateSpeed: 0.5 });
  function resetCamera() {
    controls.target.copy(CENTER);
    camera.position.copy(CENTER).add(new THREE.Vector3(60, 60, 60).multiplyScalar(S));
    camera.zoom = 1; camera.updateProjectionMatrix();
    setTilt(state.tilt, true);
  }
  function setTilt(deg, force) {
    const r = deg * Math.PI / 180;
    controls.minPolarAngle = controls.maxPolarAngle = r;
    if (force) { const off = camera.position.clone().sub(controls.target), sph = new THREE.Spherical().setFromVector3(off); sph.phi = r; camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph)); }
    controls.update();
  }
  const hemi = new THREE.HemisphereLight('#8FA0FF', '#1A1030', 1.1); scene.add(hemi);
  const moon = new THREE.DirectionalLight('#CFD6FF', 1.4); moon.position.set(-30, 50, 10); scene.add(moon);

  /* ---------------- uniforms + materials ---------------- */
  const uTime = uniform(0), uYear = uniform(TNOW), uTrains = uniform(state.trains ? 1 : 0), uEmis = uniform(1), uGround = uniform(state.ground);
  const uFutureDash = uniform(1), uPlannedDash = uniform(1), uFreshWin = uniform(0.2); // dashes for not-yet-open stretches of open lines, and for lines still being built
  const U = { slabTop: uniform(new THREE.Color()), slabGlow: uniform(new THREE.Color()), grid: uniform(new THREE.Color()), slabSide: uniform(new THREE.Color()), water: uniform(new THREE.Color()), pillar: uniform(new THREE.Color()) };
  const lineMats = new Map();
  function lineMaterial(L) {
    if (lineMats.has(L.id)) return lineMats.get(L.id);
    const uLen = uniform(1), uDim = uniform(0);
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.15 });
    const oy = attribute('openYear', 'float'), runT = attribute('runT', 'float');
    const front = oy.sub(GROW).add(runT.mul(GROW));                       // the stretch draws in during the GROW years before it opens
    const opened = smoothstep(front.sub(0.02), front, uYear);
    const fresh = opened.mul(float(1).sub(smoothstep(0, 1, uYear.sub(front).add(0.002).div(max(uFreshWin, 1e-4))))); // newly drawn track glows white, then cools
    const along = uv().x.mul(uLen);
    const phase = fract(along.mul(0.16).sub(uTime.mul(0.32)));           // a train every ~6 km, moving outbound
    const train = smoothstep(0.86, 0.995, phase).mul(step(phase, 0.995)).mul(opened).mul(uTrains);
    const dashOn = L.status === 'open' ? uFutureDash : uPlannedDash;
    const dash = step(float(1).sub(dashOn.mul(0.55)), fract(along.mul(1.6)));
    const c = color(L.hex), dim = float(1).sub(uDim.mul(0.82));
    m.colorNode = mix(c.mul(0.5), c, opened).mul(dim);
    m.emissiveNode = c.mul(opened.mul(0.42).add(0.26)).mul(uEmis).add(color('#FFFFFF').mul(train.mul(1.6).add(fresh.mul(1.3)))).mul(dim);
    m.opacityNode = max(opened, dash.mul(0.9));
    m.alphaTest = 0.5;
    const rec = { m, uLen, uDim }; lineMats.set(L.id, rec); return rec;
  }
  const slabMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  {
    const gx = abs(fract(positionWorld.x.div(S)).sub(0.5)), gz = abs(fract(positionWorld.z.div(S)).sub(0.5));
    const grid = smoothstep(0.46, 0.5, max(gx, gz));
    const d = length(positionWorld.xz.sub(vec2(CENTER.x, CENTER.z)));
    const glow = smoothstep(26 * S, 0, d);
    const top = step(0.15 * S, positionWorld.y);
    slabMat.colorNode = mix(U.slabSide, mix(mix(U.slabTop, U.slabGlow, glow), U.grid, grid.mul(0.55)), top);
    slabMat.opacityNode = mix(float(0.97).sub(uGround.mul(0.6)), float(0.95).sub(uGround.mul(0.75)), top);
  }
  const waterMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  waterMat.colorNode = U.water; waterMat.opacityNode = float(0.85);
  const pillarMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 }); pillarMat.colorNode = U.pillar;
  const stMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.4 });

  /* ---------------- static ground features ---------------- */
  const SURF = 0.2 * S;
  (cfg.lakes || []).forEach(([, la, lo, r]) => {
    const w = toWorld(la, lo), m = new THREE.Mesh(new THREE.CircleGeometry(r, 28), waterMat);
    m.rotation.x = -Math.PI / 2; m.position.set(w.x, SURF + 0.015, w.z); m.renderOrder = 11; scene.add(m);
  });
  (cfg.rivers || []).forEach(rv => {
    const pad = 2.6, P = rv.pts.filter(([la, lo]) => { const [e, n] = toEN(la, lo); return e > minE - pad && e < maxE + pad && n > minN - pad && n < maxN + pad; }).map(([la, lo]) => toWorld(la, lo)), pos = [], idx = [];
    P.forEach((p, i) => {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const w = rv.width / 2; pos.push(p.x - dz * w, SURF + 0.012, p.z + dx * w, p.x + dz * w, SURF + 0.012, p.z - dx * w);
      if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, waterMat); m.renderOrder = 11; m.material.side = THREE.DoubleSide; scene.add(m);
  });

  /* ---------------- the network (rebuilt when shape settings change) ---------------- */
  const net = new THREE.Group(); scene.add(net);
  let STN = [], stations = null, byName = new Map(), pillars = null, PIL = [];
  const lineVisible = (L) => !state.hidden.includes(L.group) && (L.status === 'open' || state.planned);
  const depthOf = (L, s) => {
    const [up, down] = (cfg.depth && cfg.depth[L.id]) || [1.05 + (L.li % 6) * 0.13, -(1.05 + (L.li % 6) * 0.15)];
    const h = s.depth === 'u' ? down : s.depth === 'g' ? 0.32 : up;
    return (s.depth === 'g' ? h : h * state.height) * S;
  };
  function shapeLine(L) {
    L.pts = L.st.map(s => { const w = toWorld(s.lat, s.lon); return new THREE.Vector3(w.x, depthOf(L, s), w.z); });
    L.curve = new THREE.CatmullRomCurve3(L.pts, false, 'centripetal');
    L.len = L.curve.getLength();
    const samples = 1400, sp = L.curve.getSpacedPoints(samples);
    L.u = L.pts.map(p => { let best = 0, bd = 1e18; for (let k = 0; k < sp.length; k++) { const d = sp[k].distanceToSquared(p); if (d < bd) { bd = d; best = k; } } return best / samples; });
  }
  let slab = null;
  function rebuild() {
    net.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    net.clear();
    LINES.forEach(shapeLine);
    const vis = LINES.filter(lineVisible);
    const R = 0.17 * S * state.thickness;
    for (const L of vis) {
      const geo = new THREE.TubeGeometry(L.curve, Math.max(40, L.st.length * 18), R, 10, false);
      const n = geo.attributes.position.count, oy = new Float32Array(n), rt = new Float32Array(n), uvs = geo.attributes.uv;
      for (let v = 0; v < n; v++) { const r = runAt(L, uvs.getX(v)); oy[v] = r.oy; rt[v] = r.runT; }
      geo.setAttribute('openYear', new THREE.BufferAttribute(oy, 1));
      geo.setAttribute('runT', new THREE.BufferAttribute(rt, 1));
      const rec = lineMaterial(L); rec.uLen.value = L.len;
      net.add(new THREE.Mesh(geo, rec.m));
    }
    // pillars (each remembers when its stretch draws in, for film mode)
    const spots = [];
    for (const L of vis) for (let s = 0; s < L.len; s += 0.9 * S) { const p = L.curve.getPointAt(s / L.len); if (p.y > 0.6 * S) { const r = runAt(L, s / L.len); spots.push({ p, L, at: r.oy - GROW + r.runT * GROW }); } }
    pillars = null; PIL = spots;
    if (spots.length) {
      const geo = new THREE.CylinderGeometry(0.06 * S, 0.08 * S, 1, 6); geo.translate(0, 0.5, 0);
      const pil = new THREE.InstancedMesh(geo, pillarMat, spots.length), d = new THREE.Object3D();
      spots.forEach((o, i) => { const p = o.p; o.h = Math.max(0.01, p.y - SURF - R * 0.8); o.w = Math.min(1.6, state.thickness); d.position.set(p.x, SURF, p.z); d.scale.set(o.w, o.h, o.w); d.updateMatrix(); pil.setMatrixAt(i, d.matrix); });
      net.add(pil); pillars = pil;
    }
    // stations
    STN = []; vis.forEach(L => L.st.forEach((s, i) => {
      // film mode: a station appears when the drawing front reaches it
      let at = s.year ?? 9999;
      for (const k of [i - 1, i]) if (k >= 0 && k < L.segYear.length && L.segYear[k] === s.year) { const r = runAt(L, L.u[i], k); at = Math.min(at, s.year - GROW + r.runT * GROW); }
      STN.push({ L, s, p: L.pts[i], at });
    }));
    byName = new Map(); LINES.forEach(L => L.st.forEach((s, i) => { if (!byName.has(s.name)) byName.set(s.name, []); byName.get(s.name).push({ L, s, i }); }));
    const sr = 0.34 * S * (0.65 + 0.35 * state.thickness);
    const geo = new THREE.CylinderGeometry(sr, sr, 0.2 * S, 18);
    stations = new THREE.InstancedMesh(geo, stMat, Math.max(1, STN.length));
    const d = new THREE.Object3D();
    STN.forEach((o, i) => { const big = new Set(byName.get(o.s.name).map(q => q.L.group)).size > 1; d.position.copy(o.p); d.scale.setScalar(big ? 1.45 : 1); d.updateMatrix(); stations.setMatrixAt(i, d.matrix); stations.setColorAt(i, new THREE.Color('#FFFFFF')); });
    stations.count = STN.length;
    net.add(stations); lastColored = -1;
    // slab sized to the whole network, deep enough for the tunnels
    const box = new THREE.Box3(); LINES.forEach(L => L.pts.forEach(p => box.expandByPoint(p)));
    const deep = Math.min(-0.6 * S, box.min.y) - 0.7 * S, pad = 3 * S, h = SURF - deep;
    const slabGeo = new THREE.BoxGeometry(box.max.x - box.min.x + pad * 2, h, box.max.z - box.min.z + pad * 2);
    if (!slab) { slab = new THREE.Mesh(slabGeo, slabMat); slab.renderOrder = 10; scene.add(slab); } else { slab.geometry.dispose(); slab.geometry = slabGeo; }
    slab.position.set((box.min.x + box.max.x) / 2, SURF - h / 2, (box.min.z + box.max.z) / 2);
    placeTagAnchors(); updateTagVisibility();
  }
  let lastColored = -1;
  const cOpen = new THREE.Color(), cShut = new THREE.Color();
  function colorStations(year, force) {
    if (!stations || (!force && Math.abs(year - lastColored) < 0.01)) return; lastColored = year;
    STN.forEach((o, i) => stations.setColorAt(i, o.L.status === 'open' && o.s.year != null && o.s.year <= year + 1e-6 ? cOpen : cShut));
    if (stations.instanceColor) stations.instanceColor.needsUpdate = true;
  }

  /* ---------------- bloom ---------------- */
  let pipeline = null, bloomNode = null;
  try {
    const PP = THREE.RenderPipeline || THREE.PostProcessing;
    pipeline = new PP(renderer);
    const col = pass(scene, camera).getTextureNode('output');
    bloomNode = bloom(col, 0.75, 0.45, 0.22);
    pipeline.outputNode = col.add(bloomNode);
  } catch (e) { console.warn('bloom off', e); pipeline = null; }

  /* ---------------- labels ---------------- */
  const TAGS = [];
  function addTag(text, kind, groups, hex, anchor) {
    const el = document.createElement('div'); el.className = 'tag' + (kind === 'key' ? ' big' : '');
    el.innerHTML = (hex ? `<i style="background:${hex}"></i>` : '') + esc(text); stage.appendChild(el);
    TAGS.push({ el, kind, groups, anchor, v: new THREE.Vector3() });
  }
  {
    const seen = new Set();
    LINES.forEach(L => [L.st[0], L.st[L.st.length - 1]].forEach(s => {
      if (seen.has(s.name)) return; seen.add(s.name);
      const nm = (cfg.shortNames || {})[s.name] || s.name, c = toWorld(cfg.center?.lat ?? lat0, cfg.center?.lon ?? lon0), w = toWorld(s.lat, s.lon);
      const inner = Math.hypot(w.x - c.x, w.z - c.z) < (cfg.endMinKm || 0);
      addTag(nm, inner ? 'x' : 'end', [L.group], L.hex, { lat: s.lat, lon: s.lon, name: s.name, line: L });
    }));
    (cfg.labels || []).forEach(l => { seen.add(l.name || l.text); addTag(l.text, 'key', null, null, { lat: l.lat, lon: l.lon, name: l.name || l.text }); });
    const inter = new Map(); LINES.forEach(L => L.st.forEach(s => { if (!inter.has(s.name)) inter.set(s.name, { s, groups: new Set(), L }); inter.get(s.name).groups.add(L.group); }));
    inter.forEach(({ s, groups, L }, name) => { if (groups.size > 1 && !seen.has(name)) addTag((cfg.shortNames || {})[name] || name, 'x', [...groups], null, { lat: s.lat, lon: s.lon, name, line: L }); });
  }
  function placeTagAnchors() {
    for (const t of TAGS) {
      const w = toWorld(t.anchor.lat, t.anchor.lon); let y = 1.2 * S;
      const hit = byName.get(t.anchor.name); if (hit) y = Math.max(...hit.map(q => q.L.pts ? q.L.pts[q.i].y : 0)) + 1.0 * S;
      t.v.set(w.x, Math.max(y, 1.2 * S), w.z);
    }
  }
  function updateTagVisibility() {
    for (const t of TAGS) {
      let show = state.labels !== 'off';
      if (t.kind === 'x' && state.labels !== 'all') show = false;
      if (t.groups) show = show && t.groups.some(g => GROUPS.find(q => q.id === g).lines.some(lineVisible));
      t.el.hidden = !show;
    }
  }
  const pv = new THREE.Vector3();
  function placeTags() {
    const W = stage.clientWidth, H = stage.clientHeight;
    for (const t of TAGS) { if (t.el.hidden) continue; pv.copy(t.v).project(camera); t.el.style.transform = `translate(${(pv.x * 0.5 + 0.5) * W - t.el.offsetWidth / 2}px, ${(-pv.y * 0.5 + 0.5) * H - 18}px)`; }
  }

  /* ---------------- ledger + legend ---------------- */
  const range = $('#year');
  let viewYear = TNOW;
  function groupStatus(g, y) {
    const open = g.lines.filter(L => L.status === 'open'), building = g.lines.filter(L => L.status !== 'open');
    const extra = building.length && state.planned ? ' + ext.' : '';
    if (!open.length) { const b = building[0]; return (b.status === 'approved' ? 'Approved' : 'Building') + (b.expectYear ? ' · ' + b.expectYear : ''); }
    const all = new Set(), now = new Set();
    open.forEach(L => L.st.forEach(s => { all.add(s.name); if (s.year != null && s.year <= y + 1e-6) now.add(s.name); }));
    if (!now.size) return 'Opens ' + monthYear(Math.min(...open.flatMap(L => L.st.map(s => s.year ?? 9999))));
    if (now.size < all.size) return `${now.size} of ${all.size} stns${extra}`;
    const km = open.reduce((a, L) => a + (L.km || L.mapKm), 0);
    return `${km.toFixed(1)} km${extra}`;
  }
  function renderLedger() {
    const y = viewYear;
    $('#when').textContent = y >= TNOW - 0.005 ? cfg.timeline.nowLabel : monthYear(y);
    const ms = cfg.timeline.milestones.filter(m => m[0] <= y + 0.005).pop();
    $('#what').textContent = ms ? ms[2] : cfg.timeline.before;
    $('#kKm').textContent = (cfg.kmPrefix || '') + kmOpen(y).toFixed(1);
    $('#kSt').textContent = openNames(y).size;
    $('#kLn').textContent = groupsOpen(y);
    $('#lines').innerHTML = GROUPS.map(g => {
      const main = g.lines[0], planned = g.lines.every(L => L.status !== 'open');
      return `<button class="ln" data-g="${g.id}" aria-pressed="${!state.hidden.includes(g.id)}"><span class="bar${planned ? ' dash' : ''}" style="background:${g.hex};color:${g.hex}"></span><span class="nm">${esc(g.name)}<small>${esc((cfg.shortNames || {})[main.st[0].name] || main.st[0].name)} – ${esc((cfg.shortNames || {})[main.st[main.st.length - 1].name] || main.st[main.st.length - 1].name)}</small></span><span class="st">${groupStatus(g, y)}</span></button>`;
    }).join('');
    document.querySelectorAll('.mark').forEach(b => b.classList.toggle('past', +b.dataset.y <= y + 0.005));
    if (cfg.inset.dimAfter) document.querySelectorAll('#insetSvg .bar').forEach(b => b.setAttribute('opacity', +b.dataset.x <= y + 0.005 ? 1 : 0.28));
  }
  $('#lines').addEventListener('click', (e) => {
    const b = e.target.closest('.ln'); if (!b) return;
    const g = b.dataset.g, i = state.hidden.indexOf(g);
    if (i >= 0) state.hidden.splice(i, 1); else state.hidden.push(g);
    save(); rebuild(); renderLedger();
  });
  $('#lines').addEventListener('pointerover', (e) => { const b = e.target.closest('.ln'); if (b) focusGroups([b.dataset.g]); });
  $('#lines').addEventListener('pointerleave', () => focusGroups(null));
  $('#showAll').onclick = () => { state.hidden = []; save(); rebuild(); renderLedger(); };
  function focusGroups(gs) { for (const L of LINES) { const rec = lineMats.get(L.id); if (rec) rec.uDim.value = gs && !gs.includes(L.group) ? 1 : 0; } }

  /* ---------------- timeline ---------------- */
  const X = (y) => ((y - T0) / (TNOW - T0)) * 100;
  $('#marks').innerHTML = cfg.timeline.milestones.map(([y, l, t]) => `<button class="mark" data-y="${y}" style="left:${X(y)}%" title="${esc(l + ': ' + t)}" aria-label="${esc(l)}"><span>${esc(l)}</span><i></i></button>`).join('');
  function layoutMarks() {
    const W = $('#marks').clientWidth, rows = [[], [], []];
    document.querySelectorAll('.mark').forEach(m => {
      const x = parseFloat(m.style.left) / 100 * W, w = m.querySelector('span').offsetWidth + 10;
      const r = rows.findIndex(row => row.every(([a, b]) => x - w / 2 > b || x + w / 2 < a));
      m.style.setProperty('--row', Math.max(0, r)); m.classList.toggle('nolabel', r < 0);
      if (r >= 0) rows[r].push([x - w / 2, x + w / 2]);
    });
  }
  new ResizeObserver(layoutMarks).observe($('#marks')); (document.fonts?.ready || Promise.resolve()).then(layoutMarks);
  $('#marks').addEventListener('click', (e) => { const b = e.target.closest('.mark'); if (b) { stopPlay(); setYear(+b.dataset.y); } });
  function setYear(y, immediate) { viewYear = Math.min(TNOW, Math.max(T0, y)); range.value = viewYear; if (immediate || reduce) uYear.value = viewYear; renderLedger(); }
  range.addEventListener('input', () => { stopPlay(); setYear(+range.value); });
  let playing = null;
  function stopPlay() { if (playing) cancelAnimationFrame(playing.raf); playing = null; $('#play').setAttribute('aria-pressed', 'false'); $('#play').textContent = '▶ Replay'; }
  $('#play').onclick = () => {
    if (playing) return stopPlay();
    if (viewYear >= TNOW - 0.01) setYear(T0, true);
    $('#play').setAttribute('aria-pressed', 'true'); $('#play').textContent = '❚❚ Pause';
    const rate = (TNOW - T0) / (cfg.timeline.playSeconds || 14);
    let last = performance.now();
    const tick = (t) => { const dt = (t - last) / 1000; last = t; setYear(viewYear + dt * rate); if (viewYear >= TNOW) return stopPlay(); playing.raf = requestAnimationFrame(tick); };
    playing = { raf: requestAnimationFrame(tick) };
  };

  /* ---------------- inset chart ---------------- */
  {
    const I = cfg.inset, svg = $('#insetSvg'), W = 280, L = 30, B = 100, T = 12;
    const x = (v) => L + ((v - I.xMin) / (I.xMax - I.xMin)) * (W - L - 12), y = (v) => B - (v / I.yMax) * (B - T);
    const bw = I.barWidth || 14;
    let s = '';
    I.yTicks.forEach(v => { s += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rule)" stroke-width="1"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${I.tickFmt(v)}</text>`; });
    if (I.ref) s += `<line x1="${L}" x2="${W}" y1="${y(I.ref.v)}" y2="${y(I.ref.v)}" stroke="var(--accent)" stroke-dasharray="3 3" stroke-width="1"/><text x="${W}" y="${y(I.ref.v) - 4}" text-anchor="end">${I.ref.label}</text>`;
    I.bars.forEach((r, i) => {
      const bx = x(r.x) - bw / 2, by = y(r.v), h = Math.max(0, B - by), rr = Math.min(3, bw / 2, h);
      s += h > 0.5 ? `<path class="bar" data-x="${r.x}" d="M${bx},${B} v${-(h - rr)} q0,${-rr} ${rr},${-rr} h${bw - 2 * rr} q${rr},0 ${rr},${rr} v${h - rr} z" fill="var(--accent)" opacity="${r.faded ? 0.55 : 1}"/>` : '';
      s += `<rect class="hit" data-i="${i}" x="${bx - 3}" y="${T}" width="${bw + 6}" height="${B - T}" fill="transparent"/>`;
      if (r.label) s += `<text x="${x(r.x)}" y="${B + (r.labelRow ? 21 : 12)}" text-anchor="middle">${r.label}</text>`;
    });
    if (I.valueLabel) { const r = I.bars[I.valueLabel.index]; s += `<text class="v" x="${x(r.x)}" y="${y(r.v) - 6}" text-anchor="middle">${I.valueLabel.text}</text>`; }
    svg.innerHTML = s;
    svg.addEventListener('pointermove', (e) => { const h = e.target.closest('.hit'); if (!h) return hideTip(); showTip(I.bars[+h.dataset.i].tip, e.clientX, e.clientY); });
    svg.addEventListener('pointerleave', hideTip);
  }

  /* ---------------- tooltip + picking ---------------- */
  const tip = $('#tip');
  function showTip(html, x, y) { if (!state.tooltips) return; tip.innerHTML = html; const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.transform = `translate(${Math.min(innerWidth - w - 8, x + 16)}px, ${Math.max(8, Math.min(innerHeight - h - 8, y - h - 12))}px)`; }
  function hideTip() { tip.style.transform = 'translate(-9999px,-9999px)'; }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let pointer = null, hovering = false;
  renderer.domElement.addEventListener('pointermove', (e) => { const r = renderer.domElement.getBoundingClientRect(); pointer = { x: e.clientX, y: e.clientY, nx: ((e.clientX - r.left) / r.width) * 2 - 1, ny: -((e.clientY - r.top) / r.height) * 2 + 1 }; });
  renderer.domElement.addEventListener('pointerleave', () => { pointer = null; hideTip(); if (hovering) { focusGroups(null); hovering = false; } });
  function stationTip(o) {
    const all = byName.get(o.s.name) || [{ L: o.L, s: o.s }];
    const rows = all.map(({ L, s }) => {
      const when = L.status !== 'open' ? (L.status === 'approved' ? 'Approved' : 'Building') + (L.expectYear ? ', exp. ' + L.expectYear : '')
        : (s.year != null && s.year <= viewYear + 1e-6 ? 'Opened ' : 'Opens ') + (shortDate(s.date) || monthYear(s.year));
      return `<div class="t-row"><span><i class="sw" style="background:${L.hex}"></i>${esc(L.name)}</span><span>${when}</span></div>`;
    });
    const uniq = [...new Set(rows)].join('');
    const groups = new Set(all.map(q => q.L.group)).size;
    const lay = o.s.depth === 'u' ? 'Underground' : o.s.depth === 'g' ? 'At grade' : 'Elevated';
    const notes = [lay, groups > 1 ? 'interchange' : '', o.s.interp ? 'position approximate' : '', o.s.note || ''].filter(Boolean).join(' · ');
    return `<div class="t-head">${esc(o.s.name)}</div>${uniq}<div class="t-note">${esc(notes)}</div>`;
  }
  function pick() {
    if (!pointer || !state.tooltips || !stations) return;
    ndc.set(pointer.nx, pointer.ny); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(stations, false)[0];
    if (!hit) { hideTip(); if (hovering) { focusGroups(null); hovering = false; } return; }
    const o = STN[hit.instanceId]; if (!o) return;
    showTip(stationTip(o), pointer.x, pointer.y);
    focusGroups([...new Set((byName.get(o.s.name) || []).map(q => q.L.group))]); hovering = true;
  }

  /* ---------------- settings panel ---------------- */
  const panel = $('#panel');
  const sw = (id, key, after) => { const b = $(id); const set = () => b.setAttribute('aria-checked', String(!!state[key])); set(); b.onclick = () => { state[key] = !state[key]; set(); save(); after(); }; return set; };
  const slider = (id, out, key, fmt, after, live = true) => {
    const r = $(id), o = $(out); const set = () => { r.value = state[key]; o.textContent = fmt(state[key]); }; set();
    r.addEventListener('input', () => { state[key] = +r.value; o.textContent = fmt(state[key]); if (live) after(); else schedule(after); });
    r.addEventListener('change', () => { save(); if (!live) after(); });
    return set;
  };
  const seg = (id, key, after, parse = (v) => v) => {
    const el = $(id); const set = () => el.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(String(state[key]) === b.dataset.v))); set();
    el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state[key] = parse(b.dataset.v); set(); save(); after(); });
    return set;
  };
  let pending = null; const schedule = (fn) => { if (pending) return; pending = requestAnimationFrame(() => { pending = null; fn(); }); };
  const applyTips = () => { $('#tipBtn').setAttribute('aria-pressed', String(state.tooltips)); if (!state.tooltips) { hideTip(); focusGroups(null); } };
  const setters = [
    sw('#c-tooltips', 'tooltips', applyTips),
    seg('#c-labels', 'labels', updateTagVisibility),
    sw('#c-planned', 'planned', () => { rebuild(); renderLedger(); }),
    sw('#c-trains', 'trains', () => { uTrains.value = state.trains ? 1 : 0; }),
    slider('#c-speed', '#o-speed', 'speed', v => v.toFixed(2) + '×', () => {}),
    sw('#c-rotate', 'autoRotate', () => { controls.autoRotate = state.autoRotate; }),
    seg('#c-theme', 'theme', applyTheme),
    slider('#c-glow', '#o-glow', 'glow', v => v.toFixed(2) + '×', applyGlow),
    slider('#c-thick', '#o-thick', 'thickness', v => v.toFixed(2) + '×', rebuild, false),
    slider('#c-height', '#o-height', 'height', v => v.toFixed(2) + '×', rebuild, false),
    slider('#c-ground', '#o-ground', 'ground', v => Math.round(v * 100) + '%', () => { uGround.value = state.ground; }),
    slider('#c-tilt', '#o-tilt', 'tilt', v => v.toFixed(1) + '°', () => setTilt(state.tilt, true)),
  ];
  const viewSeg = $('#c-view');
  viewSeg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.tilt = +b.dataset.v; setters[setters.length - 1](); setTilt(state.tilt, true); save(); });
  const openPanel = (open) => { panel.hidden = !open; $('#custBtn').setAttribute('aria-expanded', String(open)); };
  $('#custBtn').onclick = () => openPanel(panel.hidden);
  $('#closePanel').onclick = () => openPanel(false);
  $('#tipBtn').onclick = () => { state.tooltips = !state.tooltips; save(); setters[0](); applyTips(); };
  $('#resetView').onclick = () => { state.tilt = defaults.tilt; setters[setters.length - 1](); resetCamera(); save(); };
  $('#resetAll').onclick = () => {
    Object.assign(state, { ...defaults, hidden: [] }); save(); setters.forEach(f => f());
    uTrains.value = state.trains ? 1 : 0; uGround.value = state.ground; controls.autoRotate = state.autoRotate;
    applyTips(); applyTheme(); rebuild(); renderLedger(); resetCamera();
  };
  $('#dataBtn').onclick = () => { $('#sheet').hidden = false; };
  $('#closeSheet').onclick = () => { $('#sheet').hidden = true; };
  addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 't' || e.key === 'T') { state.tooltips = !state.tooltips; save(); setters[0](); applyTips(); }
    else if (e.key === 'l' || e.key === 'L') { const order = ['off', 'key', 'all']; state.labels = order[(order.indexOf(state.labels) + 1) % 3]; save(); setters[1](); updateTagVisibility(); }
    else if (e.key === 'Escape') { openPanel(false); $('#sheet').hidden = true; }
  });

  function applyGlow() { if (bloomNode) bloomNode.strength.value = state.glow * THEMES[state.theme].glow; }
  function applyTheme() {
    const T = THEMES[state.theme], root = document.documentElement.style;
    ['bg', 'ink', 'muted', 'rule', 'panel'].forEach(k => root.setProperty('--' + k, T[k]));
    root.setProperty('--accent', T.scheme === 'light' ? (cfg.accentOnLight || cfg.accent) : cfg.accent);
    root.colorScheme = T.scheme;
    scene.background.set(T.bg);
    ['slabTop', 'slabGlow', 'grid', 'slabSide', 'water', 'pillar'].forEach(k => U[k].value.set(T[k]));
    hemi.color.set(T.sky); hemi.groundColor.set(T.ground);
    cOpen.set(T.open); cShut.set(T.shut); colorStations(uYear.value, true);
    uEmis.value = T.emissive; applyGlow();
  }

  /* ---------------- sizing + loop ---------------- */
  function resize() {
    const W = stage.clientWidth, H = stage.clientHeight; if (!W || !H) return;
    renderer.setSize(W, H, false);
    const aspect = W / H, narrow = W < 760;
    // fit the network's iso footprint: width ≈ (ΔE+ΔN)·cos45, height ≈ that · sin(35°) plus depth
    const ext = (maxE - minE + maxN - minN) * S2, needW = ext * (narrow ? 0.81 : 1.15), needH = ext * (narrow ? 0.65 : 0.77);
    const h = Math.max(needH, needW / aspect);
    Object.assign(camera, { left: -h * aspect / 2, right: h * aspect / 2, top: h / 2, bottom: -h / 2 }); camera.updateProjectionMatrix();
  }
  controls.autoRotate = state.autoRotate;
  applyTheme(); rebuild(); resetCamera();
  new ResizeObserver(resize).observe(stage); resize();
  renderLedger(); applyTips();
  if (FILM) return filmApi();
  let last = performance.now() / 1000, tAcc = 0, frame = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now() / 1000, dt = Math.min(0.05, now - last); last = now;
    if (!reduce) { tAcc += dt * state.speed; uTime.value = tAcc; }
    uYear.value += (viewYear - uYear.value) * Math.min(1, dt * 4);
    colorStations(uYear.value);
    controls.update();
    if (pipeline) pipeline.render(); else renderer.render(scene, camera);
    placeTags();
    if (++frame % 3 === 0) pick();
  });
  return { setYear, state };

  /* ---------------- film mode: the page sets every frame ---------------- */
  function filmApi() {
    controls.enabled = false;
    uFutureDash.value = 0; uPlannedDash.value = 0;
    const d = new THREE.Object3D(), tgt = new THREE.Vector3(), pv2 = new THREE.Vector3();
    const bump = (at, y, yPast) => (y > yPast + 1e-6 && at > yPast && at <= y) ? 1 - (y - at) / (y - yPast) : 0;
    const cTmp = new THREE.Color();
    function update(y, yPast, planned, dimBy, stScale) {
      STN.forEach((o, i) => {
        let sc = 0, col = cShut;
        if (o.L.status === 'open' && o.at <= y + 1e-6) {
          const n = new Set(byName.get(o.s.name).filter(q => q.L.status === 'open' && q.s.year != null && q.s.year <= y + 1e-6).map(q => q.L.group)).size;
          sc = (n > 1 ? 1.45 : 1) * (1 + 0.5 * bump(o.at, y, yPast)); col = cTmp.copy(cOpen).lerp(cShut, 0.9 * (dimBy[o.L.group] || 0));
        } else if (o.L.status !== 'open') sc = 0.8 * planned;
        d.position.copy(o.p); d.scale.setScalar(Math.max(sc * stScale, 1e-4)); d.updateMatrix(); stations.setMatrixAt(i, d.matrix); stations.setColorAt(i, col);
      });
      stations.instanceMatrix.needsUpdate = true; if (stations.instanceColor) stations.instanceColor.needsUpdate = true;
      if (pillars) {
        PIL.forEach((o, i) => {
          const k = o.L.status === 'open' ? Math.min(1, Math.max(0, (y - (o.at - 0.15)) / 0.15)) : 0.55 * planned; // pillars rise just before the deck
          d.position.set(o.p.x, SURF, o.p.z); d.scale.set(k > 0 ? o.w : 1e-4, Math.max(1e-4, o.h * k), k > 0 ? o.w : 1e-4); d.updateMatrix(); pillars.setMatrixAt(i, d.matrix);
        });
        pillars.instanceMatrix.needsUpdate = true;
      }
    }
    return {
      S, CENTER, LINES, GROUPS, camera, stage, renderer, kmOpen, openNames, groupsOpen,
      world: (lat, lon, y = 0) => { const w = toWorld(lat, lon); return new THREE.Vector3(w.x, y, w.z); },
      station(name, group) { const hit = (byName.get(name) || []).find(q => !group || q.L.group === group); return hit && hit.L.pts ? hit.L.pts[hit.i].clone() : null; },
      project(v) { pv2.copy(v).project(camera); return { x: (pv2.x * 0.5 + 0.5) * stage.clientWidth, y: (-pv2.y * 0.5 + 0.5) * stage.clientHeight, behind: pv2.z > 1 }; },
      // az: compass-like turn around the target (45 = the page's default view), pol: tilt from straight down
      setCamera({ x, y = 0, z, az = 45, pol = 54.7, zoom = 1 }) {
        tgt.set(x, y, z); const r = 140 * S, ph = pol * Math.PI / 180, th = az * Math.PI / 180;
        camera.position.set(x + r * Math.sin(ph) * Math.sin(th), y + r * Math.cos(ph), z + r * Math.sin(ph) * Math.cos(th));
        camera.up.set(0, 1, 0); camera.lookAt(tgt); camera.zoom = zoom; camera.updateProjectionMatrix();
      },
      resize,
      render({ t = 0, year, yearPast = year, planned = 0, future = 0, ground = state.ground, dims = {}, glow = 1, trains = 1, stScale = 1 }) {
        uTime.value = t * state.speed; uYear.value = year; uFreshWin.value = Math.max(0, year - yearPast);
        uPlannedDash.value = planned; uFutureDash.value = future; uGround.value = ground; uTrains.value = trains;
        for (const L of LINES) { const rec = lineMats.get(L.id); if (rec) rec.uDim.value = dims[L.group] ?? dims['*'] ?? 0; }
        if (bloomNode) bloomNode.strength.value = glow * THEMES[state.theme].glow;
        const dimBy = Object.fromEntries(GROUPS.map(g => [g.id, dims[g.id] ?? dims['*'] ?? 0]));
        update(year, yearPast, planned, dimBy, stScale);
        if (pipeline) pipeline.render(); else renderer.render(scene, camera);
      },
    };
  }
}
