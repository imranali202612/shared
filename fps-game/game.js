/* =====================================================================
 *  NEON ARENA — a tiny but complete browser-based 1v1 FPS
 *  Renderer: three.js   |   Controls: PointerLockControls   |   No build step
 * ===================================================================== */

import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

// ---------- Tunables ----------
const ARENA_SIZE = 60;          // square arena half-size in world units
const WALL_HEIGHT = 8;
const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const GRAVITY = 28;
const JUMP_VELOCITY = 9;
const WALK_SPEED = 6.5;
const SPRINT_MULT = 1.7;
const FRICTION = 12;
const ACCEL = 70;
const MAG_SIZE = 12;
const RESERVE_AMMO = 60;
const RELOAD_TIME = 1.4;        // seconds
const FIRE_INTERVAL = 0.11;     // seconds between shots
const WEAPON_DAMAGE = 22;
const WEAPON_RANGE = 80;
const WEAPON_SPREAD = 0.0035;   // small inaccuracy
const PLAYER_MAX_HP = 100;
const PLAYER_MAX_SHIELD = 50;

// Difficulty presets
const DIFFICULTY = {
  easy:   { aimErr: 0.07, fireRate: 1.1, dmg: 8,  reactT: 0.55, hp: 110 },
  normal: { aimErr: 0.04, fireRate: 0.7, dmg: 12, reactT: 0.32, hp: 140 },
  hard:   { aimErr: 0.02, fireRate: 0.45,dmg: 16, reactT: 0.18, hp: 180 },
};

// ---------- DOM ----------
const $ = (s) => document.querySelector(s);
const canvas = $("#game-canvas");
const menuEl = $("#menu");
const hudEl = $("#hud");
const pauseEl = $("#pause");
const endEl = $("#end-screen");
const loadingEl = $("#loading");
const startBtn = $("#start-btn");
const howBtn = $("#how-btn");
const howPanel = $("#how-panel");
const restartBtn = $("#restart-btn");
const menuBtn = $("#menu-btn");
const diffBtns = document.querySelectorAll(".diff-btn");
const healthBar = $("#health-bar");
const healthText = $("#health-text");
const shieldBar = $("#shield-bar");
const shieldText = $("#shield-text");
const playerBar = $("#player-bar");
const enemyBar = $("#enemy-bar");
const ammoMag = $("#ammo-mag");
const ammoReserve = $("#ammo-reserve");
const reloadHint = $("#reload-hint");
const hitMarker = $("#hit-marker");
const damageVignette = $("#damage-vignette");
const killFeed = $("#kill-feed");
const endTitle = $("#end-title");
const endSub = $("#end-sub");
const endTime = $("#end-time");
const endShots = $("#end-shots");
const endAcc = $("#end-acc");

// ---------- Renderer / Scene ----------
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.Fog(0x0a0e1c, 25, 90);

const camera = new THREE.PerspectiveCamera(
  78,
  window.innerWidth / window.innerHeight,
  0.05,
  500
);

const controls = new PointerLockControls(camera, document.body);
scene.add(controls.getObject());

// Separate small scene for the first-person weapon (rendered on top, no fog)
const weaponScene = new THREE.Scene();
const weaponCamera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.01,
  10
);

window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  weaponCamera.aspect = w / h;
  weaponCamera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ---------- Audio (procedural via Web Audio API) ----------
const audio = (() => {
  let ctx = null;
  const ensure = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };
  const env = (g, t, a = 0.005, d = 0.08, peak = 0.7) => {
    const now = t;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + a);
    g.gain.exponentialRampToValueAtTime(0.0001, now + a + d);
  };
  return {
    shoot() {
      const c = ensure();
      const t = c.currentTime;
      // body: low square thump
      const o1 = c.createOscillator(); o1.type = "square"; o1.frequency.setValueAtTime(180, t);
      o1.frequency.exponentialRampToValueAtTime(60, t + 0.08);
      const g1 = c.createGain(); env(g1, t, 0.002, 0.08, 0.45);
      o1.connect(g1).connect(c.destination); o1.start(t); o1.stop(t + 0.1);
      // crack: noise burst
      const buf = c.createBuffer(1, 2048, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const noise = c.createBufferSource(); noise.buffer = buf;
      const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1500;
      const g2 = c.createGain(); env(g2, t, 0.001, 0.06, 0.35);
      noise.connect(hp).connect(g2).connect(c.destination); noise.start(t); noise.stop(t + 0.07);
    },
    enemyShoot() {
      const c = ensure();
      const t = c.currentTime;
      const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(120, t + 0.09);
      const g = c.createGain(); env(g, t, 0.002, 0.09, 0.18);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.11);
    },
    hit() {
      const c = ensure();
      const t = c.currentTime;
      const o = c.createOscillator(); o.type = "triangle";
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(400, t + 0.08);
      const g = c.createGain(); env(g, t, 0.001, 0.08, 0.25);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.1);
    },
    hurt() {
      const c = ensure();
      const t = c.currentTime;
      const o = c.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
      const g = c.createGain(); env(g, t, 0.005, 0.18, 0.3);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.2);
    },
    reload() {
      const c = ensure();
      const t = c.currentTime;
      const o = c.createOscillator(); o.type = "square";
      o.frequency.setValueAtTime(700, t);
      o.frequency.exponentialRampToValueAtTime(420, t + 0.07);
      const g = c.createGain(); env(g, t, 0.001, 0.07, 0.15);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.08);
      setTimeout(() => {
        const t2 = c.currentTime;
        const o2 = c.createOscillator(); o2.type = "square";
        o2.frequency.setValueAtTime(520, t2);
        const g2 = c.createGain(); env(g2, t2, 0.001, 0.06, 0.15);
        o2.connect(g2).connect(c.destination); o2.start(t2); o2.stop(t2 + 0.08);
      }, 350);
    },
    explode() {
      const c = ensure();
      const t = c.currentTime;
      const buf = c.createBuffer(1, 8192, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const noise = c.createBufferSource(); noise.buffer = buf;
      const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 800;
      const g = c.createGain(); env(g, t, 0.005, 0.5, 0.7);
      noise.connect(lp).connect(g).connect(c.destination); noise.start(t); noise.stop(t + 0.55);
    },
    victory() {
      const c = ensure();
      const t = c.currentTime;
      [523, 659, 784, 1046].forEach((f, i) => {
        const o = c.createOscillator(); o.type = "triangle";
        o.frequency.setValueAtTime(f, t + i * 0.12);
        const g = c.createGain(); env(g, t + i * 0.12, 0.005, 0.18, 0.25);
        o.connect(g).connect(c.destination);
        o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.2);
      });
    },
  };
})();

// ---------- Lighting ----------
const ambient = new THREE.AmbientLight(0x223355, 0.4);
scene.add(ambient);

const hemi = new THREE.HemisphereLight(0x88aaff, 0x110a22, 0.5);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xbfd6ff, 0.8);
dir.position.set(30, 50, 20);
dir.castShadow = true;
dir.shadow.mapSize.set(1024, 1024);
dir.shadow.camera.left = -ARENA_SIZE;
dir.shadow.camera.right = ARENA_SIZE;
dir.shadow.camera.top = ARENA_SIZE;
dir.shadow.camera.bottom = -ARENA_SIZE;
dir.shadow.camera.near = 1;
dir.shadow.camera.far = 120;
scene.add(dir);

// Neon corner accent lights
const corners = [
  [ARENA_SIZE - 4, 6, ARENA_SIZE - 4, 0x14f0ff],
  [-ARENA_SIZE + 4, 6, -ARENA_SIZE + 4, 0xff2bd6],
  [ARENA_SIZE - 4, 6, -ARENA_SIZE + 4, 0x8a4bff],
  [-ARENA_SIZE + 4, 6, ARENA_SIZE - 4, 0x1eff8b],
];
for (const [x, y, z, col] of corners) {
  const pl = new THREE.PointLight(col, 1.4, 60, 1.6);
  pl.position.set(x, y, z);
  scene.add(pl);
}

