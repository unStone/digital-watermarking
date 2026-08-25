/* 全站共用的极简 UI 工具，无依赖 */
(function (global) {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  let toastTimer = null;
  function toast(message) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  /** 复制到剪贴板，失败时回退到 execCommand */
  async function copy(text, okMessage) {
    if (!text) return toast('没有可复制的内容');
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) return toast('复制失败，请手动选中');
    }
    toast(okMessage || '已复制');
  }

  /**
   * 把 canvas 存成图片，默认 PNG。
   * 只有明水印那类「烧进像素」的场景才可以传 image/jpeg，
   * LSB 系的水印必须无损，一压就没。
   */
  function downloadCanvas(canvas, filename, options) {
    const type = (options && options.type) || 'image/png';
    const quality = options && options.quality;
    canvas.toBlob((blob) => {
      if (!blob) return toast('导出失败');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'watermarked.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, type, quality);
  }

  global.UI = { $, $$, toast, copy, downloadCanvas };
})(window);
