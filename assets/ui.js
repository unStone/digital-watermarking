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

  /** 把 canvas 存成 PNG（LSB 水印必须无损，切勿导出 JPEG） */
  function downloadCanvas(canvas, filename) {
    canvas.toBlob((blob) => {
      if (!blob) return toast('导出失败');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'watermarked.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }

  /**
   * 顶部导航。页面里已经写成静态 HTML 了（Googlebot 首轮抓取就要能看到链接），
   * 这里只在没有静态导航时兜底渲染一次。
   */
  function mountTopbar(current) {
    const root = document.querySelector('[data-topbar]');
    if (!root || root.children.length) return;
    const base = root.getAttribute('data-topbar') || './';
    const links = [
      ['c2pa/', '内容凭证'],
      ['ai-text/', 'AI 文本检测'],
      ['text/', '文本水印'],
      ['according/', '图片水印'],
      ['fft/', '频域水印'],
    ];
    root.className = 'topbar';
    root.innerHTML =
      '<a class="brand" href="' + base + '">数字水印实验室</a>' +
      '<span class="spacer"></span>' +
      '<nav>' +
      links
        .map(([href, label]) =>
          href === current
            ? '<a href="' + base + 'pages/' + href + '" style="color:var(--accent)">' + label + '</a>'
            : '<a href="' + base + 'pages/' + href + '">' + label + '</a>'
        )
        .join('') +
      '</nav>';
  }

  global.UI = { $, $$, toast, copy, downloadCanvas, mountTopbar };
})(window);
