(function () {
  'use strict';

  const { $, toast, copy } = UI;
  const I = Invisible;

  const SCHEME_LABEL = { zerowidth: '零宽字符', vs: '变体选择符', tag: 'Unicode Tag' };

  function embed() {
    const carrier = $('#carrier').value;
    const payload = $('#payload').value;
    const scheme = $('#scheme').value;
    const mode = $('#mode').value;
    const out = $('#output');
    const stat = $('#embed-stat');

    try {
      const result = I.embed(carrier, payload, scheme, mode);
      out.value = result;
      const added = Array.from(result).length - Array.from(I.strip(carrier)).length;
      stat.textContent = '插入 ' + added + ' 个不可见字符，可见内容零变化';
      stat.style.color = '';
    } catch (err) {
      out.value = '';
      stat.textContent = err.message;
      stat.style.color = 'var(--danger)';
    }
  }

  function decode() {
    const text = $('#marked').value;
    const box = $('#decode-result');
    if (!text) {
      box.innerHTML = '等待输入。';
      return;
    }
    const report = I.scan(text);
    const hits = [
      ['zerowidth', report.hidden.zerowidth],
      ['vs', report.hidden.vs],
      ['tag', report.hidden.tag],
    ].filter(([, v]) => v && /\S/.test(v)).map(([k, v]) => [k, I.verify(v)]);

    if (!hits.length) {
      box.innerHTML = report.invisibleCount
        ? '发现 ' + report.invisibleCount + ' 个不可见字符，但解不出可读载荷（可能用了别的编码）。' +
          '<a href="../ai-text/">去检测器看明细 →</a>'
        : '没有检测到隐藏内容。';
      return;
    }
    box.innerHTML = hits.map(([k, r]) =>
      '<div style="margin-bottom:8px"><span class="badge badge--accent">' + SCHEME_LABEL[k] + '</span> ' +
      '<code>' + r.payload.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</code> ' +
      (r.verified
        ? '<span class="muted">· 校验通过</span>'
        : '<span class="muted">· 未通过校验，内容可能被改动过，或来自旧版本 / 别的工具</span>') +
      '</div>'
    ).join('');
  }

  window.addEventListener('DOMContentLoaded', function () {

    $('#btn-embed').onclick = embed;
    $('#btn-copy').onclick = function () { copy($('#output').value, '带水印文本已复制'); };
    ['#carrier', '#payload'].forEach((s) => { $(s).oninput = embed; });
    ['#scheme', '#mode'].forEach((s) => { $(s).onchange = embed; });

    $('#marked').oninput = decode;
    $('#btn-strip').onclick = function () {
      const cleaned = I.strip($('#marked').value);
      if (!cleaned) return toast('提取框里还没有内容');
      $('#marked').value = cleaned;
      decode();
      copy(cleaned, '已清洗并复制');
    };

    embed();
  });
})();
