/**
 * LSB 隐写 · 顺序编码
 * 数据格式：8 bit 长度头（字符数，最多 255） + 每字符 16 bit（UTF-16 码元）
 * 逐个「可用位」写入 R/G/B 的最低有效位，alpha 通道跳过不动
 */

const HEADER_BITS = 8;
const CHAR_BITS = 16;
const MAX_CHARS = 255;
const CRC_BITS = 16;
/** 每份冗余固定占这么多槽位，和实际长度无关——解码时才不用先知道长度就能定位第 n 份 */
const BLOCK_BITS = HEADER_BITS + CHAR_BITS * MAX_CHARS + CRC_BITS;
const COPY_CHOICES = [1, 3, 5];

/** CRC-16/CCITT，直接跑在比特串上。校验通过＝口令和冗余份数都猜对了 */
function crc16(bits) {
  let crc = 0xffff;
  for (let i = 0; i < bits.length; i++) {
    const top = (crc >> 15) & 1;
    crc = (crc << 1) & 0xffff;
    if (top ^ (bits[i] === '1' ? 1 : 0)) crc ^= 0x1021;
  }
  return crc;
}

/** 把水印文本转成比特串 */
function buildBitString(text) {
  const body = Array.from(text)
    .map((ch) => zeroFill(encodeText(ch), CHAR_BITS))
    .join('');
  return zeroFill(radix10to2(Array.from(text).length), HEADER_BITS) + body;
}

