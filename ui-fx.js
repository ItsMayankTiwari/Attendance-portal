/* ==========================================================================
   ui-fx.js — Pure CSS/JS interactions (3D card tilt & scroll reveals)
   ========================================================================== */

(function() {
  const isDesktop = window.matchMedia("(pointer: fine)").matches;

  // 1. Desktop 3D Hover Tilt (Cards Only)
  // Safely skips mobile devices to prevent touch glitches
  function applyTilt(card) {
    if (!isDesktop || card.dataset.tiltInit || !card.classList.contains('bento-card')) return;
    card.dataset.tiltInit = 'true';
    card.style.transformStyle = 'preserve-3d';

    card.addEventListener('mousemove', (e) => {
      card.style.transition = 'transform 0.1s ease, box-shadow 0.25s ease';
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;

      const tiltX = -y * 8; // Max 8 deg
      const tiltY = x * 8;  // Max 8 deg

      card.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale3d(1.02, 1.02, 1.02)`;

      const px = ((e.clientX - rect.left) / rect.width) * 100;
      const py = ((e.clientY - rect.top) / rect.height) * 100;
      card.style.backgroundImage = `radial-gradient(ellipse 120% 80% at ${px}% ${py}%, rgba(124,58,237,0.12) 0%, transparent 50%)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transition = 'transform 0.4s ease, box-shadow 0.4s ease'; // Smooth spring back
      card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
      card.style.backgroundImage = `radial-gradient(ellipse 120% 80% at 0% 0%, rgba(124,58,237,0.07) 0%, transparent 60%)`;
    });
  }

  // 2. Universal 3D Scroll Reveal (Mobile & Desktop)
  // Triggers flip-up animations as items scroll into view
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        // Slight delay based on DOM order for staggered flip effect
        const siblings = Array.from(entry.target.parentNode.children);
        const index = siblings.indexOf(entry.target);
        const delay = (index % 10) * 60; // 60ms delay per item

        setTimeout(() => {
          entry.target.classList.add('is-visible');
        }, delay);

        revealObserver.unobserve(entry.target); // Only animate once per load
      }
    });
  }, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });

  function processElements() {
    document.querySelectorAll('.bento-card, .ledger-row').forEach(el => {
      applyTilt(el);

      if (!el.dataset.revealInit) {
        el.dataset.revealInit = 'true';
        el.classList.add('reveal-3d');
        revealObserver.observe(el);
      }
    });
  }

  // Initial application
  processElements();

  // Watch the DOM for dynamically added elements (like new courses or records)
  const domObserver = new MutationObserver((mutations) => {
    if (mutations.some(m => m.addedNodes.length > 0)) {
      // Let the browser paint first, then hook up animations
      requestAnimationFrame(processElements);
    }
  });

  const shell = document.getElementById('shell');
  if (shell) {
    domObserver.observe(shell, { childList: true, subtree: true });
  }

})();
