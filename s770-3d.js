// VIETMAP S770 · mô hình 3D cho landing: xoay theo cuộn ở khối "Ba kênh", rồi thành chế độ tương tác ở mục "Cầm máy trên tay".
// Dựa trên S770_web_handoff/interactive_dark.html (three.js 0.169). Một renderer duy nhất, canvas chuyển qua lại giữa 2 khung.
const V = '0.169.0';
const CDN = `https://cdn.jsdelivr.net/npm/three@${V}`;
const [THREE, { OrbitControls }, { GLTFLoader }, { DRACOLoader }, { RGBELoader }] = await Promise.all([
  import(`${CDN}/+esm`),
  import(`${CDN}/examples/jsm/controls/OrbitControls.js/+esm`),
  import(`${CDN}/examples/jsm/loaders/GLTFLoader.js/+esm`),
  import(`${CDN}/examples/jsm/loaders/DRACOLoader.js/+esm`),
  import(`${CDN}/examples/jsm/loaders/RGBELoader.js/+esm`),
]);

const B = window.__B || '';
const boxA = document.getElementById('m3dA');
const boxB = document.getElementById('m3dB');
const TOUCH = matchMedia('(pointer: coarse)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) { throw new Error('WebGL'); }
renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.5 : 1.75));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.4;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.setAttribute('aria-label', 'Mô hình 3D camera hành trình VIETMAP S770');
renderer.domElement.style.touchAction = 'pan-y';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.005, 10);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.enablePan = false; controls.enableZoom = false; controls.enabled = false; // không bắt con lăn: trang vẫn cuộn khi chuột nằm trên khung 3D
let dirty = true; const invalidate = () => { dirty = true; };
controls.addEventListener('change', invalidate);

new RGBELoader().load(B + 'env_studio_dark.hdr', (hdr) => { hdr.mapping = THREE.EquirectangularReflectionMapping; scene.environment = hdr; invalidate(); });

const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
let model = null, center = new THREE.Vector3(), radius = 0.07, screenMat = null;

// góc nhìn theo bước (độ): theta quanh trục đứng tính từ mặt trước +Z, phi từ đỉnh xuống
const K = {
  road:   { th: 158, ph: 76, d: 0.95 },   // ① mặt sau: camera trước hướng ra đường
  cabin:  { th: -36, ph: 72, d: 0.95 },   // ② camera trong xe
  screen: { th: 14,  ph: 80, d: 0.98 },   // ③ màn hình 3 ô
  play:   { th: 30,  ph: 72, d: 0.82 },
};
// tiến độ cuộn p (0..1) -> góc nhìn: giữ, chuyển, giữ, chuyển, giữ
const TRACK = [[0, K.road], [0.26, K.road], [0.40, K.cabin], [0.60, K.cabin], [0.74, K.screen], [1, K.screen]];

function fitDistance() {
  const v = THREE.MathUtils.degToRad(camera.fov), h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
  return radius / Math.sin(Math.min(v, h) / 2) * 1.08;
}
function placeCam(th, ph, d) {
  const R = fitDistance() * d, t = THREE.MathUtils.degToRad(th), p = THREE.MathUtils.degToRad(ph);
  camera.position.set(center.x + R * Math.sin(p) * Math.sin(t), center.y + R * Math.cos(p), center.z + R * Math.sin(p) * Math.cos(t));
  camera.lookAt(center); invalidate();
}
function shiftView(f) {
  const w = renderer.domElement.width, h = renderer.domElement.height;
  if (!f) { camera.clearViewOffset(); return; }
  camera.setViewOffset(w, h, w * f, 0, w, h);
}
// ảnh camera sau R04 đứng cạnh thân máy, cao bằng 0,61 thân máy (tỉ lệ đo trên ảnh render chính hãng S770_01_hero_full_set)
const R04_RATIO = 0.61;
let mbox = null;
const chip = boxA.querySelector('.rear-chip');
function placeRear() {
  if (!chip || !mbox) return;
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const W = boxA.clientWidth, H = boxA.clientHeight;
  const pts = [];
  for (const x of [mbox.min.x, mbox.max.x]) for (const y of [mbox.min.y, mbox.max.y]) for (const z of [mbox.min.z, mbox.max.z]) {
    const p = new THREE.Vector3(x, y, z).project(camera); pts.push({ x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H });
  }
  const top = Math.min(...pts.map((p) => p.y)), bot = Math.max(...pts.map((p) => p.y)), right = Math.max(...pts.map((p) => p.x));
  const h = (bot - top) * 0.78 * R04_RATIO;   // hộp bao chiếu nghiêng cao hơn thân máy thật ~22%
  chip.style.height = h + 'px';
  chip.style.top = (bot - h - 20) + 'px';
  chip.style.left = Math.min(W - h * 0.55, right + 6) + 'px';
  chip.style.right = 'auto'; chip.style.marginTop = '0';
}
const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
function lerpAngle(a, b, t) { let d = b - a; while (d > 180) d -= 360; while (d < -180) d += 360; return a + d * t; }
let scrollP = 0;
function applyScroll() {
  if (mode !== 'scroll' || !model) return;
  let i = 0; while (i < TRACK.length - 2 && scrollP > TRACK[i + 1][0]) i++;
  const [p0, a] = TRACK[i], [p1, b] = TRACK[i + 1];
  const t = ease(Math.min(1, Math.max(0, (scrollP - p0) / ((p1 - p0) || 1))));
  placeCam(lerpAngle(a.th, b.th, t), a.ph + (b.ph - a.ph) * t, a.d + (b.d - a.d) * t);
  // bước ③: dời máy sang trái để chừa chỗ cho ảnh camera sau R04 đứng cạnh
  const k3 = ease(Math.min(1, Math.max(0, (scrollP - 0.60) / 0.14)));
  shiftView(0.18 * k3);
  placeRear();
  // camera trong xe gật nhẹ ở bước ②
  const cab = model.getObjectByName('S770_CamCabin_Pivot');
  if (cab) { const k = Math.max(0, 1 - Math.abs(scrollP - 0.5) / 0.18); cab.rotation.x = THREE.MathUtils.degToRad(-14 * Math.sin(k * Math.PI / 2)); }
}

