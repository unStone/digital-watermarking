(function () {
  'use strict';

  const { $, toast, mountTopbar } = UI;

  const ACTION_LABEL = {
    'c2pa.created': '创建',
    'c2pa.opened': '打开已有文件',
    'c2pa.edited': '编辑',
    'c2pa.color_adjustments': '调色',
    'c2pa.cropped': '裁剪',
    'c2pa.resized': '缩放',
    'c2pa.filtered': '加滤镜',
    'c2pa.placed': '置入素材',
    'c2pa.published': '发布',
    'c2pa.converted': '格式转换',
    'c2pa.drawing': '绘制',
  };

  const RELATION_LABEL = { parentOf: '父级素材', componentOf: '组成部分', inputTo: '作为输入' };

  const objectUrls = [];

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /** 解码结果里混着 Uint8Array，转成十六进制才好看 */
  function readable(value) {
    if (value instanceof Uint8Array) {
      const hex = Array.from(value.subarray(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('');
      return '<' + value.length + ' 字节 ' + hex + (value.length > 16 ? '…' : '') + '>';
    }
    if (Array.isArray(value)) return value.map(readable);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach((k) => { out[k] = readable(value[k]); });
      return out;
    }
    return value;
  }

  function sourceTypeNote(list) {
    if (!list.length) return '清单里没有写来源类型';
    return list.map((t) => {
      const short = String(t).split('/').pop();
      const map = {
        trainedAlgorithmicMedia: '模型直接生成',
        compositeWithTrainedAlgorithmicMedia: '含模型生成成分的合成',
        algorithmicMedia: '算法生成（非训练模型）',
        digitalCapture: '相机直接拍摄',
        computationalCapture: '计算摄影',
      };
      return short + (map[short] ? '（' + map[short] + '）' : '');
    }).join('、');
  }

  function renderStats(report) {
    const fmt = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP', svg: 'SVG', bmff: 'MP4 / BMFF' }[report.format] || '未知';
    const kb = (report.bytes / 1024).toFixed(1) + ' KB';
    $('#stats').innerHTML = [
      '<div class="stat"><div class="k">容器格式</div><div class="v">' + fmt + '</div></div>',
      '<div class="stat"><div class="k">文件大小</div><div class="v">' + kb + '</div></div>',
      '<div class="stat ' + (report.hasManifest ? '' : 'stat--ok') + '"><div class="k">内容凭证</div><div class="v">' +
        (report.hasManifest ? report.manifests.length + ' 份清单' : '未发现') + '</div></div>',
      '<div class="stat ' + (report.aiGenerated ? 'stat--ai' : '') + '"><div class="k">AI 生成声明</div><div class="v">' +
        (report.aiGenerated ? '是' : (report.hasManifest ? '未声明' : '无从判断')) + '</div></div>',
    ].join('');
  }

  function renderManifest(m, index, total) {
    const s = m.summary;
    const rows = [
      ['清单标识', m.label],
      ['生成工具', s.generator || '（未写）'],
      ['标题', s.title || '（未写）'],
      ['媒体格式', s.format || '—'],
      ['来源类型', sourceTypeNote(s.sourceTypes)],
      ['作者', s.authors.length ? s.authors.join('、') : '（未写）'],
      ['摘要算法', s.alg || '—'],
      ['数字签名', m.hasSignature ? '存在（' + (m.signatureSize || 0) + ' 字节 COSE，本页不做验签）' : '缺失'],
    ];

    let html = '<div class="card"><h2 style="margin-top:0">清单 ' + (index + 1) + ' / ' + total +
      (index === total - 1 ? ' <span class="badge badge--accent">活动清单</span>' : '') + '</h2>' +
      '<dl class="kv">' + rows.map(([k, v]) =>
        '<dt>' + k + '</dt><dd>' + escapeHtml(v) + '</dd>').join('') + '</dl>';

    if (s.thumbnail) {
      const blob = new Blob([s.thumbnail.bytes], { type: s.thumbnail.mime });
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);
      html += '<h3>清单自带缩略图</h3>' +
        '<p class="muted" style="margin-top:0">签名时的画面快照。和当前文件对不上，说明像素被改过。</p>' +
        '<img class="thumb" src="' + url + '" alt="清单缩略图">';
    }

    if (s.actions.length) {
      html += '<h3>动作链</h3><ul class="timeline">' + s.actions.map((a) =>
        '<li><div class="act">' + escapeHtml(a.action) +
        (ACTION_LABEL[a.action] ? ' <span class="muted">' + ACTION_LABEL[a.action] + '</span>' : '') + '</div>' +
        (a.softwareAgent ? '<div class="meta">工具：' + escapeHtml(a.softwareAgent) + '</div>' : '') +
        (a.digitalSourceType ? '<div class="meta">来源类型：' + escapeHtml(String(a.digitalSourceType).split('/').pop()) + '</div>' : '') +
        '</li>').join('') + '</ul>';
    }

    if (s.ingredients.length) {
      html += '<h3>素材来源</h3><ul class="timeline">' + s.ingredients.map((i) =>
        '<li><div class="act">' + escapeHtml(i.title) + '</div>' +
        '<div class="meta">' + escapeHtml(i.format) + ' · ' +
        (RELATION_LABEL[i.relationship] || i.relationship) + '</div></li>').join('') + '</ul>';
    }

    html += '<h3>全部断言（' + m.assertions.length + '）</h3><div class="table-scroll"><table>' +
      '<thead><tr><th>标签</th><th>类型</th><th>大小</th></tr></thead><tbody>' +
      m.assertions.map((a) => '<tr><td><code>' + escapeHtml(a.label) + '</code></td><td>' +
        a.kind + '</td><td>' + a.size + ' B</td></tr>').join('') +
      '</tbody></table></div>';

    const decoded = m.assertions.filter((a) => a.data);
    if (decoded.length) {
      html += '<details class="raw"><summary>展开断言原文（已解码 CBOR / JSON）</summary><pre>' +
        escapeHtml(JSON.stringify(
          decoded.reduce((acc, a) => { acc[a.label] = readable(a.data); return acc; }, {}), null, 2)) +
        '</pre></details>';
    }
    if (m.claim) {
      html += '<details class="raw"><summary>展开 claim 原文</summary><pre>' +
        escapeHtml(JSON.stringify(readable(m.claim), null, 2)) + '</pre></details>';
    }
    return html + '</div>';
  }

  function renderXMP(xmp) {
    if (!xmp) return '';
    const rows = [
      ['digitalSourceType', xmp.digitalSourceType],
      ['CreatorTool', xmp.creatorTool],
      ['provenance', xmp.provenance],
    ].filter(([, v]) => v);
    if (!rows.length) return '';
    return '<div class="card"><h2 style="margin-top:0">XMP 元数据</h2>' +
      '<p class="muted" style="margin-top:0">有些工具不写完整的 C2PA 清单，只在 XMP 里留一行来源类型。</p>' +
      '<dl class="kv">' + rows.map(([k, v]) =>
        '<dt>' + k + '</dt><dd>' + escapeHtml(v) + '</dd>').join('') + '</dl></div>';
  }

  function render(report, filename) {
    objectUrls.splice(0).forEach(URL.revokeObjectURL);
    $('#result').hidden = false;
    renderStats(report);

    let html = '';
    if (report.error) {
      html += '<div class="note">' + escapeHtml(report.error) + '</div>';
    }
    if (report.hasManifest) {
      html += '<p class="muted">清单来源：' + escapeHtml(report.source) + '</p>';
      html += report.manifests.map((m, i) => renderManifest(m, i, report.manifests.length)).join('');
    } else {
      html += '<div class="card"><h2 style="margin-top:0">没有找到内容凭证</h2>' +
        '<p style="margin-bottom:0">这只能说明<strong>这个文件里没有凭证</strong>，不能说明它不是 AI 生成的——' +
        '截图、另存、平台压缩都会把凭证清掉，而像素水印和文字水印仍然可能还在。' +
        '文本内容可以去 <a href="../ai-text/">AI 文本痕迹检测</a> 再看一遍。</p></div>';
    }
    html += renderXMP(report.xmp);
    $('#body').innerHTML = html;
    $('#hint').textContent = filename + ' · ' + (report.hasManifest ? '已读出内容凭证' : '未发现内容凭证');
  }

  async function handleFile(file) {
    if (!file) return;
    if (file.size > 80 * 1024 * 1024) return toast('文件太大了（上限 80MB）');
    $('#hint').textContent = '正在解析 ' + file.name + '…';
    try {
      const report = C2PA.inspect(await file.arrayBuffer());
      render(report, file.name);
    } catch (err) {
      $('#hint').textContent = '解析失败：' + err.message;
      toast('解析失败：' + err.message);
    }
  }

  window.addEventListener('DOMContentLoaded', function () {
    mountTopbar('c2pa/');

    $('#file').onchange = function () { handleFile(this.files[0]); };

    const FIXTURES = 'https://raw.githubusercontent.com/contentauth/c2pa-rs/main/sdk/tests/fixtures/';
    async function loadSample(name) {
      $('#hint').textContent = '正在从 GitHub 拉取 ' + name + '…';
      try {
        const res = await fetch(FIXTURES + name);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        handleFile(new File([await res.blob()], name, { type: 'image/jpeg' }));
      } catch (err) {
        $('#hint').textContent = '示例拉取失败：' + err.message;
      }
    }
    $('#sample-ai').onclick = function () { loadSample('C.jpg'); };
    $('#sample-edit').onclick = function () { loadSample('CA.jpg'); };

    const drop = $('#drop');
    ['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => {
      ev.preventDefault();
      drop.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => {
      ev.preventDefault();
      drop.classList.remove('over');
    }));
    drop.addEventListener('drop', (ev) => {
      const file = ev.dataTransfer && ev.dataTransfer.files[0];
      if (file) handleFile(file);
    });
  });
})();
