/* ==========================================================================
   auth-bg.js — Neural network particle mesh for login/auth screens
   Three.js WebGL canvas, pointer-events: none, behind all content.

   Performance constraints:
   - Max 60 particles (mobile-safe)
   - Connection lines only drawn when distance < threshold
   - Frame rate capped at 30 fps via manual throttle
   - Canvas auto-destroyed when auth screen hides
   - Graceful fallback: if THREE is missing, does nothing
   ========================================================================== */

(function () {
  'use strict';

  if (typeof THREE === 'undefined') return;

  // ---- Configuration ----
  const PARTICLE_COUNT = 55;
  const CONNECTION_DISTANCE = 120;
  const PARTICLE_SPEED = 0.15;
  const SPREAD = 300;
  const FPS_CAP = 30;
  const FRAME_INTERVAL = 1000 / FPS_CAP;

  // Palette from Phase 2
  const VIOLET       = new THREE.Color(0x7c3aed);
  const VIOLET_DIM   = new THREE.Color(0x4c1d95);
  const EMERALD      = new THREE.Color(0x10b981);
  const LINE_OPACITY = 0.18;

  // ---- Find target container ----
  const container = document.getElementById('auth-bg-canvas');
  if (!container) return;

  // ---- Renderer ----
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  // ---- Scene + Camera ----
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 1000);
  camera.position.z = 350;

  // ---- Particles ----
  const positions = [];
  const velocities = [];
  const colors = [];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    positions.push(
      (Math.random() - 0.5) * SPREAD * 2,
      (Math.random() - 0.5) * SPREAD * 2,
      (Math.random() - 0.5) * SPREAD * 0.6
    );
    velocities.push(
      (Math.random() - 0.5) * PARTICLE_SPEED,
      (Math.random() - 0.5) * PARTICLE_SPEED,
      (Math.random() - 0.5) * PARTICLE_SPEED * 0.3
    );
    // Mix between violet and emerald
    const mix = Math.random();
    const c = mix < 0.7
      ? VIOLET.clone().lerp(VIOLET_DIM, Math.random())
      : EMERALD.clone();
    colors.push(c.r, c.g, c.b);
  }

  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  particleGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const particleMaterial = new THREE.PointsMaterial({
    size: 3,
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(points);

  // ---- Connection lines ----
  const MAX_CONNECTIONS = PARTICLE_COUNT * 3; // budget for line segments
  const linePositions = new Float32Array(MAX_CONNECTIONS * 6);
  const lineColors = new Float32Array(MAX_CONNECTIONS * 6);
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
  lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
  lineGeometry.setDrawRange(0, 0);

  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: LINE_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const lineSegments = new THREE.LineSegments(lineGeometry, lineMaterial);
  scene.add(lineSegments);

  // ---- Mouse interaction (subtle attraction) ----
  let mouseX = 0, mouseY = 0;
  document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
  }, { passive: true });

  // ---- Resize ----
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  // ---- Animation loop (capped at 30fps) ----
  let lastFrame = 0;
  let animId = null;
  let destroyed = false;

  function animate(now) {
    if (destroyed) return;
    animId = requestAnimationFrame(animate);

    if (now - lastFrame < FRAME_INTERVAL) return;
    lastFrame = now;

    const posArr = particleGeometry.attributes.position.array;

    // Move particles
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      posArr[i3]     += velocities[i3];
      posArr[i3 + 1] += velocities[i3 + 1];
      posArr[i3 + 2] += velocities[i3 + 2];

      // Bounce off bounds
      if (Math.abs(posArr[i3])     > SPREAD) velocities[i3]     *= -1;
      if (Math.abs(posArr[i3 + 1]) > SPREAD) velocities[i3 + 1] *= -1;
      if (Math.abs(posArr[i3 + 2]) > SPREAD * 0.3) velocities[i3 + 2] *= -1;
    }
    particleGeometry.attributes.position.needsUpdate = true;

    // Build connection lines
    let lineIndex = 0;
    const lp = lineGeometry.attributes.position.array;
    const lc = lineGeometry.attributes.color.array;

    for (let i = 0; i < PARTICLE_COUNT && lineIndex < MAX_CONNECTIONS; i++) {
      for (let j = i + 1; j < PARTICLE_COUNT && lineIndex < MAX_CONNECTIONS; j++) {
        const i3 = i * 3, j3 = j * 3;
        const dx = posArr[i3]     - posArr[j3];
        const dy = posArr[i3 + 1] - posArr[j3 + 1];
        const dz = posArr[i3 + 2] - posArr[j3 + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < CONNECTION_DISTANCE) {
          const li = lineIndex * 6;
          lp[li]     = posArr[i3];
          lp[li + 1] = posArr[i3 + 1];
          lp[li + 2] = posArr[i3 + 2];
          lp[li + 3] = posArr[j3];
          lp[li + 4] = posArr[j3 + 1];
          lp[li + 5] = posArr[j3 + 2];

          const alpha = 1 - dist / CONNECTION_DISTANCE;
          lc[li]     = VIOLET.r * alpha;
          lc[li + 1] = VIOLET.g * alpha;
          lc[li + 2] = VIOLET.b * alpha;
          lc[li + 3] = VIOLET.r * alpha;
          lc[li + 4] = VIOLET.g * alpha;
          lc[li + 5] = VIOLET.b * alpha;

          lineIndex++;
        }
      }
    }
    lineGeometry.setDrawRange(0, lineIndex * 2);
    lineGeometry.attributes.position.needsUpdate = true;
    lineGeometry.attributes.color.needsUpdate = true;

    // Subtle camera drift following mouse
    camera.position.x += (mouseX * 30 - camera.position.x) * 0.02;
    camera.position.y += (mouseY * 20 - camera.position.y) * 0.02;

    // Very slow auto-rotation
    points.rotation.y += 0.0003;
    lineSegments.rotation.y += 0.0003;

    renderer.render(scene, camera);
  }

  // ---- Visibility management ----
  // Only run when an auth screen is visible
  function isAuthVisible() {
    const auth = document.getElementById('screen-auth');
    const setup = document.getElementById('screen-setup');
    const loading = document.getElementById('screen-loading');
    return (
      (auth && auth.classList.contains('is-active')) ||
      (setup && setup.classList.contains('is-active')) ||
      (loading && loading.classList.contains('is-active'))
    );
  }

  function startIfVisible() {
    if (isAuthVisible() && !animId && !destroyed) {
      container.style.display = 'block';
      animId = requestAnimationFrame(animate);
    }
  }

  function stopIfHidden() {
    if (!isAuthVisible()) {
      if (animId) { cancelAnimationFrame(animId); animId = null; }
      container.style.display = 'none';
    }
  }

  // Poll visibility (the show() function in attendance.js doesn't dispatch events)
  const visCheck = setInterval(() => {
    if (isAuthVisible()) startIfVisible();
    else stopIfHidden();

    // If shell is visible, we can fully destroy to free GPU memory
    const shell = document.getElementById('shell');
    if (shell && !shell.classList.contains('hidden')) {
      destroy();
    }
  }, 500);

  function destroy() {
    destroyed = true;
    clearInterval(visCheck);
    if (animId) cancelAnimationFrame(animId);
    particleGeometry.dispose();
    particleMaterial.dispose();
    lineGeometry.dispose();
    lineMaterial.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.remove();
  }

  // Start immediately
  startIfVisible();
})();
