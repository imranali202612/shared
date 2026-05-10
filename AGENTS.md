# AGENTS.md — Project Memory for `shared` (FPS Game)

> Persistent context for any AI agent working on this repo. Read this first before
> editing `fps-game/`. Updated 2026-05-11.

---

## 1. What this project is

A single-page browser game: **NEON ARENA**, a 1v1 third-person/FPS hybrid built
with **Three.js (r160)** loaded from CDN via `<script type="importmap">`. No
build step, no bundler, no `package.json`. Pure HTML + CSS + ES modules.

```
shared/
├── README.md               ← short user-facing description
├── AGENTS.md               ← this file (AI memory)
└── fps-game/
    ├── index.html          ← HUD DOM, menu/end overlays, importmap, <canvas>
    ├── styles.css          ← all UI styling (cyberpunk neon look)
    └── game.js             ← ALL game logic in one file (~2300 lines)
```

Everything in the game lives in those three files. **Do not split `game.js`
into modules** unless explicitly requested — the single-file design is
intentional for simplicity (no build chain).

---

## 2. How to run / preview

A local HTTP server is normally already running on **port 8765** rooted at
`/home/ubuntu/a/shared/`. Serve URL: `http://localhost:8765/fps-game/`.

If it's not running:

```bash
cd /home/ubuntu/a/shared
python3 -m http.server 8765 --bind 127.0.0.1
```

**Important**: A previous attempt accidentally rooted the server at
`/tmp/shared/fps-game/`, which silently served a stale copy. Always check
`readlink /proc/<pid>/cwd` of the http server pid if edits don't appear in the
browser. Always serve from `/home/ubuntu/a/shared/`.

After edits, tell the user to hard-reload (`Ctrl+Shift+R`) to bypass any cached
`game.js`.

---

## 3. Validation workflow (no test suite)

There are no unit tests. Validate edits with:

```bash
node --check /home/ubuntu/a/shared/fps-game/game.js   # JS syntax
```

…and the `ReadLints` tool on the three game files. There's no Playwright MCP
available in this environment, so don't try to drive the page programmatically.

---

## 4. Architecture overview

### Two Three.js scenes, one renderer

- `scene` + `camera` (PerspectiveCamera, FOV 78) — the actual arena, with fog,
  shadows, lighting.
- `weaponScene` + `weaponCamera` (PerspectiveCamera, FOV 60) — the first-person
  weapon rig, rendered **on top** in a second `renderer.render()` pass with
  `renderer.autoClear = false` between passes. No fog. Has its own lights.

### `update(dt, now)` loop ordering matters

Inside `function update(dt, now)`:

1. **Transient particles update FIRST** — before any `gameState !== "playing"`
   or `!player.alive` early-returns. This is why tracers/explosions from a
   lethal shot still play out smoothly during the post-death transition. Don't
   move this loop back to the bottom.
2. Then `gameState !== "playing"` early-return.
3. **ADS smooth transition** — runs even when dead/reloading so the scope
   cleanly retracts.
4. Then `!player.alive` early-return.
5. Reload progression, continuous fire, movement, collisions, enemy AI, HUD
   updates.

### HUD is DOM/CSS/SVG, not 3D

All HUD elements live inside `<div id="hud">` in `index.html` and are styled
in `styles.css`. The `#hud` div has `pointer-events: none` so clicks pass
through to the canvas. Each frame, helper functions in `game.js` push values
into the DOM:

| Helper                          | What it updates                               |
|---------------------------------|-----------------------------------------------|
| `updateHUDHealth()`             | HP/shield bars, low-HP pulse                  |
| `updateHUDAmmo()`               | Ammo numbers, low-ammo color shift            |
| `updateReloadRing(now)`         | SVG `stroke-dashoffset` for reload progress   |
| `drawMinimap()`                 | Top-down `<canvas>` radar                     |
| `updateEnemyArrowAndDistance()` | Off-screen arrow rotation, distance/LOS text  |
| `spawnDamageNumber(p, v, opts)` | Floating world→screen-projected damage numbers|
| `showDamageDirection(from)`     | Directional red wedge flash                   |
| `showHitMarker()`               | Center X-flash on enemy hit                   |

When extending the HUD: prefer DOM/SVG over Three.js sprites — text is much
sharper and easier to style.

---

## 5. Game design constants (current values)

```js
WEAPON_DAMAGE = 14         // crits = 1.6× when hitting near chest core (y ≈ enemy.y + 1.65)
WEAPON_RANGE = 60
WEAPON_SPREAD = 0.0035     // multiplied by (1 - 0.95 * adsT) when scoped
PLAYER_MAX_HP = 100
PLAYER_MAX_SHIELD = 50
WALK_SPEED = 6.5, SPRINT_MULT = 1.7
FIRE_INTERVAL = 0.11, RELOAD_TIME = 1.4, MAG_SIZE = 12, RESERVE_AMMO = 60
ARENA_SIZE = 60, WALL_HEIGHT = 8
```