// ---------- Arena Geometry ----------
const collidables = []; // { box: THREE.Box3, mesh: Object3D, kind: 'wall'|'pillar' }

function makeFloor() {
  const size = ARENA_SIZE * 2;
  // Procedural grid texture
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0a0e1c";
  ctx.fillRect(0, 0, 512, 512);
  // Grid lines
  ctx.strokeStyle = "#14f0ff";
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1.2;
  for (let i = 0; i <= 512; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
  }
  // Major lines
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2;
  for (let i = 0; i <= 512; i += 128) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
  }
  // Speckle
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 800; i++) {
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(size / 8, size / 8);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.9,
    metalness: 0.1,
    color: 0x6a7da8,
  });
  const geo = new THREE.PlaneGeometry(size, size);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  scene.add(m);
}

function makeCeiling() {
  const size = ARENA_SIZE * 2;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0a0d18,
    roughness: 0.8,
    metalness: 0.2,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  m.rotation.x = Math.PI / 2;
  m.position.y = WALL_HEIGHT;
  scene.add(m);
}

function makeWall(x, z, w, h, d, color = 0x1a2238) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.6,
    metalness: 0.3,
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);

  // Neon trim along the top
  const trimMat = new THREE.MeshBasicMaterial({ color: 0x14f0ff });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), trimMat);
  trim.position.set(x, h - 0.04, z);
  scene.add(trim);

  const box = new THREE.Box3().setFromObject(m);
  collidables.push({ box, mesh: m, kind: "wall" });
}

function makeArenaWalls() {
  const t = 1.5;
  const s = ARENA_SIZE;
  // 4 outer walls
  makeWall(0, -s, s * 2 + t, WALL_HEIGHT, t);
  makeWall(0, s, s * 2 + t, WALL_HEIGHT, t);
  makeWall(-s, 0, t, WALL_HEIGHT, s * 2 + t);
  makeWall(s, 0, t, WALL_HEIGHT, s * 2 + t);
}

function makePillar(x, z, h = 5, w = 3) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x22304d,
    roughness: 0.55,
    metalness: 0.4,
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
  m.position.set(x, h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);

  // Vertical neon strip
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, h * 0.8, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xff2bd6 })
  );
  strip.position.set(x + w / 2 + 0.06, h * 0.5, z);
  scene.add(strip);

  const box = new THREE.Box3().setFromObject(m);
  collidables.push({ box, mesh: m, kind: "pillar" });
}

function makeRamp(x, z, w = 6, h = 1.2, d = 4, rotY = 0) {
  // Low cover crate (no real ramp logic — just a box low enough to walk around)
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a3856,
    roughness: 0.7,
    metalness: 0.2,
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, h / 2, z);
  m.rotation.y = rotY;
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.06, d),
    new THREE.MeshBasicMaterial({ color: 0x1eff8b })
  );
  trim.position.set(x, h, z);
  trim.rotation.y = rotY;
  scene.add(trim);

  const box = new THREE.Box3().setFromObject(m);
  collidables.push({ box, mesh: m, kind: "pillar" });
}

function buildArena() {
  makeFloor();
  makeCeiling();
  makeArenaWalls();
  // Pillars
  makePillar(-18, -18);
  makePillar(18, -18);
  makePillar(-18, 18);
  makePillar(18, 18);
  makePillar(0, 0, 6, 2);
  // Cover crates
  makeRamp(-10, 6, 5, 1.2, 2.4);
  makeRamp(12, -8, 5, 1.4, 2.4, Math.PI / 6);
  makeRamp(-22, -2, 4, 1, 6, Math.PI / 2);
  makeRamp(22, 4, 4, 1, 6, Math.PI / 2);
  makeRamp(4, 22, 6, 1.5, 2.4);
  makeRamp(-6, -24, 6, 1.5, 2.4);
}

// ---------- Player Weapon (first-person rig) ----------
function buildWeaponRig() {
  const grp = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x23314d,
    roughness: 0.4,
    metalness: 0.85,
  });
  const accentMat = new THREE.MeshBasicMaterial({ color: 0x14f0ff });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x0c1322,
    roughness: 0.3,
    metalness: 0.9,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.5), bodyMat);
  body.position.set(0, 0, -0.05);
  grp.add(body);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 16), darkMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.45);
  grp.add(barrel);

  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16), darkMat);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.02, -0.72);
  grp.add(muzzle);

  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.12), darkMat);
  sight.position.set(0, 0.13, -0.05);
  grp.add(sight);

  const sightDot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), accentMat);
  sightDot.position.set(0, 0.16, -0.12);
  grp.add(sightDot);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.12), bodyMat);
  grip.position.set(0, -0.18, 0.05);
  grip.rotation.x = -0.25;
  grp.add(grip);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.16), darkMat);
  mag.position.set(0, -0.18, -0.1);
  grp.add(mag);

  // Glowing energy core on side
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.18), accentMat);
  core.position.set(0.1, 0.0, -0.1);
  grp.add(core);
  const core2 = core.clone();
  core2.position.x = -0.1;
  grp.add(core2);

  // Muzzle flash sprite (hidden by default)
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xfff2a8,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), flashMat);
  flash.position.set(0, 0.02, -0.78);
  grp.add(flash);

  // Position rig in lower-right of view
  grp.position.set(0.22, -0.22, -0.5);
  weaponScene.add(grp);

  return { group: grp, flash, flashMat };
}

const weapon = buildWeaponRig();

// Weapon-scene lighting
weaponScene.add(new THREE.AmbientLight(0xffffff, 0.65));
const wDir = new THREE.DirectionalLight(0x88bbff, 0.8);
wDir.position.set(0.5, 1, 0.5);
weaponScene.add(wDir);

// ---------- Enemy ----------
class Enemy {
  constructor() {
    this.group = new THREE.Group();
    this.maxHp = 140;
    this.hp = this.maxHp;
    this.dead = false;
    this.lastShot = 0;
    this.targetReachT = 0;       // when we last picked a wander target
    this.wanderTarget = new THREE.Vector3();
    this.lastSawPlayer = -Infinity;
    this.sawPlayerSince = null;  // timestamp when first saw player (for reaction delay)
    this.aimError = new THREE.Vector3();
    this.aimErrorT = 0;
    this.velocity = new THREE.Vector3();
    this.strafeDir = 1;
    this.strafeT = 0;
    this.muzzleFlashT = 0;
    this.build();
  }

