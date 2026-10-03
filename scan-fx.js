/* ==========================================================================
   scan-fx.js — Swirling 3D particle ring for biometric wait state
   Highly optimized for mobile phones (30fps cap, low particle count)
   ========================================================================== */

(function () {
  'use strict';

  if (typeof THREE === 'undefined') return;

  const PARTICLE_COUNT = 45;
  const RADIUS = 80;
  const FPS_CAP = 30;
  const FRAME_INTERVAL = 1000 / FPS_CAP;

  const VIOLET = new THREE.Color(0x7c3aed);
  const EMERALD = new THREE.Color(0x10b981);

  const container = document.getElementById('scan-fx-canvas');
  if (!container) return;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Mobile optimization
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 500);
  camera.position.z = 250;

  // Create ring particles
  const positions = [];
  const colors = [];
  const phases = []; // To animate individual particles

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
    // Base position (circle)
    positions.push(
      Math.cos(angle) * RADIUS,
      Math.sin(angle) * RADIUS,
      (Math.random() - 0.5) * 20
    );

    // Mix colors
    const mix = Math.random();
    const c = mix < 0.5 ? VIOLET : EMERALD;
    colors.push(c.r, c.g, c.b);

    phases.push(Math.random() * Math.PI * 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  // Save original positions to animate around them
  geometry.setAttribute('basePosition', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('phase', new THREE.Float32BufferAttribute(phases, 1));

  // Load a simple circular sprite for soft glowing particles
  const canvas = document.createElement('canvas');
  canvas.width = 16; canvas.height = 16;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 16, 16);
  const texture = new THREE.CanvasTexture(canvas);

  const material = new THREE.PointsMaterial({
    size: 14,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    map: texture,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  // Tilt the ring for 3D perspective
  points.rotation.x = Math.PI * 0.3;
  scene.add(points);

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize, { passive: true });
  // Wait a tick for layouts to settle
  setTimeout(resize, 100);

  let lastFrame = 0;
  let animId = null;
  let time = 0;

  function animate(now) {
    animId = requestAnimationFrame(animate);

    if (now - lastFrame < FRAME_INTERVAL) return;
    lastFrame = now;
    time += 0.05;

    points.rotation.z += 0.02; // Rotate whole ring

    // Wobble individual particles
    const posArr = geometry.attributes.position.array;
    const baseArr = geometry.attributes.basePosition.array;
    const phaseArr = geometry.attributes.phase.array;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      const p = phaseArr[i] + time;

      // Slight inward/outward breathing
      const offset = Math.sin(p * 2) * 8;

      // Normalize base vector for outward movemen
      const len = Math.sqrt(baseArr[i3]**2 + baseArr[i3+1]**2);
      const nx = baseArr[i3] / len;
      const ny = baseArr[i3+1] / len;

      posArr[i3] = baseArr[i3] + nx * offset;
      posArr[i3+1] = baseArr[i3+1] + ny * offset;
      posArr[i3+2] = baseArr[i3+2] + Math.cos(p) * 15; // Z wobble
    }
    geometry.attributes.position.needsUpdate = true;

    renderer.render(scene, camera);
  }

  // Manage lifecycle based on DOM state
  function isTargetVisible() {
    const state = document.getElementById('scan-verify-state');
    return state && !state.classList.contains('hidden');
  }

  setInterval(() => {
    const visible = isTargetVisible();
    if (visible && !animId) {
      container.style.display = 'block';
      resize(); // Ensure size is correct when shown
      animId = requestAnimationFrame(animate);
    } else if (!visible && animId) {
      cancelAnimationFrame(animId);
      animId = null;
      container.style.display = 'none';
    }
  }, 200);

})();
