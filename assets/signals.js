/* 首页动画只在进入视口且页面可见时运行，避免后台持续绘制。 */
(function () {
  'use strict';

  const scenes = Array.from(document.querySelectorAll('.hero-visual, .atlas-visual'));
  if (!scenes.length) return;

  function syncVisibility() {
    document.documentElement.classList.toggle('motion-page-hidden', document.hidden);
  }

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          entry.target.classList.toggle('motion-paused', !entry.isIntersecting);
        }
      },
      { rootMargin: '120px 0px' },
    );
    scenes.forEach((scene) => observer.observe(scene));
  }

  document.addEventListener('visibilitychange', syncVisibility);
  syncVisibility();
})();