  build() {
    // ===== Materials =====
    // Dark blood-red armor with subtle emissive bleed
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x1a0710,
      roughness: 0.45,
      metalness: 0.85,
      emissive: 0x2a0006,
      emissiveIntensity: 0.5,
    });
    // Plated gunmetal under-suit
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x141822,
      roughness: 0.55,
      metalness: 0.9,
    });
    // Almost-black darker accents
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x07070b,
      roughness: 0.3,
      metalness: 0.95,
    });
    // Glowing red (eyes / vents / energy)
    const redGlowMat = new THREE.MeshBasicMaterial({ color: 0xff1a3a });
    // Hot ember (reactor core)
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xff4a1a });
    // Antenna tip glow
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff7e3b });

    // ===== Pelvis / Hip =====
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.5), plateMat);
    pelvis.position.y = 1.0;
    pelvis.castShadow = true;
    this.group.add(pelvis);

    // Hip belt with red energy line
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 0.54), darkMat);
    belt.position.y = 1.18;
    this.group.add(belt);
    const beltGlow = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.025, 0.02),
      redGlowMat
    );
    beltGlow.position.set(0, 1.18, 0.28);
    this.group.add(beltGlow);

    // ===== Torso (tapered: wider chest, narrower waist via two stacked boxes) =====
    const lowerTorso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.45, 0.5), armorMat);
    lowerTorso.position.y = 1.45;
    lowerTorso.castShadow = true;
    this.group.add(lowerTorso);

    const upperTorso = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.55), armorMat);
    upperTorso.position.y = 1.85;
    upperTorso.castShadow = true;
    this.group.add(upperTorso);

    // V-shaped chest plate (two angled boxes forming a V around the reactor)
    const chestL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.05), darkMat);
    chestL.position.set(-0.14, 1.85, 0.30);
    chestL.rotation.z = -0.45;
    this.group.add(chestL);
    const chestR = chestL.clone();
    chestR.position.set(0.14, 1.85, 0.30);
    chestR.rotation.z = 0.45;
    this.group.add(chestR);

    // Chest ribs (3 horizontal armor strips)
    for (let i = 0; i < 3; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.04, 0.02), darkMat);
      rib.position.set(0, 1.7 + i * 0.12, 0.28);
      this.group.add(rib);
    }

    // Reactor core (THE weak spot — glowing ember sphere recessed in chest)
    const coreSocket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.06, 16),
      darkMat
    );
    coreSocket.rotation.x = Math.PI / 2;
    coreSocket.position.set(0, 1.65, 0.28);
    this.group.add(coreSocket);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 16, 16),
      emberMat.clone()
    );
    core.position.set(0, 1.65, 0.32);
    this.group.add(core);
    this.core = core;

    // Reactor halo (faint additive ring)
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.24, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff2a0a,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    halo.position.set(0, 1.65, 0.34);
    this.group.add(halo);
    this.halo = halo;

    // ===== Neck =====
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.18, 8), darkMat);
    neck.position.y = 2.18;
    this.group.add(neck);

    // ===== Head / Helmet =====
    // Skull-like helmet built from a box plus an angled forehead and a jutting jaw
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.52), armorMat);
    helmet.position.y = 2.4;
    helmet.castShadow = true;
    this.group.add(helmet);

    // Forehead "horn-brow": two angled plates forming a frowning V
    const browL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.06), darkMat);
    browL.position.set(-0.1, 2.5, 0.24);
    browL.rotation.z = -0.5;
    this.group.add(browL);
    const browR = browL.clone();
    browR.position.set(0.1, 2.5, 0.24);
    browR.rotation.z = 0.5;
    this.group.add(browR);

    // Two glowing red eyes (separate – more menacing than a strip)
    const eyeGeo = new THREE.SphereGeometry(0.05, 10, 10);
    const eyeL = new THREE.Mesh(eyeGeo, redGlowMat);
    eyeL.position.set(-0.13, 2.42, 0.27);
    this.group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeo, redGlowMat);
    eyeR.position.set(0.13, 2.42, 0.27);
    this.group.add(eyeR);
    this.eyeL = eyeL;
    this.eyeR = eyeR;

    // Jaw / mouth-grille (two teeth-like vents)
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.06), darkMat);
    jaw.position.set(0, 2.28, 0.26);
    this.group.add(jaw);
    for (let i = 0; i < 4; i++) {
      const tooth = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.08, 0.02),
        redGlowMat
      );
      tooth.position.set(-0.13 + i * 0.087, 2.28, 0.295);
      this.group.add(tooth);
    }

    // Skull-side "tusks": angled spikes coming off the cheek
    const tuskGeo = new THREE.ConeGeometry(0.04, 0.18, 6);
    const tuskL = new THREE.Mesh(tuskGeo, darkMat);
    tuskL.position.set(-0.27, 2.3, 0.18);
    tuskL.rotation.z = Math.PI / 2 + 0.3;
    this.group.add(tuskL);
    const tuskR = new THREE.Mesh(tuskGeo, darkMat);
    tuskR.position.set(0.27, 2.3, 0.18);
    tuskR.rotation.z = -Math.PI / 2 - 0.3;
    this.group.add(tuskR);

    // ===== Shoulder pauldrons (with spikes) =====
    const pauldronGeo = new THREE.BoxGeometry(0.42, 0.32, 0.42);
    const pauldronL = new THREE.Mesh(pauldronGeo, armorMat);
    pauldronL.position.set(-0.65, 1.95, 0);
    pauldronL.rotation.z = 0.2;
    pauldronL.castShadow = true;
    this.group.add(pauldronL);
    const pauldronR = pauldronL.clone();
    pauldronR.position.set(0.65, 1.95, 0);
    pauldronR.rotation.z = -0.2;
    pauldronR.castShadow = true;
    this.group.add(pauldronR);

    // Spikes on top of each pauldron
    const spikeGeo = new THREE.ConeGeometry(0.06, 0.28, 8);
    for (let s = -1; s <= 1; s++) {
      const spL = new THREE.Mesh(spikeGeo, darkMat);
      spL.position.set(-0.65 + s * 0.1, 2.18, 0);
      spL.rotation.z = 0.2;
      this.group.add(spL);
      const spR = new THREE.Mesh(spikeGeo, darkMat);
      spR.position.set(0.65 + s * 0.1, 2.18, 0);
      spR.rotation.z = -0.2;
      this.group.add(spR);
    }

    // Red glow line on outer pauldron
    const pgL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.36), redGlowMat);
    pgL.position.set(-0.86, 1.95, 0);
    this.group.add(pgL);
    const pgR = pgL.clone();
    pgR.position.set(0.86, 1.95, 0);
    this.group.add(pgR);

    // ===== Arms (upper + forearm + gauntlet) — kept under one parent for animation =====
    const lArm = new THREE.Group();
    const lUpper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, 0.24), plateMat);
    lUpper.position.y = -0.27;
    lUpper.castShadow = true;
    lArm.add(lUpper);
    const lElbow = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), darkMat);
    lElbow.position.y = -0.55;
    lArm.add(lElbow);
    const lFore = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.4, 0.26), plateMat);
    lFore.position.y = -0.78;
    lFore.castShadow = true;
    lArm.add(lFore);
    // Gauntlet ridges
    const lFist = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.3), darkMat);
    lFist.position.y = -1.05;
    lArm.add(lFist);
    // Forearm energy line
    const lLine = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.32, 0.02), redGlowMat);
    lLine.position.set(0.14, -0.78, 0);
    lArm.add(lLine);
    lArm.position.set(-0.6, 2.05, 0);
    this.group.add(lArm);
    this.lArm = lArm;

    const rArm = new THREE.Group();
    const rUpper = lUpper.clone();
    rUpper.position.y = -0.27;
    rArm.add(rUpper);
    const rElbow = lElbow.clone();
    rElbow.position.y = -0.55;
    rArm.add(rElbow);
    const rFore = lFore.clone();
    rFore.position.y = -0.78;
    rArm.add(rFore);
    const rFist = lFist.clone();
    rFist.position.y = -1.05;
    rArm.add(rFist);
    const rLine = lLine.clone();
    rLine.position.set(-0.14, -0.78, 0);
    rArm.add(rLine);
    rArm.position.set(0.6, 2.05, 0);
    this.group.add(rArm);
    this.rArm = rArm;

    // ===== Backpack with antenna and exhaust =====
    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.28), plateMat);
    backpack.position.set(0, 1.85, -0.4);
    backpack.castShadow = true;
    this.group.add(backpack);

    // Two thrusters poking out of the bottom of the backpack (glowing nozzles)
    const thrusterGeo = new THREE.CylinderGeometry(0.07, 0.1, 0.18, 10);
    const thrusterL = new THREE.Mesh(thrusterGeo, darkMat);
    thrusterL.position.set(-0.2, 1.5, -0.45);
    this.group.add(thrusterL);
    const thrusterR = thrusterL.clone();
    thrusterR.position.set(0.2, 1.5, -0.45);
    this.group.add(thrusterR);

    const thrusterGlowGeo = new THREE.SphereGeometry(0.07, 10, 10);
    const thrusterGlowMat = new THREE.MeshBasicMaterial({
      color: 0xff5a1a,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const thrusterFL = new THREE.Mesh(thrusterGlowGeo, thrusterGlowMat.clone());
    thrusterFL.position.set(-0.2, 1.42, -0.45);
    this.group.add(thrusterFL);
    const thrusterFR = new THREE.Mesh(thrusterGlowGeo, thrusterGlowMat.clone());
    thrusterFR.position.set(0.2, 1.42, -0.45);
    this.group.add(thrusterFR);
    this.thrusterFL = thrusterFL;
    this.thrusterFR = thrusterFR;

    // Antenna with glowing beacon
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.55, 6),
      darkMat
    );
    antenna.position.set(-0.22, 2.42, -0.42);
    antenna.rotation.z = -0.18;
    this.group.add(antenna);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), beaconMat);
    beacon.position.set(-0.27, 2.7, -0.42);
    this.group.add(beacon);
    this.beacon = beacon;

    // Power cables from backpack to torso (two short curved tubes approximated as boxes)
    const cable1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.32), darkMat);
    cable1.position.set(-0.18, 1.95, -0.18);
    cable1.rotation.x = -0.5;
    this.group.add(cable1);
    const cable2 = cable1.clone();
    cable2.position.set(0.18, 1.95, -0.18);
    this.group.add(cable2);

    // ===== Plasma rifle (heavier, with glowing energy coil & under-barrel) =====
    const gun = new THREE.Group();
    const gunMain = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.22, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x10101a, roughness: 0.4, metalness: 0.85 })
    );
    gunMain.position.set(0, 0, -0.15);
    gun.add(gunMain);
    // Top rail / sight block
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.5), darkMat);
    rail.position.set(0, 0.13, -0.15);
    gun.add(rail);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), redGlowMat);
    sight.position.set(0, 0.18, -0.05);
    gun.add(sight);
    // Heavy barrel
    const gunBarrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.55, 12),
      new THREE.MeshStandardMaterial({ color: 0x05050a, roughness: 0.4, metalness: 0.95 })
    );
    gunBarrel.rotation.x = Math.PI / 2;
    gunBarrel.position.set(0, 0, -0.5);
    gun.add(gunBarrel);
    // Muzzle brake (3 fins)
    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.04), darkMat);
      fin.position.set(0, -0.06 + i * 0.06, -0.78);
      gun.add(fin);
    }
    // Energy coils wrapped around barrel (small glowing rings)
    for (let i = 0; i < 3; i++) {
      const coil = new THREE.Mesh(
        new THREE.TorusGeometry(0.075, 0.012, 6, 16),
        redGlowMat
      );
      coil.rotation.y = Math.PI / 2;
      coil.position.set(0, 0, -0.36 - i * 0.12);
      gun.add(coil);
    }
    // Magazine well
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.18), darkMat);
    mag.position.set(0, -0.2, -0.05);
    gun.add(mag);
    // Magazine glow strip
    const magGlow = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.16, 0.02),
      redGlowMat
    );
    magGlow.position.set(0.07, -0.2, 0.04);
    gun.add(magGlow);
    // Muzzle flash sprite
    const muzzleFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 10),
      new THREE.MeshBasicMaterial({
        color: 0xff7e3b,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    muzzleFlash.position.set(0, 0, -0.85);
    gun.add(muzzleFlash);
    this.muzzleFlash = muzzleFlash;
    this.muzzlePos = new THREE.Vector3();

    gun.position.set(0.6, 1.25, -0.4);
    this.group.add(gun);
    this.gun = gun;

    // ===== Legs (thigh + knee + shin + armored boot) =====
    const buildLeg = (xSign) => {
      const leg = new THREE.Group();
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.55, 0.34), plateMat);
      thigh.position.y = -0.3;
      thigh.castShadow = true;
      leg.add(thigh);
      // Thigh armor plate (front)
      const thighPlate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.04), darkMat);
      thighPlate.position.set(0, -0.32, 0.18);
      leg.add(thighPlate);
      // Knee
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), darkMat);
      knee.position.y = -0.6;
      leg.add(knee);
      // Knee glow
      const kneeGlow = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 8, 8),
        redGlowMat
      );
      kneeGlow.position.set(0, -0.6, 0.13);
      leg.add(kneeGlow);
      // Shin
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.45, 0.3), plateMat);
      shin.position.y = -0.85;
      shin.castShadow = true;
      leg.add(shin);
      // Boot
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.5), darkMat);
      boot.position.set(0, -1.13, 0.07);
      boot.castShadow = true;
      leg.add(boot);
      leg.position.set(xSign * 0.22, 1.0, 0);
      return leg;
    };
    const lLeg = buildLeg(-1);
    const rLeg = buildLeg(1);
    this.group.add(lLeg);
    this.group.add(rLeg);
    this.lLeg = lLeg;
    this.rLeg = rLeg;

    // ===== Aura: faint additive glow around silhouette =====
    const aura = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 12, 12),
      new THREE.MeshBasicMaterial({
        color: 0xff1a3a,
        transparent: true,
        opacity: 0.05,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    aura.position.y = 1.6;
    this.group.add(aura);

    // ===== Lights =====
    // Main red glow attached to chest
    const chestLight = new THREE.PointLight(0xff1a3a, 1.4, 7, 1.6);
    chestLight.position.set(0, 1.65, 0.4);
    this.group.add(chestLight);
    this.chestLight = chestLight;
    // Soft thruster glow
    const thrusterLight = new THREE.PointLight(0xff5a1a, 0.6, 3, 1.8);
    thrusterLight.position.set(0, 1.4, -0.6);
    this.group.add(thrusterLight);
    this.thrusterLight = thrusterLight;

    scene.add(this.group);
  }

  spawnAt(pos) {
    this.group.position.copy(pos);
    this.group.rotation.y = 0;
    this.hp = this.maxHp;
    this.dead = false;
    this.velocity.set(0, 0, 0);
    this.lastShot = 0;
    this.lastSawPlayer = -Infinity;
    this.sawPlayerSince = null;
    this.muzzleFlash.material.opacity = 0;
  }

  hitbox() {
    return new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(this.group.position.x, this.group.position.y + 1.3, this.group.position.z),
      new THREE.Vector3(1.3, 2.5, 0.95)
    );
  }

  takeDamage(dmg) {
    if (this.dead) return false;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
      return true;
    }
    return false;
  }

  die() {
    this.dead = true;
    audio.explode();
    // Two-stage particle burst: red core blast + amber shrapnel
    spawnExplosion(this.group.position.clone().add(new THREE.Vector3(0, 1.65, 0.3)), 0xff1a3a);
    spawnExplosion(this.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)), 0xff7e3b);
    // Hide enemy
    this.group.visible = false;
  }
}

