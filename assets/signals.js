/* 首页动画只在进入视口且页面可见时运行，避免后台持续绘制。 */
(function () {
  'use strict';

  const fields = Array.from(document.querySelectorAll('.atlas-visual'));
  if (!fields.length) return;

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
    fields.forEach((field) => observer.observe(field));
  }

  document.addEventListener('visibilitychange', syncVisibility);
  syncVisibility();
})();
