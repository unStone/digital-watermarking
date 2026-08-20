/* ============================================================
   c2pa.js · 内容凭证（C2PA Content Credentials）读取器
   纯 JS 解析：容器提取 → JUMBF 盒子树 → CBOR 声明
   只做「读取与展示」，不做证书链验签
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------
   * 极简 CBOR 解码器（RFC 8949 子集，够解 C2PA 用）
   * ------------------------------------------------------- */
  function decodeCBOR(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 0;

    function u8() { return view.getUint8(pos++); }
    function readLength(info) {
      if (info < 24) return info;
      if (info === 24) return u8();
      if (info === 25) { const v = view.getUint16(pos); pos += 2; return v; }
      if (info === 26) { const v = view.getUint32(pos); pos += 4; return v; }
      if (info === 27) { const v = Number(view.getBigUint64(pos)); pos += 8; return v; }
      if (info === 31) return -1; // 不定长
      throw new Error('CBOR: 不支持的长度编码 ' + info);
    }

    function item() {
      const first = u8();
      const major = first >> 5;
      const info = first & 0x1f;

      switch (major) {
        case 0: return readLength(info);
        case 1: return -1 - readLength(info);
        case 2: {
          const len = readLength(info);
          if (len < 0) {           // 不定长字节串
            const parts = [];
            while (view.getUint8(pos) !== 0xff) parts.push(item());
            pos++;
            const total = parts.reduce((n, p) => n + p.length, 0);
            const out = new Uint8Array(total);
            let o = 0;
            parts.forEach((p) => { out.set(p, o); o += p.length; });
            return out;
          }
          const out = bytes.subarray(pos, pos + len);
          pos += len;
          return out;
        }
        case 3: {
          const len = readLength(info);
          if (len < 0) {
            let s = '';
            while (view.getUint8(pos) !== 0xff) s += item();
            pos++;
            return s;
          }
          const s = new TextDecoder('utf-8', { fatal: false })
            .decode(bytes.subarray(pos, pos + len));
          pos += len;
          return s;
        }
        case 4: {
          const len = readLength(info);
          const arr = [];
          if (len < 0) {
            while (view.getUint8(pos) !== 0xff) arr.push(item());
            pos++;
          } else {
            for (let i = 0; i < len; i++) arr.push(item());
          }
          return arr;
        }
        case 5: {
          const len = readLength(info);
          const map = {};
          const push = () => { const k = item(); map[typeof k === 'string' ? k : JSON.stringify(k)] = item(); };
          if (len < 0) {
            while (view.getUint8(pos) !== 0xff) push();
            pos++;
          } else {
            for (let i = 0; i < len; i++) push();
          }
          return map;
        }
        case 6: {
          readLength(info);        // tag 号对展示没意义，跳过
          return item();
        }
        case 7: {
          if (info === 20) return false;
          if (info === 21) return true;
          if (info === 22) return null;
          if (info === 23) return undefined;
          if (info === 25) { const v = getFloat16(view, pos); pos += 2; return v; }
          if (info === 26) { const v = view.getFloat32(pos); pos += 4; return v; }
          if (info === 27) { const v = view.getFloat64(pos); pos += 8; return v; }
          return null;
        }
        default: throw new Error('CBOR: 未知主类型 ' + major);
      }
    }

    return item();
  }

  function getFloat16(view, offset) {
    const raw = view.getUint16(offset);
    const sign = raw & 0x8000 ? -1 : 1;
    const exp = (raw >> 10) & 0x1f;
    const frac = raw & 0x3ff;
    if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
    if (exp === 31) return frac ? NaN : sign * Infinity;
    return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
  }

  /* ---------------------------------------------------------
   * JUMBF 盒子树（ISO/IEC 19566-5）
   * 盒子 = 4 字节长度 + 4 字节类型 + 内容
   * ------------------------------------------------------- */
  const TEXT = new TextDecoder('utf-8', { fatal: false });

  function fourCC(bytes, at) {
    return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  }

  function parseBoxes(bytes, start, end, depth) {
    const boxes = [];
    let pos = start;
    while (pos + 8 <= end && boxes.length < 4096) {
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      let size = view.getUint32(pos);
      const type = fourCC(bytes, pos + 4);
      let header = 8;
      if (size === 1) {                       // 64 位长度
        size = Number(view.getBigUint64(pos + 8));
        header = 16;
      } else if (size === 0) {
        size = end - pos;                     // 一直到末尾
      }
      if (size < header || pos + size > end) break;

      const box = { type, start: pos, end: pos + size, contentStart: pos + header };
      if (type === 'jumb' && depth < 8) {
        box.children = parseBoxes(bytes, box.contentStart, box.end, depth + 1);
        const desc = box.children.find((c) => c.type === 'jumd');
        if (desc) Object.assign(box, desc.description);
      } else if (type === 'jumd') {
        box.description = parseDescription(bytes, box.contentStart, box.end);
        Object.assign(box, box.description);
      }
      boxes.push(box);
      pos += size;
    }
    return boxes;
  }

  /** jumd 描述盒：16 字节 UUID + 1 字节 toggles + 可选 label */
  function parseDescription(bytes, start, end) {
    if (start + 17 > end) return {};
    const uuid = Array.from(bytes.subarray(start, start + 16))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    const toggles = bytes[start + 16];
    let pos = start + 17;
    let label = '';
    if (toggles & 0x02) {                     // 带标签
      const from = pos;
      while (pos < end && bytes[pos] !== 0) pos++;
      label = TEXT.decode(bytes.subarray(from, pos));
      pos++;
    }
    return { uuid, toggles, label, contentType: uuid.slice(0, 8) };
  }

  /* ---------------------------------------------------------
   * 从各种容器里抠出 manifest store
   * ------------------------------------------------------- */
  function findJumbfFallback(bytes) {
    // 兜底：直接搜 "jumb" + "jumd" + "c2pa" 这个特征串
    for (let i = 0; i + 32 < bytes.length; i++) {
      if (bytes[i] === 0x6a && bytes[i + 1] === 0x75 && bytes[i + 2] === 0x6d && bytes[i + 3] === 0x62 &&
          bytes[i + 8] === 0x6a && bytes[i + 9] === 0x75 && bytes[i + 10] === 0x6d && bytes[i + 11] === 0x64) {
        const boxStart = i - 4;
        if (boxStart < 0) continue;
        const view = new DataView(bytes.buffer, bytes.byteOffset);
        const size = view.getUint32(boxStart);
        if (size > 16 && boxStart + size <= bytes.length) {
          return { source: '字节扫描兜底', data: bytes.subarray(boxStart, boxStart + size) };
        }
      }
    }
    return null;
  }

  function extractFromPNG(bytes) {
    let pos = 8;
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    while (pos + 12 <= bytes.length) {
      const len = view.getUint32(pos);
      const type = fourCC(bytes, pos + 4);
      if (type === 'caBX') {
        return { source: 'PNG caBX 块', data: bytes.subarray(pos + 8, pos + 8 + len) };
      }
      if (type === 'IEND') break;
      pos += 12 + len;
    }
    return null;
  }

  function extractFromJPEG(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const packets = [];
    let pos = 2;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos] !== 0xff) { pos++; continue; }
      const marker = bytes[pos + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { pos += 2; continue; }
      if (marker === 0xda || marker === 0xd9) break;      // 进入压缩数据
      const len = view.getUint32 ? view.getUint16(pos + 2) : 0;
      if (marker === 0xeb && len > 10) {                  // APP11
        const seg = bytes.subarray(pos + 4, pos + 2 + len);
        if (seg[0] === 0x4a && seg[1] === 0x50) {         // "JP"
          const segView = new DataView(seg.buffer, seg.byteOffset);
          packets.push({ en: segView.getUint16(2), z: segView.getUint32(4), body: seg.subarray(8) });
        }
      }
      pos += 2 + len;
    }
    if (!packets.length) return null;

    // 同一个 en 的分片按 z 拼起来；除第一片外都要跳过重复的 LBox+TBox
    const en = packets[0].en;
    const group = packets.filter((p) => p.en === en).sort((a, b) => a.z - b.z);
    const chunks = group.map((p, i) => (i === 0 ? p.body : p.body.subarray(8)));
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const data = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((c) => { data.set(c, offset); offset += c.length; });
    return { source: 'JPEG APP11 段（' + group.length + ' 个分片）', data };
  }

  function extractFromWebP(bytes) {
    let pos = 12;
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    while (pos + 8 <= bytes.length) {
      const type = fourCC(bytes, pos);
      const len = view.getUint32(pos + 4, true);          // RIFF 是小端
      if (type === 'C2PA') {
        return { source: 'WebP C2PA 块', data: bytes.subarray(pos + 8, pos + 8 + len) };
      }
      pos += 8 + len + (len % 2);
    }
    return null;
  }

  function detectFormat(bytes) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
    if (fourCC(bytes, 0) === 'RIFF' && fourCC(bytes, 8) === 'WEBP') return 'webp';
    if (fourCC(bytes, 4) === 'ftyp') return 'bmff';
    const head = TEXT.decode(bytes.subarray(0, 400));
    if (head.indexOf('<svg') >= 0 || head.indexOf('<?xml') >= 0) return 'svg';
    return 'unknown';
  }

  function extractManifestStore(bytes, format) {
    let hit = null;
    if (format === 'png') hit = extractFromPNG(bytes);
    else if (format === 'jpeg') hit = extractFromJPEG(bytes);
    else if (format === 'webp') hit = extractFromWebP(bytes);
    return hit || findJumbfFallback(bytes);
  }

  /* ---------------------------------------------------------
   * XMP：很多 AI 工具只写 XMP，不写 C2PA
   * ------------------------------------------------------- */
  function extractXMP(bytes) {
    const text = TEXT.decode(bytes);
    const from = text.indexOf('<x:xmpmeta');
    if (from < 0) return null;
    const to = text.indexOf('</x:xmpmeta>', from);
    if (to < 0) return null;
    const raw = text.slice(from, to + 12);
    const pick = (re) => { const m = raw.match(re); return m ? m[1].trim() : ''; };
    return {
      raw,
      digitalSourceType: pick(/digitalSourceType[^>]*>([^<]+)</i) ||
                         pick(/digitalSourceType\s*=\s*"([^"]+)"/i),
      creatorTool: pick(/CreatorTool[^>]*>([^<]+)</i) || pick(/CreatorTool\s*=\s*"([^"]+)"/i),
      provenance: pick(/provenance[^>]*>([^<]+)</i) || pick(/provenance\s*=\s*"([^"]+)"/i),
    };
  }

  /* ---------------------------------------------------------
   * 组装成好读的报告
   * ------------------------------------------------------- */
  const AI_SOURCE_TYPES = ['trainedalgorithmicmedia', 'compositewithtrainedalgorithmicmedia', 'algorithmicmedia'];

  function collectManifests(bytes, store) {
    const root = parseBoxes(store.data, 0, store.data.length, 0);
    const manifests = [];

    // 顶层是 manifest store（label = "c2pa"），其子 jumb 各是一个 manifest
    root.forEach((box) => {
      if (box.type !== 'jumb') return;
      const children = box.children || [];
      const inner = children.filter((c) => c.type === 'jumb');
      const targets = box.label === 'c2pa' ? inner : [box];
      targets.forEach((m) => manifests.push(readManifest(store.data, m)));
    });
    return manifests.filter(Boolean);
  }

  function readManifest(data, manifestBox) {
    const out = { label: manifestBox.label || '(未命名清单)', claim: null, assertions: [], hasSignature: false };
    (manifestBox.children || []).forEach((child) => {
      if (child.type !== 'jumb') return;
      const label = child.label || '';
      const contents = child.children || [];

      if (label.indexOf('c2pa.claim') === 0) {
        const cbor = contents.find((c) => c.type === 'cbor');
        if (cbor) out.claim = safeCBOR(data, cbor);
      } else if (label === 'c2pa.signature') {
        out.hasSignature = true;
        const cbor = contents.find((c) => c.type === 'cbor');
        if (cbor) out.signatureSize = cbor.end - cbor.contentStart;
      } else if (label === 'c2pa.assertions') {
        contents.forEach((a) => {
          if (a.type !== 'jumb') return;
          const kids = a.children || [];
          const body = kids.find((c) => c.type === 'cbor' || c.type === 'json');
          const blob = kids.find((c) => c.type === 'bidb' || c.type === 'uuid');
          const entry = {
            label: a.label || '(未命名)',
            data: body ? (body.type === 'cbor' ? safeCBOR(data, body) : safeJSON(data, body)) : null,
            kind: body ? body.type : 'binary',
            size: a.end - a.start,
          };
          // 清单里自带的缩略图，可以直接渲染出来对照
          if (!body && blob) {
            entry.bytes = data.subarray(blob.contentStart, blob.end);
            entry.mime = /png/i.test(entry.label) ? 'image/png' : 'image/jpeg';
          }
          out.assertions.push(entry);
        });
      }
    });
    return out;
  }

  function safeCBOR(data, box) {
    try { return decodeCBOR(data.subarray(box.contentStart, box.end)); }
    catch (err) { return { _error: 'CBOR 解析失败: ' + err.message }; }
  }
  function safeJSON(data, box) {
    try { return JSON.parse(TEXT.decode(data.subarray(box.contentStart, box.end))); }
    catch (err) { return { _error: 'JSON 解析失败' }; }
  }

  /** 从清单里归纳出「这是 AI 生成的吗」 */
  function summarize(manifest) {
    const claim = manifest.claim || {};
    const generatorInfo = claim.claim_generator_info;
    const generator = claim.claim_generator ||
      (Array.isArray(generatorInfo) && generatorInfo[0] &&
        [generatorInfo[0].name, generatorInfo[0].version].filter(Boolean).join(' ')) || '';

    const actions = [];
    const sourceTypes = [];
    manifest.assertions.forEach((a) => {
      if (a.label.indexOf('c2pa.actions') === 0 && a.data && Array.isArray(a.data.actions)) {
        a.data.actions.forEach((act) => {
          actions.push({
            action: act.action || '',
            softwareAgent: typeof act.softwareAgent === 'object'
              ? [act.softwareAgent.name, act.softwareAgent.version].filter(Boolean).join(' ')
              : (act.softwareAgent || ''),
            digitalSourceType: act.digitalSourceType || '',
          });
          if (act.digitalSourceType) sourceTypes.push(act.digitalSourceType);
        });
      }
      if (a.label.indexOf('stds.iptc') === 0 && a.data) {
        const v = a.data.digitalSourceType || a.data.DigitalSourceType;
        if (v) sourceTypes.push(v);
      }
    });

    const aiGenerated = sourceTypes.some((t) =>
      AI_SOURCE_TYPES.some((k) => String(t).toLowerCase().indexOf(k) >= 0));

    const ingredients = manifest.assertions
      .filter((a) => a.label.indexOf('c2pa.ingredient') === 0 && a.data)
      .map((a) => ({
        title: a.data['dc:title'] || a.data.title || '(未命名素材)',
        format: a.data['dc:format'] || '',
        relationship: a.data.relationship || '',
      }));

    const creative = manifest.assertions.find((a) => a.label.indexOf('stds.schema-org.CreativeWork') === 0);
    const authors = creative && creative.data && Array.isArray(creative.data.author)
      ? creative.data.author.map((x) => x && x.name).filter(Boolean) : [];

    const thumbnail = manifest.assertions.find((a) => a.bytes && a.label.indexOf('c2pa.thumbnail.claim') === 0);

    return {
      generator,
      title: claim.title || claim['dc:title'] || '',
      format: claim['dc:format'] || '',
      alg: claim.alg || '',
      actions, sourceTypes, aiGenerated, ingredients, authors, thumbnail,
    };
  }

  /* ---------------------------------------------------------
   * 对外入口
   * ------------------------------------------------------- */
  function inspect(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const format = detectFormat(bytes);
    const store = extractManifestStore(bytes, format);
    const xmp = extractXMP(bytes);

    const report = { format, bytes: bytes.length, source: store ? store.source : '', manifests: [], xmp };
    if (store) {
      try {
        report.manifests = collectManifests(bytes, store).map((m) => Object.assign(m, { summary: summarize(m) }));
      } catch (err) {
        report.error = '清单解析失败：' + err.message;
      }
    }
    report.hasManifest = report.manifests.length > 0;
    report.active = report.manifests[report.manifests.length - 1] || null;

    const xmpSource = xmp && xmp.digitalSourceType ? xmp.digitalSourceType : '';
    report.aiGenerated = (report.active && report.active.summary.aiGenerated) ||
      AI_SOURCE_TYPES.some((k) => xmpSource.toLowerCase().indexOf(k) >= 0);
    return report;
  }

  global.C2PA = { inspect, decodeCBOR, parseBoxes, extractManifestStore, extractXMP, detectFormat };
})(typeof window !== 'undefined' ? window : globalThis);