// ---------- Player state ----------
const player = {
  hp: PLAYER_MAX_HP,
  shield: PLAYER_MAX_SHIELD,
  velocity: new THREE.Vector3(),
  onGround: true,
  mag: MAG_SIZE,
  reserve: RESERVE_AMMO,
  reloading: false,
  reloadStart: 0,
  lastFired: -Infinity,
  shotsFired: 0,
  shotsHit: 0,
  startTime: 0,
  alive: true,
  dead: false,
};

let enemy = new Enemy();

// ---------- Particles & tracers ----------
const transient = []; // {update(dt), object3D, alive}

function spawnTracer(from, to, color = 0x14f0ff) {
  const dirV = new THREE.Vector3().subVectors(to, from);
  const len = dirV.length();
  const geo = new THREE.CylinderGeometry(0.025, 0.025, len, 6, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.lookAt(to);
  mesh.rotateX(Math.PI / 2);
  scene.add(mesh);

  let t = 0;
  transient.push({
    object3D: mesh,
    alive: true,
    update(dt) {
      t += dt;
      mat.opacity = Math.max(0, 0.95 - t * 5);
      if (t > 0.18) this.alive = false;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  });
}

function spawnImpact(point, normal, color = 0xfff2a8) {
  const grp = new THREE.Group();
  grp.position.copy(point).add(normal.clone().multiplyScalar(0.02));
  // Spark sphere (additive)
  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 12, 12),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  grp.add(spark);
  // Tiny shards
  const shards = [];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 6, 6),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    const v = new THREE.Vector3(
      (Math.random() - 0.5) * 4,
      Math.random() * 4,
      (Math.random() - 0.5) * 4
    );
    s.userData.v = v;
    grp.add(s);
    shards.push(s);
  }
  scene.add(grp);

  let t = 0;
  transient.push({
    object3D: grp,
    alive: true,
    update(dt) {
      t += dt;
      spark.scale.setScalar(1 + t * 4);
      spark.material.opacity = Math.max(0, 0.9 - t * 4);
      for (const s of shards) {
        s.position.addScaledVector(s.userData.v, dt);
        s.userData.v.y -= 12 * dt;
        s.material.opacity = Math.max(0, 1 - t * 2.2);
      }
      if (t > 0.5) this.alive = false;
    },
    dispose() {
      scene.remove(grp);
      grp.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    },
  });
}

