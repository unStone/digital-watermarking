/** 频域盲水印：按需加载 opencv.js，避免 11MB 拖慢首屏 */

const OPENCV_URL = 'https://file.yzcdn.cn/upload_files/yz-file/2021/12/29/lrnriiER0KMoYZSKFh6Zut7PeZBj.js';

let opencvPromise = null;
function loadOpenCV(onProgress) {
  if (opencvPromise) return opencvPromise;
  opencvPromise = new Promise((resolve, reject) => {
    if (onProgress) onProgress('正在加载 opencv.js（约 11MB，只需一次）…');
    const script = document.createElement('script');
    script.src = OPENCV_URL;
    script.async = true;
    script.onerror = () => reject(new Error('opencv.js 下载失败，检查一下网络'));
    script.onload = async () => {
      if (typeof window.cv === 'undefined') return reject(new Error('opencv.js 加载异常'));
      // 不同构建的初始化方式不一样：工厂函数 / onRuntimeInitialized / 已就绪
      if (typeof window.cv === 'function') {
        window.cv = await window.cv();
        return resolve();
      }
      if (window.cv.Mat) return resolve();
      window.cv.onRuntimeInitialized = () => resolve();
    };
    document.head.appendChild(script);
  });
  return opencvPromise;
}

function showCanvas(container, canvasElement) {
  container.innerHTML = '';
  container.appendChild(canvasElement);
}

function showImage(container, file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => setTimeout(() => URL.revokeObjectURL(url), 0);
  img.src = url;
  container.innerHTML = '';
  container.appendChild(img);
}

function fileToImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { setTimeout(() => URL.revokeObjectURL(url), 0); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
    img.src = url;
  });
}

window.addEventListener('DOMContentLoaded', function () {
  UI.mountTopbar('fft/');

  const waterMark = document.getElementById('waterMark');
  const fontSizeInput = document.getElementById('fontSize');
  const encodeInput = document.getElementById('encodeInput');
  const encodeProcess = document.getElementById('encodeProcess');
  const encodeInputImg = document.getElementById('encodeInputImg');
  const encodeImg = document.getElementById('encodeImg');
  const downloadEncode = document.getElementById('downloadEncode');

  const decodeInput = document.getElementById('decodeInput');
  const decodeProcess = document.getElementById('decodeProcess');
  const decodeInputImg = document.getElementById('decodeInputImg');
  const decodeImg = document.getElementById('decodeImg');

  let encodedCanvas = null;

  fontSizeInput.oninput = function () {
    document.getElementById('fontSize-v').textContent = this.value;
  };

  encodeInput.onchange = async function () {
    const file = this.files[0];
    if (!file) return;
    try {
      await loadOpenCV((msg) => { encodeProcess.textContent = msg; });
      encodeProcess.textContent = '正在做傅里叶变换…';
      showImage(encodeInputImg, file);
      const img = await fileToImageElement(file);
      encodedCanvas = await transformImageWithText(img, waterMark.value, Number(fontSizeInput.value));
      showCanvas(encodeImg, encodedCanvas);
      downloadEncode.disabled = false;
      encodeProcess.textContent = '完成，记得存 PNG';
    } catch (err) {
      encodeProcess.textContent = err.message;
    }
  };

  downloadEncode.onclick = function () {
    if (encodedCanvas) UI.downloadCanvas(encodedCanvas, 'fft-watermark.png');
  };

  decodeInput.onchange = async function () {
    const file = this.files[0];
    if (!file) return;
    try {
      await loadOpenCV((msg) => { decodeProcess.textContent = msg; });
      decodeProcess.textContent = '正在解析频谱…';
      showImage(decodeInputImg, file);
      const img = await fileToImageElement(file);
      showCanvas(decodeImg, await getTextFormImage(img));
      decodeProcess.textContent = '完成';
    } catch (err) {
      decodeProcess.textContent = err.message;
    }
  };
});