/** FNV-1a：把口令压成 32 位种子 */
function hashPassword(password) {
  let h = 0x811c9dc5;
  for (let i = 0; i < password.length; i++) {
    h ^= password.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gcd(a, b) {
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

/**
 * 口令决定一个仿射置换 slot = (a·k + b) mod capacity，a 与 capacity 互质所以是一一映射。
 * 没口令时退化成 a=1, b=0，也就是老版本的顺序写入，旧图照样读得出来。
 */
function buildScrambler(password, capacity) {
  if (!password) return function (k) { return k % capacity; };
  const rand = mulberry32(hashPassword(password));
  let a = (Math.floor(rand() * capacity) | 1) % capacity || 1;
  while (gcd(a, capacity) !== 1) a = (a + 2) % capacity || 1;
  const b = Math.floor(rand() * capacity);
  return function (k) { return (a * k + b) % capacity; };
}

/** 按比特串改写 ImageData 的最低有效位，写 copies 份，每份尾部带 CRC */
function writeBits(imageDataWrap, payload, scramble, copies) {
  const data = imageDataWrap.data;
  const bits = payload + zeroFill(radix10to2(crc16(payload)), CRC_BITS);
  for (let copy = 0; copy < copies; copy++) {
    const base = copy * BLOCK_BITS;
    for (let i = 0; i < bits.length; i++) {
      const pos = bitIndexToDataIndex(scramble(base + i));
      const isOdd = data[pos] % 2 === 1;
      if (bits[i] === '0' && isOdd) {
        data[pos] += data[pos] === 255 ? -1 : 1;
      } else if (bits[i] === '1' && !isOdd) {
        data[pos] += 1;
      }
    }
  }
}

/** 同一个 bit 在各份冗余里取多数 */
function voteBit(data, scramble, copies, index) {
  let ones = 0;
  let seen = 0;
  for (let copy = 0; copy < copies; copy++) {
    const pos = bitIndexToDataIndex(scramble(copy * BLOCK_BITS + index));
    if (pos >= data.length) continue;
    seen++;
    if (data[pos] % 2 === 1) ones++;
  }
  if (!seen) return '0';
  return ones * 2 > seen ? '1' : '0';
}

function readWithCopies(data, scramble, copies) {
  const readBits = (from, count) => {
    let bits = '';
    for (let i = from; i < from + count; i++) bits += voteBit(data, scramble, copies, i);
    return bits;
  };

  const header = readBits(0, HEADER_BITS);
  const length = radix2to10(header);
  if (!length) return { text: '', verified: false };

  const body = readBits(HEADER_BITS, length * CHAR_BITS);
  let text = '';
  for (let i = 0; i < length; i++) {
    text += decodeText(body.slice(i * CHAR_BITS, (i + 1) * CHAR_BITS));
  }
  const payload = header + body;
  const expected = zeroFill(radix10to2(crc16(payload)), CRC_BITS);
  return { text: text, verified: readBits(payload.length, CRC_BITS) === expected };
}

/** 解出来的东西像不像正常文本——用来判断这个冗余份数猜对了没有 */
function looksLikeText(text) {
  if (!text) return false;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0x20 && code !== 9 && code !== 10) return false;
    if (code >= 0xd800 && code <= 0xdfff) return false;   // 落单的代理项
    if (code === 0xfffd) return false;
  }
  return true;
}

/**
 * 从 ImageData 读回水印文本。
 * 冗余份数不用用户填：逐个试 1/3/5 份表决，CRC 过了就是对的。
 * 全都过不了，就按老格式（无 CRC、顺序写入）再读一次。
 */
function readWatermark(data, password, capacity) {
  const scramble = buildScrambler(password, capacity);
  const maxCopies = Math.floor(capacity / BLOCK_BITS);
  for (const copies of COPY_CHOICES) {
    if (copies > 1 && copies > maxCopies) break;
    const result = readWithCopies(data, scramble, copies);
    if (result.verified) return { text: result.text, copies: copies, verified: true };
  }
  const legacy = readWithCopies(data, scramble, 1);
  if (looksLikeText(legacy.text)) return { text: legacy.text, copies: 1, verified: false };
  return { text: '', copies: 0, verified: false };
}

window.addEventListener('DOMContentLoaded', function () {

  const waterMark = document.getElementById('waterMark');
  const passwordInput = document.getElementById('password');
  const copiesSelect = document.getElementById('copies');
  const encodeInput = document.getElementById('encodeInput');
  const encodeCanvas = document.getElementById('encodeCanvas');
  const encodeCtx = encodeCanvas.getContext('2d', { willReadFrequently: true });
  const encodeStat = document.getElementById('encodeStat');
  const downloadBtn = document.getElementById('download');

  const capacityBox = document.getElementById('capacity');
  const capacityFill = document.getElementById('capacity-fill');
  const capacityNote = document.getElementById('capacity-note');

  const decodePassword = document.getElementById('decodePassword');
  const decodeInput = document.getElementById('decodeInput');
  const decodeCanvas = document.getElementById('decodeImageCanvas');
  const decodeCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });
  const decodeText = document.getElementById('decodeText');

  let lastCapacity = 0;

  /** 载荷要占掉这张图多少可用位 */
  function renderCapacity() {
    const chars = Array.from(waterMark.value).length;
    const bits = HEADER_BITS + chars * CHAR_BITS + CRC_BITS;
    const copies = Number(copiesSelect.value);
    // 第 n 份从 n*BLOCK_BITS 起算，占地按最后一份的尾巴算
    const needed = (copies - 1) * BLOCK_BITS + bits;

    if (!lastCapacity) {
      capacityBox.classList.remove('meter--over');
      capacityFill.style.width = '0%';
      capacityNote.textContent = '载荷 ' + bits + ' bit × ' + copies + ' 份，选图后才知道占多少';
      return;
    }
    const percent = (needed / lastCapacity) * 100;
    const room = Math.floor((lastCapacity - (copies - 1) * BLOCK_BITS - HEADER_BITS - CRC_BITS) / CHAR_BITS);
    const limit = Math.max(0, Math.min(MAX_CHARS, room));
    const over = needed > lastCapacity || chars > limit;
    capacityBox.classList.toggle('meter--over', over);
    capacityFill.style.width = Math.min(100, percent).toFixed(1) + '%';
    capacityNote.textContent = !over
      ? '占用 ' + percent.toFixed(2) + '% · 这张图配 ' + copies + ' 份冗余最多能写 ' + limit + ' 个字'
      : limit > 0
        ? '装不下：' + copies + ' 份冗余在这张图上最多只能写 ' + limit + ' 个字'
        : '这张图太小，放不下 ' + copies + ' 份冗余，减少份数或换张大图';
  }

  waterMark.oninput = renderCapacity;
  copiesSelect.onchange = renderCapacity;
  renderCapacity();

  encodeInput.onchange = function () {
    const file = this.files[0];
    const text = waterMark.value;
    if (!file) return;
    if (!text) return UI.toast('请先填写水印内容');
    if (Array.from(text).length > MAX_CHARS) return UI.toast('水印最多 ' + MAX_CHARS + ' 个字符');

    getImageInfo(null, file, (err, data) => {
      if (err) return UI.toast(err.message);
      const { width, height, imgElement } = data;
      const bits = buildBitString(text);
      const capacity = lsbCapacity(width * height);
      lastCapacity = capacity;
      renderCapacity();
      const copies = Number(copiesSelect.value);
      // 第 n 份从 n*BLOCK_BITS 起算，所以真正要够用的是最后一份的尾巴
      const needed = (copies - 1) * BLOCK_BITS + bits.length + CRC_BITS;
      if (needed > capacity) {
        return UI.toast(copies > 1 ? '图片太小，装不下 ' + copies + ' 份冗余，试试减少份数' : '图片太小，装不下这段水印');
      }
      encodeCanvas.width = width;
      encodeCanvas.height = height;
      encodeCtx.drawImage(imgElement, 0, 0);
      const imageData = encodeCtx.getImageData(0, 0, width, height);
      writeBits(imageData, bits, buildScrambler(passwordInput.value, capacity), copies);
      encodeCtx.putImageData(imageData, 0, 0);
      encodeStat.textContent = '已写入 ' + (bits.length + CRC_BITS) + ' bit × ' + copies + ' 份，占用容量 ' +
        (needed / capacity * 100).toFixed(2) + '%' +
        (passwordInput.value ? '，位置已按口令打散' : '');
      downloadBtn.disabled = false;
    });
  };

  downloadBtn.onclick = function () {
    UI.downloadCanvas(encodeCanvas, 'lsb-order.png');
  };

  decodeInput.onchange = function () {
    const file = this.files[0];
    if (!file) return;
    getImageInfo(null, file, (err, data) => {
      if (err) return UI.toast(err.message);
      const { width, height, imgElement } = data;
      decodeCanvas.width = width;
      decodeCanvas.height = height;
      decodeCtx.drawImage(imgElement, 0, 0);
      const result = readWatermark(
        decodeCtx.getImageData(0, 0, width, height).data,
        decodePassword.value,
        lsbCapacity(width * height)
      );
      if (!result.text) {
        decodeText.textContent = '（没读出水印，可能被压缩过，或者口令不对）';
        return;
      }
      const note = result.verified
        ? '（校验通过' + (result.copies > 1 ? '，由 ' + result.copies + ' 份冗余表决恢复' : '') + '）'
        : '（未通过校验，可能是老版本生成的图，内容仅供参考）';
      decodeText.textContent = result.text + note;
    });
  };
});