function spawnExplosion(point, color = 0xff7e3b) {
  for (let i = 0; i < 18; i++) {
    const dir = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.2,
      Math.random() - 0.5
    ).normalize().multiplyScalar(6 + Math.random() * 4);
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 10),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    s.position.copy(point);
    scene.add(s);
    let t = 0;
    transient.push({
      object3D: s,
      alive: true,
      update(dt) {
        t += dt;
        s.position.addScaledVector(dir, dt);
        dir.y -= 12 * dt;
        s.material.opacity = Math.max(0, 1 - t * 1.4);
        s.scale.setScalar(1 + t * 2);
        if (t > 0.9) this.alive = false;
      },
      dispose() {
        scene.remove(s);
        s.geometry.dispose();
        s.material.dispose();
      },
    });
  }
  // Flash light
  const light = new THREE.PointLight(color, 6, 18, 2);
  light.position.copy(point);
  scene.add(light);
  let lt = 0;
  transient.push({
    object3D: light,
    alive: true,
    update(dt) {
      lt += dt;
      light.intensity = Math.max(0, 6 - lt * 18);
      if (lt > 0.4) this.alive = false;
    },
    dispose() { scene.remove(light); },
  });
}

// ---------- Input ----------
const keys = Object.create(null);

window.addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.code === "KeyR") tryReload();
  if (e.code === "Escape") {
    // PointerLockControls handles unlocking; don't preventDefault
  }
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });

document.addEventListener("mousedown", (e) => {
  if (e.button === 0 && controls.isLocked) tryFire();
});

// Continuous fire while held
let mouseDown = false;
document.addEventListener("mousedown", (e) => { if (e.button === 0) mouseDown = true; });
document.addEventListener("mouseup", (e) => { if (e.button === 0) mouseDown = false; });

controls.addEventListener("lock", () => {
  pauseEl.classList.add("hidden");
});
controls.addEventListener("unlock", () => {
  if (gameState === "playing") {
    pauseEl.classList.remove("hidden");
  }
});

// Resume from pause on click on the pause overlay
pauseEl.addEventListener("click", () => {
  if (gameState === "playing") controls.lock();
});

// ---------- Collision helpers ----------
const tmpBox = new THREE.Box3();
const tmpV = new THREE.Vector3();

function resolvePlayerCollisions(pos) {
  // Treat the player as an AABB centered on `pos` with bottom at pos.y - PLAYER_HEIGHT
  const halfH = PLAYER_HEIGHT / 2;
  const r = PLAYER_RADIUS;
  const min = new THREE.Vector3(pos.x - r, pos.y - PLAYER_HEIGHT, pos.z - r);
  const max = new THREE.Vector3(pos.x + r, pos.y, pos.z + r);
  const playerBox = new THREE.Box3(min, max);

  for (const c of collidables) {
    if (!playerBox.intersectsBox(c.box)) continue;
    // Compute minimum-translation along x or z to push out (ignore y for simplicity—floor handles vertical)
    const overlapX1 = c.box.max.x - playerBox.min.x; // push +x
    const overlapX2 = playerBox.max.x - c.box.min.x; // push -x
    const overlapZ1 = c.box.max.z - playerBox.min.z;
    const overlapZ2 = playerBox.max.z - c.box.min.z;
    const minOverlap = Math.min(overlapX1, overlapX2, overlapZ1, overlapZ2);
    if (minOverlap === overlapX1) pos.x += overlapX1;
    else if (minOverlap === overlapX2) pos.x -= overlapX2;
    else if (minOverlap === overlapZ1) pos.z += overlapZ1;
    else pos.z -= overlapZ2;
    // Update box for chained collisions
    playerBox.min.set(pos.x - r, pos.y - PLAYER_HEIGHT, pos.z - r);
    playerBox.max.set(pos.x + r, pos.y, pos.z + r);
  }
  // Clamp to arena
  const lim = ARENA_SIZE - 1.0;
  pos.x = Math.max(-lim, Math.min(lim, pos.x));
  pos.z = Math.max(-lim, Math.min(lim, pos.z));
  return pos;
}

function resolveEnemyCollisions(pos, radius = 0.55) {
  const min = new THREE.Vector3(pos.x - radius, pos.y, pos.z - radius);
  const max = new THREE.Vector3(pos.x + radius, pos.y + 2.2, pos.z + radius);
  const eb = new THREE.Box3(min, max);
  for (const c of collidables) {
    if (!eb.intersectsBox(c.box)) continue;
    const ox1 = c.box.max.x - eb.min.x;
    const ox2 = eb.max.x - c.box.min.x;
    const oz1 = c.box.max.z - eb.min.z;
    const oz2 = eb.max.z - c.box.min.z;
    const m = Math.min(ox1, ox2, oz1, oz2);
    if (m === ox1) pos.x += ox1;
    else if (m === ox2) pos.x -= ox2;
    else if (m === oz1) pos.z += oz1;
    else pos.z -= oz2;
    eb.min.set(pos.x - radius, pos.y, pos.z - radius);
    eb.max.set(pos.x + radius, pos.y + 2.2, pos.z + radius);
  }
  const lim = ARENA_SIZE - 1.5;
  pos.x = Math.max(-lim, Math.min(lim, pos.x));
  pos.z = Math.max(-lim, Math.min(lim, pos.z));
  return pos;
}

// Line-of-sight: returns true if a clear segment exists between two points (no wall in the way)
const losRay = new THREE.Raycaster();
function hasLineOfSight(from, to) {
  const dirV = new THREE.Vector3().subVectors(to, from);
  const dist = dirV.length();
  losRay.set(from, dirV.normalize());
  losRay.far = dist - 0.3;
  const hits = losRay.intersectObjects(collidables.map((c) => c.mesh), false);
  return hits.length === 0;
}