// ---- màn hình: ô 1 là ảnh 3 kênh theo nhóm xe, rồi 3 giao diện gốc
const tl = new THREE.TextureLoader();
const texCache = {};
function tex(url, cb) {
  if (texCache[url]) return cb(texCache[url]);
  tl.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 4; texCache[url] = t; cb(t); });
}
let group = window.__grp || 'dich-vu', uiIdx = 0;
const uiList = () => [B + (group === 'gia-dinh' ? 'ai_screen_family.webp' : 'ai_screen_service.webp'), B + 'gd2.webp', B + 'gd3.webp', B + 'gd4.webp'];
function showUI(i) {
  const L = uiList(); uiIdx = (i + L.length) % L.length; const want = uiIdx;
  const out = document.getElementById('uiNo'); if (out) out.textContent = (uiIdx + 1) + ' / ' + L.length;
  tex(L[want], (t) => { if (want !== uiIdx || !screenMat) return; screenMat.emissiveMap = t; screenMat.needsUpdate = true; invalidate(); });
}

new GLTFLoader().setDRACOLoader(draco).load(B + 'S770_web.glb?v=14', (gltf) => {
  model = gltf.scene; scene.add(model);
  const b = new THREE.Box3().setFromObject(model); b.getCenter(center); mbox = b.clone();
  radius = b.getSize(new THREE.Vector3()).length() / 2 * 1.04;
  controls.target.copy(center); controls.minDistance = radius * 0.8;
  // bóng mềm dưới máy
  const g = document.createElement('canvas'); g.width = g.height = 128; const x = g.getContext('2d');
  const grd = x.createRadialGradient(64, 64, 0, 64, 64, 64); grd.addColorStop(0, 'rgba(0,0,0,0.6)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = grd; x.fillRect(0, 0, 128, 128);
  const s = b.getSize(new THREE.Vector3());
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(s.x * 1.5, s.z * 1.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(g), transparent: true, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.set(center.x, b.min.y + 0.0005, center.z); scene.add(sh);
  model.traverse((o) => { if (o.isMesh && o.material && o.material.name === 'GLB_screen_ui') screenMat = o.material; });
  if (screenMat) screenMat.emissiveIntensity = 0.75;
  showUI(0);
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 500));
  idle(() => uiList().slice(1).forEach((u) => tex(u, () => {})));
  resize(); applyScroll(); if (mode === 'play') placeCam(K.play.th, K.play.ph, K.play.d);
  boxA.classList.add('ready'); boxB.classList.add('ready');
}, undefined, (e) => console.warn('GLB', e));

// ---- hai khung: A (ghim theo cuộn) và B (tương tác). Canvas đi theo khung đang hiện.
let mode = 'scroll', host = null;
function attach(to) {
  if (host === to) return; host = to;
  to.appendChild(renderer.domElement);
  mode = to === boxB ? 'play' : 'scroll';
  controls.enabled = mode === 'play';
  if (mode === 'play') { shiftView(0); controls.autoRotate = true; controls.autoRotateSpeed = 2.4; if (model) placeCam(K.play.th, K.play.ph, K.play.d); controls.update(); }
  else { controls.autoRotate = false; applyScroll(); }
  resize();
}
function resize() {
  if (!host) return;
  const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (model) { controls.maxDistance = fitDistance() * 2.5; if (mode === 'scroll') applyScroll(); }
  invalidate();
}
new ResizeObserver(resize).observe(boxA); new ResizeObserver(resize).observe(boxB);
const vis = { A: false, B: false };
new IntersectionObserver((es) => {
  es.forEach((e) => { vis[e.target === boxA ? 'A' : 'B'] = e.isIntersecting; });
  if (vis.B) attach(boxB); else if (vis.A) attach(boxA);
  invalidate();
}, { threshold: 0.15 }).observe(boxA);
new IntersectionObserver((es) => {
  es.forEach((e) => { vis.B = e.isIntersecting; });
  if (vis.B) attach(boxB); else if (vis.A) attach(boxA);
  invalidate();
}, { threshold: 0.35 }).observe(boxB);
attach(boxA);

// ---- nút ▲ ▼ HTML + chạm vào khung thì dừng tự xoay
document.querySelectorAll('[data-ui]').forEach((b) => b.addEventListener('click', () => { controls.autoRotate = false; showUI(uiIdx + (+b.dataset.ui)); }));
renderer.domElement.addEventListener('pointerdown', () => { if (mode === 'play') controls.autoRotate = false; });
['contextmenu', 'selectstart', 'dragstart'].forEach((ev) => boxB.addEventListener(ev, (e) => e.preventDefault()));

renderer.setAnimationLoop(() => {
  if (!vis.A && !vis.B) return;
  if (mode === 'play' && controls.update()) dirty = true;
  if (dirty) { renderer.render(scene, camera); dirty = false; }
});

window.__s770 = {
  scrollP(p) { scrollP = p; applyScroll(); },
  setGroup(g) { group = g; if (uiIdx === 0) showUI(0); },
  showUI, camera, controls, renderer,
};
