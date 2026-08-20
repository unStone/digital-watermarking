/**
 * LSB 隐写 · 顺序编码
 * 数据格式：8 bit 长度头（字符数，最多 255） + 每字符 16 bit（UTF-16 码元）
 * 逐个「可用位」写入 R/G/B 的最低有效位，alpha 通道跳过不动
 */

const HEADER_BITS = 8;
const CHAR_BITS = 16;
const MAX_CHARS = 255;

/** 把水印文本转成比特串 */
function buildBitString(text) {
  const body = Array.from(text)
    .map((ch) => zeroFill(encodeText(ch), CHAR_BITS))
    .join('');
  return zeroFill(radix10to2(Array.from(text).length), HEADER_BITS) + body;
}

/** 按比特串改写 ImageData 的最低有效位 */
function writeBits(imageDataWrap, bits) {
  const data = imageDataWrap.data;
  for (let i = 0; i < bits.length; i++) {
    const pos = bitIndexToDataIndex(i);
    const isOdd = data[pos] % 2 === 1;
    if (bits[i] === '0' && isOdd) {
      data[pos] += data[pos] === 255 ? -1 : 1;
    } else if (bits[i] === '1' && !isOdd) {
      data[pos] += 1;
    }
  }
}

/** 从 ImageData 读回水印文本 */
function readWatermark(data) {
  const readBits = (from, count) => {
    let bits = '';
    for (let i = from; i < from + count; i++) {
      const pos = bitIndexToDataIndex(i);
      if (pos >= data.length) break;
      bits += data[pos] % 2 === 0 ? '0' : '1';
    }
    return bits;
  };

  const length = radix2to10(readBits(0, HEADER_BITS));
  if (!length) return '';

  let text = '';
  for (let i = 0; i < length; i++) {
    text += decodeText(readBits(HEADER_BITS + i * CHAR_BITS, CHAR_BITS));
  }
  return text;
}

window.addEventListener('DOMContentLoaded', function () {

  const waterMark = document.getElementById('waterMark');
  const encodeInput = document.getElementById('encodeInput');
  const encodeCanvas = document.getElementById('encodeCanvas');
  const encodeCtx = encodeCanvas.getContext('2d', { willReadFrequently: true });
  const encodeStat = document.getElementById('encodeStat');
  const downloadBtn = document.getElementById('download');

  const decodeInput = document.getElementById('decodeInput');
  const decodeCanvas = document.getElementById('decodeImageCanvas');
  const decodeCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });
  const decodeText = document.getElementById('decodeText');

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
      if (bits.length > lsbCapacity(width * height)) {
        return UI.toast('图片太小，装不下这段水印');
      }
      encodeCanvas.width = width;
      encodeCanvas.height = height;
      encodeCtx.drawImage(imgElement, 0, 0);
      const imageData = encodeCtx.getImageData(0, 0, width, height);
      writeBits(imageData, bits);
      encodeCtx.putImageData(imageData, 0, 0);
      encodeStat.textContent = '已写入 ' + bits.length + ' bit，占用容量 ' +
        (bits.length / lsbCapacity(width * height) * 100).toFixed(2) + '%';
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
      const text = readWatermark(decodeCtx.getImageData(0, 0, width, height).data);
      decodeText.textContent = text || '（没读出水印，图片可能被压缩过）';
    });
  };
});