// ---------- Shooting ----------
function tryFire() {
  if (!player.alive) return;
  if (player.reloading) return;
  if (player.mag <= 0) {
    tryReload();
    return;
  }
  const now = performance.now() / 1000;
  if (now - player.lastFired < FIRE_INTERVAL) return;
  player.lastFired = now;
  player.mag -= 1;
  player.shotsFired += 1;
  audio.shoot();

  // Muzzle flash
  weapon.flashMat.opacity = 1;
  weapon.muzzleFlashT = 0.06;
  weapon.group.position.z += 0.03;
  weapon.group.rotation.x -= 0.04;

  // Aim direction with slight spread
  const dirV = new THREE.Vector3();
  camera.getWorldDirection(dirV);
  dirV.x += (Math.random() - 0.5) * WEAPON_SPREAD * 60;
  dirV.y += (Math.random() - 0.5) * WEAPON_SPREAD * 60;
  dirV.normalize();

  const origin = camera.getWorldPosition(new THREE.Vector3());
  const ray = new THREE.Raycaster(origin, dirV, 0.1, WEAPON_RANGE);

  // Prefer to test enemy hitbox first via box ray
  let hitEnemy = false;
  let endPoint = origin.clone().addScaledVector(dirV, WEAPON_RANGE);
  let hitNormal = new THREE.Vector3(0, 0, 1);
  let hitColor = 0xfff2a8;

  if (!enemy.dead) {
    const hb = enemy.hitbox();
    const hitPt = new THREE.Vector3();
    if (ray.ray.intersectBox(hb, hitPt)) {
      // Make sure no wall is between us and the enemy
      const distToEnemy = hitPt.distanceTo(origin);
      const wallCheck = new THREE.Raycaster(origin, dirV, 0.1, distToEnemy - 0.05);
      const wallHits = wallCheck.intersectObjects(collidables.map((c) => c.mesh), false);
      if (wallHits.length === 0) {
        endPoint = hitPt;
        hitEnemy = true;
        hitNormal = new THREE.Vector3().subVectors(origin, hitPt).normalize();
        hitColor = 0xff2bd6;
        const killed = enemy.takeDamage(WEAPON_DAMAGE);
        player.shotsHit += 1;
        showHitMarker();
        audio.hit();
        if (killed) {
          addKillRow(`<span class="me">YOU</span> eliminated <span class="them">${"SENTINEL-X"}</span>`);
          setTimeout(() => endGame(true), 600);
        }
      }
    }
  }

  if (!hitEnemy) {
    const wallHits = ray.intersectObjects(collidables.map((c) => c.mesh), false);
    if (wallHits.length > 0) {
      endPoint = wallHits[0].point;
      hitNormal = wallHits[0].face.normal.clone().transformDirection(wallHits[0].object.matrixWorld);
    }
  }

  // Tracer from gun muzzle to endPoint
  const muzzleWorld = new THREE.Vector3();
  weapon.group.getWorldPosition(muzzleWorld);
  // Convert weapon-scene local to world: weapon-scene is rendered with weaponCamera, but the visual
  // tracer should originate near the player camera roughly. We'll use the player camera origin offset.
  const tracerOrigin = origin.clone().add(dirV.clone().multiplyScalar(0.5));
  spawnTracer(tracerOrigin, endPoint, 0x14f0ff);
  spawnImpact(endPoint, hitNormal, hitColor);

  updateHUDAmmo();
}

function tryReload() {
  if (player.reloading) return;
  if (player.mag === MAG_SIZE) return;
  if (player.reserve <= 0) return;
  player.reloading = true;
  player.reloadStart = performance.now() / 1000;
  reloadHint.classList.remove("hidden");
  audio.reload();
}

function finishReload() {
  const need = MAG_SIZE - player.mag;
  const give = Math.min(need, player.reserve);
  player.mag += give;
  player.reserve -= give;
  player.reloading = false;
  reloadHint.classList.add("hidden");
  updateHUDAmmo();
}

function showHitMarker() {
  hitMarker.classList.add("show");
  clearTimeout(showHitMarker._t);
  showHitMarker._t = setTimeout(() => hitMarker.classList.remove("show"), 120);
}

function showDamageVignette() {
  damageVignette.classList.add("show");
  clearTimeout(showDamageVignette._t);
  showDamageVignette._t = setTimeout(() => damageVignette.classList.remove("show"), 220);
}

function addKillRow(html) {
  const row = document.createElement("div");
  row.className = "kill-row";
  row.innerHTML = html;
  killFeed.prepend(row);
  setTimeout(() => row.remove(), 4500);
}

// ---------- AI ----------
function updateEnemy(dt, now) {
  if (enemy.dead) return;

  const eyePos = new THREE.Vector3(
    enemy.group.position.x,
    enemy.group.position.y + 1.95,
    enemy.group.position.z
  );
  const playerPos = controls.getObject().position.clone();
  const playerEye = playerPos.clone();
  playerEye.y -= 0.2;

  const seesPlayer = hasLineOfSight(eyePos, playerEye);
  if (seesPlayer) {
    if (enemy.sawPlayerSince === null) enemy.sawPlayerSince = now;
    enemy.lastSawPlayer = now;
  } else {
    enemy.sawPlayerSince = null;
  }

  const toPlayer = new THREE.Vector3().subVectors(playerPos, enemy.group.position);
  toPlayer.y = 0;
  const distToPlayer = toPlayer.length();
  const dirToPlayer = toPlayer.clone().normalize();

  // Always face the player when in sight, otherwise face movement
  if (seesPlayer || (now - enemy.lastSawPlayer) < 2) {
    const yaw = Math.atan2(dirToPlayer.x, dirToPlayer.z);
    enemy.group.rotation.y = THREE.MathUtils.lerp(
      enemy.group.rotation.y,
      yaw,
      Math.min(1, dt * 8)
    );
  }

  // Pick movement target
  let desiredMove = new THREE.Vector3();
  const preferredDist = 14;

  if (seesPlayer) {
    // Strafe & maintain distance
    enemy.strafeT -= dt;
    if (enemy.strafeT <= 0) {
      enemy.strafeT = 1.2 + Math.random() * 1.5;
      enemy.strafeDir = Math.random() < 0.5 ? -1 : 1;
    }
    if (distToPlayer > preferredDist + 2) {
      desiredMove.add(dirToPlayer);
    } else if (distToPlayer < preferredDist - 4) {
      desiredMove.add(dirToPlayer.clone().multiplyScalar(-1));
    }
    // Strafe perpendicular to player direction
    const perp = new THREE.Vector3(-dirToPlayer.z, 0, dirToPlayer.x).multiplyScalar(enemy.strafeDir);
    desiredMove.add(perp.multiplyScalar(0.85));
  } else {
    // Wander toward last-known position or random points
    if (now > enemy.targetReachT || enemy.group.position.distanceTo(enemy.wanderTarget) < 1.2) {
      enemy.targetReachT = now + 4 + Math.random() * 3;
      const r = ARENA_SIZE - 6;
      enemy.wanderTarget.set(
        (Math.random() - 0.5) * 2 * r,
        0,
        (Math.random() - 0.5) * 2 * r
      );
    }
    const d = new THREE.Vector3().subVectors(enemy.wanderTarget, enemy.group.position);
    d.y = 0;
    if (d.lengthSq() > 0.01) desiredMove.add(d.normalize());
  }

  if (desiredMove.lengthSq() > 0) desiredMove.normalize();
  const speed = seesPlayer ? 5.5 : 3.6;
  enemy.velocity.x = desiredMove.x * speed;
  enemy.velocity.z = desiredMove.z * speed;

  // Apply movement with collision
  const newPos = enemy.group.position.clone();
  newPos.x += enemy.velocity.x * dt;
  newPos.z += enemy.velocity.z * dt;
  resolveEnemyCollisions(newPos);
  enemy.group.position.copy(newPos);

  // Leg & arm bob (legs swing alternately, off-hand counter-swings)
  const moving = (Math.abs(enemy.velocity.x) + Math.abs(enemy.velocity.z)) > 0.5;
  if (moving) {
    const bob = Math.sin(now * 8) * 0.45;
    enemy.lLeg.rotation.x = bob;
    enemy.rLeg.rotation.x = -bob;
    enemy.lArm.rotation.x = -bob * 0.8;
    enemy.rArm.rotation.x = bob * 0.4;
  } else {
    enemy.lLeg.rotation.x *= 0.85;
    enemy.rLeg.rotation.x *= 0.85;
    enemy.lArm.rotation.x *= 0.85;
    enemy.rArm.rotation.x *= 0.85;
  }

  // ---- Idle / "alive" pulses ----
  // Reactor core breathes; eyes flicker brighter when player is in sight
  const seePulse = (seesPlayer ? 1.6 : 1.0);
  const corePulse = 0.85 + Math.sin(now * 4.5) * 0.2;
  enemy.core.scale.setScalar(corePulse);
  enemy.core.material.color.setRGB(1.0, 0.32 * (2 - corePulse), 0.12 * (2 - corePulse));
  enemy.halo.scale.setScalar(1.0 + Math.sin(now * 4.5) * 0.15);
  enemy.halo.material.opacity = 0.35 + Math.sin(now * 4.5) * 0.18;
  // Eyes: stay red, but get brighter and slightly bigger when player is visible
  const eyeScale = 1.0 + Math.sin(now * 6) * 0.08 * seePulse;
  enemy.eyeL.scale.setScalar(eyeScale * (seesPlayer ? 1.25 : 1));
  enemy.eyeR.scale.setScalar(eyeScale * (seesPlayer ? 1.25 : 1));
  // Antenna beacon strobes
  const beaconOn = (Math.sin(now * 3) > 0.6) ? 1 : 0.25;
  enemy.beacon.material.color.setRGB(1, 0.5 * beaconOn, 0.2 * beaconOn);
  // Thrusters flare when moving
  const flare = moving ? 0.85 + Math.random() * 0.15 : 0.35 + Math.sin(now * 12) * 0.1;
  enemy.thrusterFL.material.opacity = flare;
  enemy.thrusterFR.material.opacity = flare;
  enemy.thrusterFL.scale.setScalar(0.8 + flare * 0.6);
  enemy.thrusterFR.scale.setScalar(0.8 + flare * 0.6);
  enemy.thrusterLight.intensity = moving ? 1.2 : 0.5;
  // Chest light pulses with core
  enemy.chestLight.intensity = 1.1 + Math.sin(now * 4.5) * 0.4 + (seesPlayer ? 0.4 : 0);

  // Aim error refresh
  enemy.aimErrorT -= dt;
  if (enemy.aimErrorT <= 0) {
    enemy.aimErrorT = 0.25 + Math.random() * 0.2;
    const err = currentDifficulty.aimErr;
    enemy.aimError.set(
      (Math.random() - 0.5) * err,
      (Math.random() - 0.5) * err,
      (Math.random() - 0.5) * err
    );
  }

  // Shooting
  if (
    seesPlayer &&
    enemy.sawPlayerSince !== null &&
    (now - enemy.sawPlayerSince) >= currentDifficulty.reactT &&
    (now - enemy.lastShot) >= currentDifficulty.fireRate
  ) {
    enemy.lastShot = now;
    enemyShoot(playerEye);
  }

  // Muzzle flash decay
  if (enemy.muzzleFlash.material.opacity > 0) {
    enemy.muzzleFlash.material.opacity = Math.max(0, enemy.muzzleFlash.material.opacity - dt * 8);
  }
}

