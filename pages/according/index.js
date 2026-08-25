/**
 * 明水印 + 全屏无痕水印
 * 明水印：半透明白字 + 黑色描边，斜向平铺，深浅背景都看得清
 * 无痕水印：不透明度 1% 的多色文字，正常看不见，拉色阶才现形
 */

const GHOST_COLORS = ['#ffffff', '#000000', '#ff0000', '#0000ff', '#00ff00'];

/** 文案变量：明水印真正的用途是「谁、什么时候、从哪张图拿的」 */
function resolveVariables(text, context) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  const time = pad(now.getHours()) + ':' + pad(now.getMinutes());
  const vars = {
    date: date,
    time: time,
    datetime: date + ' ' + time,
    file: context.file || '',
    size: context.width && context.height ? context.width + '×' + context.height : '',
  };
  return text.replace(/\{(date|time|datetime|file|size)\}/g, (whole, key) => vars[key] || '');
}

/** 斜向平铺地写一层文字 */
function tileText(ctx, text, width, height, options) {
  const { fontSize, alpha, colors, stroke } = options;
  const angle = isFinite(options.angle) ? options.angle : -20;
  const spacing = options.spacing > 0 ? options.spacing : 3.2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = fontSize + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(width / 2, height / 2);
  ctx.rotate((angle * Math.PI) / 180);

  const stepY = fontSize * spacing;
  const stepX = Math.max(ctx.measureText(text).width + fontSize * 2, fontSize * 6);
  // 旋转后要铺满的是对角线，不是宽高
  const reach = Math.hypot(width, height);
  const spanX = Math.ceil(reach / stepX) + 2;
  const spanY = Math.ceil(reach / stepY) + 2;

  let n = 0;
  for (let row = -spanY; row <= spanY; row++) {
    for (let col = -spanX; col <= spanX; col++) {
      ctx.fillStyle = colors[n++ % colors.length];
      const x = col * stepX + (row % 2 ? stepX / 2 : 0);
      const y = row * stepY;
      if (stroke) {
        ctx.lineWidth = Math.max(2, fontSize / 10);
        ctx.strokeStyle = 'rgba(0,0,0,.55)';
        ctx.strokeText(text, x, y);
      }
      ctx.fillText(text, x, y);
    }
  }
  ctx.restore();
}

/** 找出画面里最主流的亮度值——无痕水印就藏在它上下几个色阶里 */
function dominantLevel(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const histogram = new Uint32Array(256);
  // 大图抽样即可，没必要逐像素
  const step = Math.max(4, Math.floor(data.length / 4 / 40000) * 4);
  for (let i = 0; i < data.length; i += step) histogram[data[i]]++;
  let mode = 0;
  for (let v = 1; v < 256; v++) if (histogram[v] > histogram[mode]) mode = v;
  return mode;
}

/** 色阶拉伸：把 [black, white] 区间映射到 0–255 */
function stretchLevels(source, target, black, white) {
  const w = source.width;
  const h = source.height;
  if (!w || !h) return;
  target.width = w;
  target.height = h;
  const src = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
  const span = Math.max(1, white - black);
  const data = src.data;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.max(0, Math.min(255, ((data[i + c] - black) * 255) / span));
    }
  }
  target.getContext('2d').putImageData(src, 0, 0);
}

window.addEventListener('DOMContentLoaded', function () {

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const reveal = document.getElementById('reveal');
  const fileInput = document.getElementById('file');
  const textInput = document.getElementById('text');
  const visible = document.getElementById('visible');
  const ghost = document.getElementById('ghost');
  const scaleInput = document.getElementById('scale');
  const angleInput = document.getElementById('angle');
  const spacingInput = document.getElementById('spacing');
  const formatSelect = document.getElementById('format');
  const qualityInput = document.getElementById('quality');
  const qualityField = document.getElementById('quality-field');
  const black = document.getElementById('black');
  const white = document.getElementById('white');
  const downloadBtn = document.getElementById('download');

  let currentImage = null;
  let currentName = '';
  let autoFit = true;   // 换图后自动把色阶窗口对准背景，之后交给用户手调

  function renderReveal() {
    document.getElementById('black-v').textContent = black.value;
    document.getElementById('white-v').textContent = white.value;
    if (!currentImage) return;
    stretchLevels(canvas, reveal, Number(black.value), Number(white.value));
  }

  function render() {
    document.getElementById('visible-v').textContent = visible.value;
    document.getElementById('ghost-v').textContent = ghost.value;
    document.getElementById('scale-v').textContent = scaleInput.value;
    document.getElementById('angle-v').textContent = angleInput.value + '\u00b0';
    document.getElementById('spacing-v').textContent = spacingInput.value;
    if (!currentImage) return;

    const { width, height, imgElement } = currentImage;
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(imgElement, 0, 0);

    const text = resolveVariables(textInput.value, { file: currentName, width, height }) || ' ';
    const fontSize = Math.max(10, Math.round((width / 22) * Number(scaleInput.value)));
    const shape = { angle: Number(angleInput.value), spacing: Number(spacingInput.value) };

    // 明水印
    tileText(ctx, text, width, height, Object.assign({
      fontSize,
      alpha: Number(visible.value),
      colors: ['#ffffff'],
      stroke: true,
    }, shape));
    // 无痕水印：多色是为了在任何底色上都能被色阶拉出来
    tileText(ctx, text, width, height, Object.assign({
      fontSize: Math.round(fontSize * 0.8),
      alpha: Number(ghost.value),
      colors: GHOST_COLORS,
      stroke: false,
    }, shape));

    downloadBtn.disabled = false;
    if (autoFit) {
      // 把色阶窗口自动卡在主流亮度上下 8 级，1% 的水印就会跳出来
      const mode = dominantLevel(canvas);
      black.value = Math.max(0, mode - 8);
      white.value = Math.min(255, mode + 8);
      autoFit = false;
    }
    renderReveal();
  }

  fileInput.onchange = function () {
    const file = this.files[0];
    if (!file) return;
    getImageInfo(null, file, (err, data) => {
      if (err) return UI.toast(err.message);
      currentImage = data;
      currentName = file.name.replace(/\.[^.]+$/, '');
      autoFit = true;
      render();
    });
  };

  textInput.oninput = render;
  visible.oninput = render;
  ghost.oninput = render;
  scaleInput.oninput = render;
  angleInput.oninput = render;
  spacingInput.oninput = render;

  formatSelect.onchange = function () {
    qualityField.style.display = this.value === 'image/jpeg' ? '' : 'none';
  };
  qualityInput.oninput = function () {
    document.getElementById('quality-v').textContent = this.value;
  };
  black.oninput = renderReveal;
  white.oninput = renderReveal;

  downloadBtn.onclick = function () {
    const jpeg = formatSelect.value === 'image/jpeg';
    UI.downloadCanvas(canvas, jpeg ? 'watermarked.jpg' : 'watermarked.png', {
      type: formatSelect.value,
      quality: jpeg ? Number(qualityInput.value) : undefined,
    });
  };
});
