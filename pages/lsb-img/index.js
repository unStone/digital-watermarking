/**
 * LSB 隐写 · 图形通道
 * 把水印文字先画成一张透明底的图，再用它的 alpha 通道当比特源，
 * 写进原图 G 分量的最低有效位。解码时把 G 的最低位放大成黑白图直接看。
 */

const CHANNEL = { R: { bit: 0, alphaOffset: 3 }, G: { bit: 1, alphaOffset: 2 }, B: { bit: 2, alphaOffset: 1 } };

/** 把水印文字画满画布，字号随图片宽度自适应 */
function drawWatermarkText(ctx, text, width, height) {
  const fontSize = Math.max(16, Math.round(width / 12));
  ctx.clearRect(0, 0, width, height);
  ctx.font = fontSize + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 斜向平铺，裁掉一块也还留着字
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 12);
  const step = fontSize * 3;
  for (let y = -height; y < height; y += step) {
    ctx.fillText(text, 0, y);
  }
  ctx.restore();
  return ctx.getImageData(0, 0, width, height);
}

/** 用 markData 的 alpha 通道改写 imageData 目标分量的最低位 */
function mergeData(ctx, markDataWrap, imageDataWrap, color) {
  const { bit, alphaOffset } = CHANNEL[color];
  const markData = markDataWrap.data;
  const imageData = imageDataWrap.data;

  for (let i = bit; i < imageData.length; i += 4) {
    const hasMark = markData[i + alphaOffset] !== 0;
    const isOdd = imageData[i] % 2 === 1;
    if (!hasMark && isOdd) {
      imageData[i] += imageData[i] === 255 ? -1 : 1;
    } else if (hasMark && !isOdd) {
      imageData[i] += 1;
    }
  }
  ctx.putImageData(imageDataWrap, 0, 0);
}

/** 把目标分量的最低位放大成黑白图 */
function revealBitPlane(ctx, dataWrap, color) {
  const { bit } = CHANNEL[color];
  const data = dataWrap.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = data[i + bit] % 2 === 0 ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(dataWrap, 0, 0);
}

window.addEventListener('DOMContentLoaded', function () {

  const waterMark = document.getElementById('waterMark');
  const channelSelect = document.getElementById('channel');
  const encodeInput = document.getElementById('encodeInput');
  const encodeTextCanvas = document.getElementById('encodeTextCanvas');
  const encodeCanvas = document.getElementById('encodeCanvas');
  const encodeTextCtx = encodeTextCanvas.getContext('2d', { willReadFrequently: true });
  const encodeCtx = encodeCanvas.getContext('2d', { willReadFrequently: true });
  const downloadBtn = document.getElementById('download');

  const decodeInput = document.getElementById('decodeInput');
  const decodeImageCanvas = document.getElementById('decodeImageCanvas');
  const decodeCanvas = document.getElementById('decodeCanvas');
  const decodeImageCtx = decodeImageCanvas.getContext('2d', { willReadFrequently: true });
  const decodeCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });

  encodeInput.onchange = function () {
    const file = this.files[0];
    if (!file) return;
    if (!waterMark.value) return UI.toast('请先填写水印内容');

    getImageInfo(null, file, (err, data) => {
      if (err) return UI.toast(err.message);
      const { width, height, imgElement } = data;
      encodeCanvas.width = encodeTextCanvas.width = width;
      encodeCanvas.height = encodeTextCanvas.height = height;
      encodeCtx.drawImage(imgElement, 0, 0);
      const markData = drawWatermarkText(encodeTextCtx, waterMark.value, width, height);
      mergeData(encodeCtx, markData, encodeCtx.getImageData(0, 0, width, height), channelSelect.value);
      downloadBtn.disabled = false;
    });
  };

  downloadBtn.onclick = function () {
    UI.downloadCanvas(encodeCanvas, 'lsb-img.png');
  };

  decodeInput.onchange = function () {
    const file = this.files[0];
    if (!file) return;
    getImageInfo(null, file, (err, data) => {
      if (err) return UI.toast(err.message);
      const { width, height, imgElement } = data;
      decodeImageCanvas.width = decodeCanvas.width = width;
      decodeImageCanvas.height = decodeCanvas.height = height;
      decodeImageCtx.drawImage(imgElement, 0, 0);
      revealBitPlane(decodeCtx, decodeImageCtx.getImageData(0, 0, width, height), channelSelect.value);
    });
  };
});