function enemyShoot(targetEye) {
  audio.enemyShoot();
  enemy.muzzleFlash.material.opacity = 1;

  const muzzle = new THREE.Vector3();
  enemy.gun.getWorldPosition(muzzle);
  // Aim with error
  const aimAt = targetEye.clone().add(enemy.aimError);
  const dirV = new THREE.Vector3().subVectors(aimAt, muzzle).normalize();

  // Trace tracer; check walls
  const ray = new THREE.Raycaster(muzzle, dirV, 0.1, 100);
  const wallHits = ray.intersectObjects(collidables.map((c) => c.mesh), false);
  let endPoint = muzzle.clone().addScaledVector(dirV, 100);
  let hitPlayer = false;
  if (wallHits.length > 0) {
    endPoint = wallHits[0].point;
  }

  // Player hit test: small sphere at player eye
  const playerPos = controls.getObject().position;
  const sphere = new THREE.Sphere(playerPos.clone().add(new THREE.Vector3(0, -0.3, 0)), 0.55);
  const ix = new THREE.Vector3();
  if (ray.ray.intersectSphere(sphere, ix)) {
    const distToHit = ix.distanceTo(muzzle);
    const distToWall = wallHits.length > 0 ? wallHits[0].distance : Infinity;
    if (distToHit < distToWall) {
      hitPlayer = true;
      endPoint = ix;
    }
  }

  spawnTracer(muzzle, endPoint, 0xff2bd6);
  if (hitPlayer) {
    damagePlayer(currentDifficulty.dmg);
  } else if (wallHits.length > 0) {
    const n = wallHits[0].face.normal.clone().transformDirection(wallHits[0].object.matrixWorld);
    spawnImpact(endPoint, n, 0xff7e3b);
  }
}

function damagePlayer(amount) {
  if (!player.alive) return;
  audio.hurt();
  showDamageVignette();
  // Camera shake
  shakeAmount = Math.min(shakeAmount + 0.06, 0.18);

  if (player.shield > 0) {
    const absorbed = Math.min(player.shield, amount);
    player.shield -= absorbed;
    amount -= absorbed;
  }
  if (amount > 0) {
    player.hp -= amount;
  }
  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
    addKillRow(`<span class="them">SENTINEL-X</span> eliminated <span class="me">YOU</span>`);
    setTimeout(() => endGame(false), 600);
  }
  updateHUDHealth();
}

// ---------- HUD ----------
function updateHUDHealth() {
  const hp = Math.max(0, player.hp);
  healthBar.style.width = `${(hp / PLAYER_MAX_HP) * 100}%`;
  healthText.textContent = String(Math.round(hp));
  shieldBar.style.width = `${(player.shield / PLAYER_MAX_SHIELD) * 100}%`;
  shieldText.textContent = String(Math.round(player.shield));
  playerBar.style.width = `${(hp / PLAYER_MAX_HP) * 100}%`;
  enemyBar.style.width = `${Math.max(0, enemy.hp) / enemy.maxHp * 100}%`;
}

function updateHUDAmmo() {
  ammoMag.textContent = String(player.mag);
  ammoReserve.textContent = String(player.reserve);
}

// ---------- Camera shake ----------
let shakeAmount = 0;
function applyShake(dt) {
  if (shakeAmount <= 0) return;
  const obj = controls.getObject();
  obj.position.x += (Math.random() - 0.5) * shakeAmount;
  obj.position.y += (Math.random() - 0.5) * shakeAmount * 0.5;
  obj.position.z += (Math.random() - 0.5) * shakeAmount;
  shakeAmount = Math.max(0, shakeAmount - dt * 0.6);
}

// ---------- Game state ----------
let gameState = "menu"; // 'menu' | 'playing' | 'ended'
let currentDifficulty = DIFFICULTY.normal;

function setDifficulty(name) {
  currentDifficulty = DIFFICULTY[name];
  diffBtns.forEach((b) =>
    b.classList.toggle("active", b.dataset.diff === name)
  );
}

function resetPlayer() {
  player.hp = PLAYER_MAX_HP;
  player.shield = PLAYER_MAX_SHIELD;
  player.velocity.set(0, 0, 0);
  player.mag = MAG_SIZE;
  player.reserve = RESERVE_AMMO;
  player.reloading = false;
  player.lastFired = -Infinity;
  player.shotsFired = 0;
  player.shotsHit = 0;
  player.alive = true;
  player.dead = false;
  controls.getObject().position.set(-ARENA_SIZE + 6, PLAYER_HEIGHT, -ARENA_SIZE + 6);
  camera.rotation.set(0, 0, 0);
}