### Difficulty presets — currently **bumped harder** than original

```js
DIFFICULTY = {
  easy:   { aimErr: 0.05,  fireRate: 0.85, dmg: 12, reactT: 0.45, hp: 130, speed: 1.0  },
  normal: { aimErr: 0.025, fireRate: 0.50, dmg: 18, reactT: 0.22, hp: 180, speed: 1.15 },
  hard:   { aimErr: 0.012, fireRate: 0.32, dmg: 26, reactT: 0.10, hp: 240, speed: 1.35 },
}
```

`speed` was added later — it multiplies the enemy's base movement speed
(`(seesPlayer ? 5.8 : 3.8) * currentDifficulty.speed`). Don't drop the `speed`
field; older code paths already depend on it.

---

## 6. Lighting (brightened — do not darken)

The user complained the game was too dark. Current settings are deliberately
bright; **reducing them will likely re-introduce the complaint**.

- `renderer.toneMappingExposure = 1.55` (was 1.0)
- `scene.background = 0x131a2c` (was 0x05070d)
- `scene.fog = new THREE.Fog(0x1d2848, 70, 220)` (was `0x0a0e1c, 25, 90`) —
  **fog distance was the single biggest cause** of the dark look.
- Ambient 1.1, hemisphere 1.6, directional 1.8, fill light 0.7
- Corner point lights: intensity 3.2, range 130, decay 1.0 (linear)
- Center spot 3.0, plus 2 mid-arena overhead point lights
- Wall/pillar/crate base colors lifted (`0x3a4670`, `0x44567c`, `0x4c5f87`)
- Floor canvas grid is now lighter (`#1c2540` base, `#5aeaff` lines @ 0.32α)

If asked to darken, **keep fog far** (don't pull it back inside the arena
radius of 60) and prefer reducing exposure over killing lights.

---

## 7. Aim-down-sights / scope system

The scope is the trickiest UX subsystem. Read this before touching it.

### Two independent input sources, OR'd together each frame

```js
player.adsHold   // RMB held (live mouse-button state)
player.adsToggle // Q toggle (sticky on/off)
player.ads       // computed: adsHold || adsToggle
player.adsT      // 0..1 smoothed transition (lerpRate 14)
```

Both inputs exist because **mouse-button chord conflicts** are real:
some mice/trackpads don't fire LMB-mousedown while RMB is held. Q-toggle
works around this entirely.

### `ADS` constants

```js
const ADS = {
  baseFov: 78, zoomFov: 36,    // ~2.17× zoom
  spreadMult: 0.05,            // near-perfect accuracy when scoped
  speedMult: 0.55,             // walk slower while scoped (no sprint)
  pointerMult: 0.45,           // finer mouse aim while scoped
  lerpRate: 14, showThreshold: 0.6,
};
```

### Per-frame ADS effects (in `update()`)

- Lerp `camera.fov` between `baseFov` and `zoomFov`, then `updateProjectionMatrix()`.
- Scale `controls.pointerSpeed` (PointerLockControls 0.155+).
- When `adsT > showThreshold` (0.6): `weapon.group.visible = false`,
  `#scope-overlay.show`, `#hud.scoped` (which hides `#crosshair`).
- Spread multiplier `1 - (1 - ADS.spreadMult) * adsT` is applied in `tryFire`.
- Speed multiplier `1 - (1 - ADS.speedMult) * adsT` applied to walk speed,
  sprint disabled when `adsT >= 0.2`.

### Cleanup on `endGame()`

Snap all ADS state back to defaults: `adsHold/adsToggle/ads = false`,
`adsT = 0`, `mouseDown = false`, restore FOV and pointerSpeed, show weapon,
remove overlay/scoped classes. The end-screen and menu must render at the
default FOV.

### Scope mesh on the gun

Built inside `buildWeaponRig()`: rail, two ring mounts, tube, eyepiece,
objective bell, **glowing front lens** (`MeshBasicMaterial`, additive blending,
`lens.rotation.y = Math.PI` so the lit face points -Z), and a turret. Visible
during hipfire only; whole `weapon.group` is hidden when fully scoped.

---

## 8. Input handling — read carefully

### Fire keys

```js
const FIRE_KEYS = new Set(["KeyF", "KeyE"]);   // tap = single shot, hold = continuous fire
```

`tryFire()` is called from:
1. Edge-detect inside `syncMouseButtons` (LMB rising).
2. The `keydown` handler for any key in `FIRE_KEYS` (with `e.repeat` filter).
3. Continuous-fire path in `update()`: `if ((mouseDown || any FIRE_KEYS held) && controls.isLocked) tryFire()`.

