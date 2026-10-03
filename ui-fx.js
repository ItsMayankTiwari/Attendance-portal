/* ==========================================================================
   ui-fx.js — Pure CSS/JS interactions (3D card tilt)
   Constraints: Only runs on devices with a mouse/trackpad to avoid
   mobile battery drain and touch glitches.
   ========================================================================== */

(function() {
  // Only apply on fine-pointer devices (laptops/desktops)
  if (!window.matchMedia("(pointer: fine)").matches) return;

  function applyTiltToCards() {
    const cards = document.querySelectorAll('.bento-card');

    cards.forEach(card => {
      // Prevent multiple listener attachments if called repeatedly
      if (card.dataset.tiltInit) return;
      card.dataset.tiltInit = 'true';

      // Ensure the card can be transformed properly
      card.style.transformStyle = 'preserve-3d';
      card.style.transition = 'transform 0.1s ease, box-shadow 0.25s ease';

      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();

        // Calculate mouse position relative to card center (-1 to 1)
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;

        // Multiply by max rotation degrees
        const tiltX = -y * 8; // Max 8 deg
        const tiltY = x * 8;  // Max 8 deg

        card.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale3d(1.01, 1.01, 1.01)`;

        // Optional: adjust the gradient to follow mouse for specular highligh
        const px = ((e.clientX - rect.left) / rect.width) * 100;
        const py = ((e.clientY - rect.top) / rect.height) * 100;
        card.style.backgroundImage = `radial-gradient(ellipse 120% 80% at ${px}% ${py}%, rgba(124,58,237,0.12) 0%, transparent 50%)`;
      });

      card.addEventListener('mouseleave', () => {
        card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
        // Reset gradien
        card.style.backgroundImage = `radial-gradient(ellipse 120% 80% at 0% 0%, rgba(124,58,237,0.07) 0%, transparent 60%)`;
      });
    });
  }

  // Initial application
  applyTiltToCards();

  // Re-apply when DOM changes (e.g. after JS renders new course lists)
  const observer = new MutationObserver((mutations) => {
    let shouldUpdate = false;
    for (let m of mutations) {
      if (m.addedNodes.length) shouldUpdate = true;
    }
    if (shouldUpdate) applyTiltToCards();
  });

  const shell = document.getElementById('shell');
  if (shell) {
    observer.observe(shell, { childList: true, subtree: true });
  }

})();
