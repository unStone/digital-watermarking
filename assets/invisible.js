/* ============================================================
   invisible.js · 不可见字符水印引擎
   共 3 类字符级隐写方案的编解码 + 一个通用扫描器
   纯前端、无依赖，页面之间共用
   ============================================================ */
(function (global) {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8', { fatal: false });

  /* ---------------------------------------------------------
   * 1. 零宽字符（Zero-Width）
   *    4 个零宽字符做四进制，2 bit/字符 → 1 字节 = 4 字符
   *    先转 UTF-8 再编码，中文 / emoji 都能塞
   * ------------------------------------------------------- */
  const ZW_ALPHABET = ['​', '‌', '⁠', '﻿'];
  const ZW_INDEX = new Map(ZW_ALPHABET.map((c, i) => [c, i]));

  function encodeZeroWidth(payload) {
    let out = '';
    for (const b of enc.encode(payload)) {
      out += ZW_ALPHABET[(b >> 6) & 3] + ZW_ALPHABET[(b >> 4) & 3] +
             ZW_ALPHABET[(b >> 2) & 3] + ZW_ALPHABET[b & 3];
    }
    return out;
  }

  function decodeZeroWidth(text) {
    const digits = [];
    for (const ch of text) {
      const i = ZW_INDEX.get(ch);
      if (i !== undefined) digits.push(i);
    }
    const n = digits.length >> 2;
    if (!n) return '';
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      bytes[i] = (digits[i * 4] << 6) | (digits[i * 4 + 1] << 4) |
                 (digits[i * 4 + 2] << 2) | digits[i * 4 + 3];
    }
    return dec.decode(bytes);
  }

  /* ---------------------------------------------------------
   * 2. 变体选择符（Variation Selector）
   *    VS1–VS16 (FE00–FE0F) 映射 0x00–0x0F
   *    VS17–VS256 (E0100–E01EF) 映射 0x10–0xFF
   *    正好覆盖一个字节，且能挂在任意可见字符后面
   * ------------------------------------------------------- */
  function byteToVS(b) {
    return String.fromCodePoint(b < 16 ? 0xfe00 + b : 0xe0100 + (b - 16));
  }
  function vsToByte(cp) {
    if (cp >= 0xfe00 && cp <= 0xfe0f) return cp - 0xfe00;
    if (cp >= 0xe0100 && cp <= 0xe01ef) return cp - 0xe0100 + 16;
    return -1;
  }
  function encodeVariationSelector(payload) {
    let out = '';
    for (const b of enc.encode(payload)) out += byteToVS(b);
    return out;
  }
  function decodeVariationSelector(text) {
    const bytes = [];
    for (const ch of text) {
      const b = vsToByte(ch.codePointAt(0));
      if (b >= 0) bytes.push(b);
    }
    return bytes.length ? dec.decode(new Uint8Array(bytes)) : '';
  }

  /* ---------------------------------------------------------
   * 3. Unicode Tag（U+E0000 区，俗称 ASCII 走私）
   *    ASCII 码 + 0xE0000，主要用于对 LLM 的隐形提示词注入
   * ------------------------------------------------------- */
  function encodeUnicodeTag(payload) {
    let out = '';
    for (const ch of payload) {
      const cp = ch.codePointAt(0);
      if (cp >= 0x20 && cp <= 0x7e) out += String.fromCodePoint(0xe0000 + cp);
    }
    return out;
  }
  function decodeUnicodeTag(text) {
    let out = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp >= 0xe0020 && cp <= 0xe007e) out += String.fromCodePoint(cp - 0xe0000);
    }
    return out;
  }

  /* ---------------------------------------------------------
   * 嵌入 / 剥离
   * ------------------------------------------------------- */
  const EMBEDDERS = {
    zerowidth: encodeZeroWidth,
    vs: encodeVariationSelector,
    tag: encodeUnicodeTag,
  };

  /**
   * @param {string} carrier 载体文本
   * @param {string} payload 水印内容
   * @param {'zerowidth'|'vs'|'tag'} scheme
   * @param {'head'|'spread'} mode head=全部藏在首字符后，spread=均匀分散
   */
  function embed(carrier, payload, scheme, mode) {
    const base = Array.from(strip(carrier));
    if (!base.length) throw new Error('载体文本不能为空');
    if (!payload) throw new Error('水印内容不能为空');
    const mark = Array.from((EMBEDDERS[scheme] || encodeZeroWidth)(payload));
    if (!mark.length) throw new Error('该方案无法编码这段水印（Unicode Tag 只支持可见 ASCII）');

    if (mode !== 'spread' || base.length < 2) {
      return base[0] + mark.join('') + base.slice(1).join('');
    }
    // 分散：把 mark 尽量均匀地插到每个字符后面，末字符后不插
    const slots = base.length - 1;
    const per = Math.ceil(mark.length / slots);
    let out = '';
    let cursor = 0;
    for (let i = 0; i < base.length; i++) {
      out += base[i];
      if (i < slots && cursor < mark.length) {
        out += mark.slice(cursor, cursor + per).join('');
        cursor += per;
      }
    }
    return out + mark.slice(cursor).join('');
  }

  /**
   * 清洗：删掉不可见字符，异常空格则还原成普通空格（直接删会把词粘在一起）
   * @param {string[]} [kinds] 只清理指定类别，缺省清理全部
   */
  function strip(text, kinds) {
    const want = kinds && kinds.length ? new Set(kinds) : null;
    let out = '';
    for (const ch of text) {
      const info = describe(ch.codePointAt(0));
      if (!info || !info.invisible || (want && !want.has(info.kind))) { out += ch; continue; }
      if (info.kind === 'space') out += ' ';
    }
    return out;
  }

  /* ---------------------------------------------------------
   * 字符字典
   * ------------------------------------------------------- */
  const KINDS = {
    zerowidth: { label: '零宽字符', risk: 'danger', desc: '完全不占宽度，复制粘贴时会一起带走，最常见的文本隐写载体。' },
    vs:        { label: '变体选择符', risk: 'danger', desc: '本来用于选择字形变体，被滥用后可在任意字符后挂载一整个字节。' },
    tag:       { label: 'Unicode Tag', risk: 'danger', desc: 'U+E0000 区，能把一段 ASCII 完全隐形地塞进文本，常见于对 LLM 的提示词注入。' },
    bidi:      { label: '双向控制符', risk: 'danger', desc: '能让文本的显示顺序和真实顺序不一致，即 Trojan Source 攻击。' },
    space:     { label: '异常空格', risk: 'warn', desc: '看起来是空格，码位却不是 U+0020，会破坏分词、匹配和 diff。' },
    format:    { label: '其他格式控制符', risk: 'warn', desc: '软连字符等不可见控制字符。' },
    private:   { label: '私用区字符', risk: 'warn', desc: '码位没有标准含义，换个字体就变成豆腐块。' },
  };

  const NAMED = new Map([
    [0x200b, ['ZERO WIDTH SPACE', '零宽空格', 'zerowidth']],
    [0x200c, ['ZERO WIDTH NON-JOINER', '零宽非连接符', 'zerowidth']],
    [0x200d, ['ZERO WIDTH JOINER', '零宽连接符', 'zerowidth']],
    [0x2060, ['WORD JOINER', '单词连接符', 'zerowidth']],
    [0x2061, ['FUNCTION APPLICATION', '不可见函数应用', 'zerowidth']],
    [0x2062, ['INVISIBLE TIMES', '不可见乘号', 'zerowidth']],
    [0x2063, ['INVISIBLE SEPARATOR', '不可见分隔符', 'zerowidth']],
    [0x2064, ['INVISIBLE PLUS', '不可见加号', 'zerowidth']],
    [0xfeff, ['ZERO WIDTH NO-BREAK SPACE / BOM', '零宽不换行空格', 'zerowidth']],
    [0x180e, ['MONGOLIAN VOWEL SEPARATOR', '蒙文元音分隔符', 'zerowidth']],
    [0x00ad, ['SOFT HYPHEN', '软连字符', 'format']],
    [0x034f, ['COMBINING GRAPHEME JOINER', '组合字素连接符', 'format']],
    [0x200e, ['LEFT-TO-RIGHT MARK', '从左至右标记', 'bidi']],
    [0x200f, ['RIGHT-TO-LEFT MARK', '从右至左标记', 'bidi']],
    [0x061c, ['ARABIC LETTER MARK', '阿拉伯字母标记', 'bidi']],
    [0x00a0, ['NO-BREAK SPACE', '不换行空格', 'space']],
    [0x202f, ['NARROW NO-BREAK SPACE', '窄不换行空格', 'space']],
    [0x205f, ['MEDIUM MATHEMATICAL SPACE', '中等数学空格', 'space']],
    [0x1680, ['OGHAM SPACE MARK', '欧甘文空格', 'space']],
    [0x3000, ['IDEOGRAPHIC SPACE', '全角空格', 'space', false]],
  ]);

  function describe(cp) {
    const named = NAMED.get(cp);
    if (named) {
      // 第 4 项显式给 false 表示「可疑但合法」，清洗时不动它（如中文里的全角空格）
      return { cp, name: named[0], cn: named[1], kind: named[2], invisible: named[3] !== false };
    }
    if (cp >= 0xfe00 && cp <= 0xfe0f) {
      return { cp, name: 'VARIATION SELECTOR-' + (cp - 0xfe00 + 1), cn: '变体选择符', kind: 'vs', invisible: true };
    }
    if (cp >= 0xe0100 && cp <= 0xe01ef) {
      return { cp, name: 'VARIATION SELECTOR-' + (cp - 0xe0100 + 17), cn: '变体选择符', kind: 'vs', invisible: true };
    }
    if (cp >= 0xe0000 && cp <= 0xe007f) {
      const ascii = cp - 0xe0000;
      const shown = ascii >= 0x20 && ascii <= 0x7e ? ' = "' + String.fromCharCode(ascii) + '"' : '';
      return { cp, name: 'TAG U+' + cp.toString(16).toUpperCase() + shown, cn: 'Unicode Tag', kind: 'tag', invisible: true };
    }
    if (cp >= 0x202a && cp <= 0x202e) {
      return { cp, name: 'BIDI OVERRIDE U+' + cp.toString(16).toUpperCase(), cn: '双向覆盖', kind: 'bidi', invisible: true };
    }
    if (cp >= 0x2066 && cp <= 0x2069) {
      return { cp, name: 'BIDI ISOLATE U+' + cp.toString(16).toUpperCase(), cn: '双向隔离', kind: 'bidi', invisible: true };
    }
    if (cp >= 0x2000 && cp <= 0x200a) {
      return { cp, name: 'SPACE U+' + cp.toString(16).toUpperCase(), cn: '排版空格', kind: 'space', invisible: true };
    }
    if (cp >= 0xe000 && cp <= 0xf8ff) {
      return { cp, name: 'PRIVATE USE U+' + cp.toString(16).toUpperCase(), cn: '私用区', kind: 'private', invisible: true };
    }
    return null;
  }

  /* ---------------------------------------------------------
   * 扫描器
   * ------------------------------------------------------- */
  const TYPOGRAPHY = new Map([
    ['—', '长破折号 em dash'],
    ['–', '短破折号 en dash'],
    ['…', '省略号 …'],
    ['“', '弯引号 “'],
    ['”', '弯引号 ”'],
    ['‘', '弯引号 ‘'],
    ['’', '弯引号 ’'],
  ]);

  let MIXED_SCRIPT_RE = null;
  try {
    MIXED_SCRIPT_RE = new RegExp(
      '[\\p{Script=Latin}\\p{Script=Cyrillic}\\p{Script=Greek}]{2,}', 'gu');
  } catch (e) { /* 老浏览器不支持 Unicode 属性转义，跳过同形字检测 */ }

  function scan(text) {
    const chars = Array.from(text);
    const byKind = new Map();
    const byChar = new Map();
    let invisibleCount = 0;

    chars.forEach((ch, i) => {
      const info = describe(ch.codePointAt(0));
      if (!info) return;
      invisibleCount++;
      if (!byKind.has(info.kind)) byKind.set(info.kind, { kind: info.kind, count: 0, chars: new Map() });
      const group = byKind.get(info.kind);
      group.count++;
      const key = info.cp;
      if (!group.chars.has(key)) group.chars.set(key, { cp: info.cp, name: info.name, cn: info.cn, count: 0, first: i });
      group.chars.get(key).count++;
      byChar.set(key, info);
    });

    const groups = Array.from(byKind.values()).map((g) => ({
      kind: g.kind,
      label: KINDS[g.kind].label,
      desc: KINDS[g.kind].desc,
      risk: KINDS[g.kind].risk,
      count: g.count,
      chars: Array.from(g.chars.values()).sort((a, b) => b.count - a.count),
    })).sort((a, b) => b.count - a.count);

    // 混合脚本单词（西里尔 / 希腊字母冒充拉丁字母）
    const homoglyphs = [];
    if (MIXED_SCRIPT_RE) {
      MIXED_SCRIPT_RE.lastIndex = 0;
      let m;
      while ((m = MIXED_SCRIPT_RE.exec(text)) !== null) {
        const word = m[0];
        const scripts = [];
        if (/\p{Script=Latin}/u.test(word)) scripts.push('Latin');
        if (/\p{Script=Cyrillic}/u.test(word)) scripts.push('Cyrillic');
        if (/\p{Script=Greek}/u.test(word)) scripts.push('Greek');
        if (scripts.length > 1) homoglyphs.push({ word, index: m.index, scripts });
        if (homoglyphs.length >= 50) break;
      }
    }

    // 排版线索：只是 AI 文风的弱信号，不是水印
    const typography = [];
    TYPOGRAPHY.forEach((label, ch) => {
      const count = chars.filter((c) => c === ch).length;
      if (count) typography.push({ ch, label, count });
    });
    typography.sort((a, b) => b.count - a.count);

    return {
      length: chars.length,
      invisibleCount,
      groups,
      homoglyphs,
      typography,
      hidden: {
        zerowidth: plausible(decodeZeroWidth(text)),
        vs: plausible(decodeVariationSelector(text)),
        tag: plausible(decodeUnicodeTag(text)),
      },
    };
  }

  /**
   * 零散的不可见字符也会被强行解出一串乱码，这里做个可信度过滤：
   * 出现替换字符、或控制字符占比过高，就认为不是有效载荷
   */
  function plausible(text) {
    if (!text || !/\S/.test(text)) return '';
    if (text.indexOf('\uFFFD') >= 0) return '';
    const control = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
    return control / text.length > 0.2 ? '' : text;
  }

  /** 切成 token 序列，方便页面渲染高亮 */
  function tokenize(text) {
    const tokens = [];
    let buffer = '';
    for (const ch of text) {
      const info = describe(ch.codePointAt(0));
      if (info) {
        if (buffer) { tokens.push({ type: 'text', text: buffer }); buffer = ''; }
        tokens.push({ type: 'mark', info });
      } else {
        buffer += ch;
      }
    }
    if (buffer) tokens.push({ type: 'text', text: buffer });
    return tokens;
  }

  global.Invisible = {
    KINDS,
    encodeZeroWidth, decodeZeroWidth,
    encodeVariationSelector, decodeVariationSelector,
    encodeUnicodeTag, decodeUnicodeTag,
    embed, strip, scan, describe, tokenize,
  };
})(window);