To add another fire key, **just add it to the `FIRE_KEYS` set** — no other
changes needed.

### Mouse buttons via `e.buttons` bitmask (chord-resilient)

```js
function syncMouseButtons(e) {
  const lmb = (e.buttons & 1) === 1;
  const rmb = (e.buttons & 2) === 2;
  if (lmb && !mouseDown && controls.isLocked && player.alive) tryFire();
  mouseDown = lmb;
  player.adsHold = rmb && controls.isLocked && player.alive;
}
document.addEventListener("mousedown", syncMouseButtons, { capture: true });
document.addEventListener("mouseup",   syncMouseButtons, { capture: true });
document.addEventListener("mousemove", syncMouseButtons, { capture: true });
```

**Why bitmask, not button-by-button**: `e.buttons` reflects every currently-held
button. In pointer-locked FPS, `mousemove` fires constantly (~120 Hz), so even
if a `mousedown`/`mouseup` is dropped (window blur, focus change, hardware
chord conflict), the very next mousemove resyncs us. Don't go back to the old
per-event tracking.

### Other key bindings

| Key             | Action                                           |
|-----------------|--------------------------------------------------|
| `WASD` / arrows | Move                                             |
| `Shift`         | Sprint (auto-disabled when `adsT >= 0.2`)        |
| `Space`         | Jump                                             |
| `R`             | Reload                                           |
| `Q`             | Toggle ADS (auto-cancels on reload)              |
| `E` / `F`       | Fire (work while scoped, no chord needed)        |
| `Esc`           | Release pointer-lock (handled by Three.js)       |
| `LMB`           | Fire                                             |
| `RMB` (hold)    | Aim down sights (combined with Q toggle)         |

`contextmenu` is `preventDefault`'d so RMB doesn't pop the browser menu.

### Auto-repeat filter

The `keydown` handler does `if (e.repeat) return;` so the OS key-repeat doesn't
spam fires — the per-frame continuous-fire path handles holds at the proper
`FIRE_INTERVAL` cadence.

---

## 9. Coding conventions

- **Single-file `game.js`** — keep it that way unless asked.
- **No comments narrating obvious code.** Only comment non-obvious intent
  (e.g., why transients run before early returns, why `e.buttons`, why the
  scope auto-cancels on reload).
- **Three.js naming**: groups end in `.group`, materials in `Mat`, geometries
  inline. Match the existing style.
- **Procedural everything** — textures, audio (Web Audio API), geometry. No
  external assets (no images, no audio files, no model files).
- **No emojis** unless the user explicitly asks.
- **CSS variables** in `styles.css` define the palette: `--neon-cyan`,
  `--neon-pink`, `--neon-red`, `--neon-green`, `--neon-purple`, `--muted`,
  `--hud-pad`. Use them instead of hard-coding colors.
- **`pointer-events: none`** on every HUD element so the canvas keeps
  receiving clicks. New HUD pieces must not violate this.

---

## 10. Git / secrets

- This repo is `imranali202612/shared` on GitHub. The `gh` CLI is authenticated
  as a different user (`sajidm2014`); pushes use a custom credential helper at
  `~/.config/git/credential-helper-bashrc.sh` that reads `GH_TOKEN` from
  `~/.bashrc`.
- **Never echo `$GH_TOKEN` to a terminal** — terminal output is captured in
  `terminals/*.txt` and would leak the token. If a token leak happens: scrub
  `~/.bash_history` and the relevant `terminals/<id>.txt`, tell the user to
  rotate the token immediately.
- Don't commit unless explicitly asked. Don't `git push --force`. Don't update
  git config.

---

## 11. Common pitfalls / gotchas

- **Stale server**: see §2. Always confirm the http.server cwd is the real
  source folder before debugging "my edit isn't showing up".
- **Don't redeclare `hudEl`** — it's already defined near the top of `game.js`
  with the other DOM refs.
- **Fog clipping the arena**: if you set fog `near` < `ARENA_SIZE`, the
  far walls disappear into haze and the user calls the game "too dark" again.
- **`weapon.group.visible = false`** while scoped means the muzzle flash
  doesn't render — the player still hears `audio.shoot()` and tracers/impacts
  still spawn from the camera. This is intentional (scope view replaces the
  gun view).
- **Crit detection** in `tryFire()` uses `Math.abs(hitPt.y - (enemy.group.position.y + 1.65)) < 0.35`.
  If you redesign the enemy, update that magic number to match the new chest-core Y.

---

## 12. Out-of-scope / explicit non-goals

- No multiplayer, no networking, no backend.
- No build system, no TypeScript, no bundler.
- No external models/textures/audio.
- No mobile/touch controls (pointer-lock + WASD only).