function resetEnemy() {
  enemy.maxHp = currentDifficulty.hp;
  enemy.spawnAt(new THREE.Vector3(ARENA_SIZE - 6, 0, ARENA_SIZE - 6));
  enemy.group.visible = true;
}

function startGame() {
  resetPlayer();
  resetEnemy();
  gameState = "playing";
  player.startTime = performance.now() / 1000;

  menuEl.classList.add("hidden");
  endEl.classList.add("hidden");
  pauseEl.classList.add("hidden");
  hudEl.classList.remove("hidden");
  updateHUDHealth();
  updateHUDAmmo();
  controls.lock();
}

function endGame(victory) {
  if (gameState === "ended") return;
  gameState = "ended";
  controls.unlock();
  pauseEl.classList.add("hidden");

  const elapsed = performance.now() / 1000 - player.startTime;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(Math.floor(elapsed % 60)).padStart(2, "0");
  endTime.textContent = `${mm}:${ss}`;
  endShots.textContent = String(player.shotsFired);
  endAcc.textContent = `${player.shotsFired === 0 ? 0 : Math.round((player.shotsHit / player.shotsFired) * 100)}%`;

  const card = endEl.querySelector(".end-card");
  card.classList.remove("victory", "defeat");
  if (victory) {
    card.classList.add("victory");
    endTitle.textContent = "VICTORY";
    endSub.textContent = "You eliminated the Sentinel.";
    audio.victory();
  } else {
    card.classList.add("defeat");
    endTitle.textContent = "DEFEAT";
    endSub.textContent = "The Sentinel got you. Try again?";
  }

  endEl.classList.remove("hidden");
}

function returnToMenu() {
  gameState = "menu";
  controls.unlock();
  hudEl.classList.add("hidden");
  endEl.classList.add("hidden");
  pauseEl.classList.add("hidden");
  menuEl.classList.remove("hidden");
}

// ---------- Build the world once ----------
buildArena();

// ---------- UI wiring ----------
diffBtns.forEach((b) => b.addEventListener("click", () => setDifficulty(b.dataset.diff)));
startBtn.addEventListener("click", () => startGame());
restartBtn.addEventListener("click", () => startGame());
menuBtn.addEventListener("click", () => returnToMenu());
howBtn.addEventListener("click", () => howPanel.classList.toggle("hidden"));

// Hide loading once Three is ready
loadingEl.classList.add("hidden");

// ---------- Main loop ----------
let last = performance.now() / 1000;

function update(dt, now) {
  if (gameState !== "playing") return;
  if (!player.alive) return;

  // Reload progression
  if (player.reloading && (now - player.reloadStart) >= RELOAD_TIME) {
    finishReload();
  }

  // Continuous fire
  if (mouseDown && controls.isLocked) tryFire();

  // Movement
  const obj = controls.getObject();
  const speed = (keys["ShiftLeft"] || keys["ShiftRight"] ? SPRINT_MULT : 1) * WALK_SPEED;

  // Build movement vector in camera-aligned space
  const forward = new THREE.Vector3();
  controls.getDirection(forward);
  forward.y = 0;
  forward.normalize();
  // right = forward × up   (forward (0,0,-1) × up (0,1,0) = (1,0,0) = +X)
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));

  const wish = new THREE.Vector3();
  if (keys["KeyW"] || keys["ArrowUp"]) wish.add(forward);
  if (keys["KeyS"] || keys["ArrowDown"]) wish.add(forward.clone().negate());
  if (keys["KeyA"] || keys["ArrowLeft"]) wish.add(right.clone().negate());
  if (keys["KeyD"] || keys["ArrowRight"]) wish.add(right);
  if (wish.lengthSq() > 0) wish.normalize();

  // Accel/Friction (horizontal)
  const targetVx = wish.x * speed;
  const targetVz = wish.z * speed;
  player.velocity.x += (targetVx - player.velocity.x) * Math.min(1, dt * (wish.lengthSq() > 0 ? ACCEL / speed : FRICTION));
  player.velocity.z += (targetVz - player.velocity.z) * Math.min(1, dt * (wish.lengthSq() > 0 ? ACCEL / speed : FRICTION));

  // Jump / gravity
  if (player.onGround && (keys["Space"])) {
    player.velocity.y = JUMP_VELOCITY;
    player.onGround = false;
  }
  player.velocity.y -= GRAVITY * dt;

  // Integrate
  const newPos = obj.position.clone();
  newPos.x += player.velocity.x * dt;
  newPos.z += player.velocity.z * dt;
  newPos.y += player.velocity.y * dt;

  // Floor at y = PLAYER_HEIGHT (eye level)
  if (newPos.y < PLAYER_HEIGHT) {
    newPos.y = PLAYER_HEIGHT;
    player.velocity.y = 0;
    player.onGround = true;
  } else {
    player.onGround = false;
  }

  resolvePlayerCollisions(newPos);
  obj.position.copy(newPos);

  // Camera shake
  applyShake(dt);

  // Weapon recoil recovery
  if (weapon.muzzleFlashT > 0) {
    weapon.muzzleFlashT -= dt;
    if (weapon.muzzleFlashT <= 0) weapon.flashMat.opacity = 0;
    else weapon.flashMat.opacity = Math.min(1, weapon.muzzleFlashT * 10);
  }
  weapon.group.position.lerp(new THREE.Vector3(0.22, -0.22, -0.5), Math.min(1, dt * 12));
  weapon.group.rotation.x += (0 - weapon.group.rotation.x) * Math.min(1, dt * 12);

  // Slight weapon bob while moving
  const moving = Math.abs(player.velocity.x) + Math.abs(player.velocity.z) > 0.5;
  if (moving) {
    const t = now * (keys["ShiftLeft"] ? 14 : 9);
    weapon.group.position.x += Math.sin(t) * 0.005;
    weapon.group.position.y += Math.abs(Math.sin(t)) * 0.004;
  }

  // Reload weapon visual: tilt down
  if (player.reloading) {
    const r = (now - player.reloadStart) / RELOAD_TIME;
    weapon.group.rotation.x = -Math.sin(r * Math.PI) * 0.7;
    weapon.group.position.y = -0.22 - Math.sin(r * Math.PI) * 0.15;
  }

  // Enemy AI
  updateEnemy(dt, now);

  // Transients
  for (const t of transient) t.update(dt);
  for (let i = transient.length - 1; i >= 0; i--) {
    if (!transient[i].alive) {
      transient[i].dispose();
      transient.splice(i, 1);
    }
  }

  // Shield slow regen (only when not recently hurt)
  if (player.shield < PLAYER_MAX_SHIELD) {
    player.shield = Math.min(PLAYER_MAX_SHIELD, player.shield + dt * 4);
  }

  updateHUDHealth();
}

function render() {
  // Render world
  renderer.autoClear = true;
  renderer.render(scene, camera);
  // Render weapon on top, without clearing color buffer
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(weaponScene, weaponCamera);
  renderer.autoClear = true;
}

function loop() {
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, now - last);
  last = now;
  update(dt, now);
  render();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// ---------- Initial spawn so something is visible behind the menu ----------
controls.getObject().position.set(-ARENA_SIZE + 6, PLAYER_HEIGHT, -ARENA_SIZE + 6);
camera.lookAt(0, PLAYER_HEIGHT, 0);
enemy.spawnAt(new THREE.Vector3(ARENA_SIZE - 6, 0, ARENA_SIZE - 6));
updateHUDHealth();
updateHUDAmmo();
