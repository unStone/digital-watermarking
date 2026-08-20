/* 图片类 Demo 共用的小工具 */

/**
 * 读取图片宽高与 img 元素，支持 URL 或 File
 * @param {string|null} src
 * @param {File|null} file
 * @param {(err: Error|null, data?: {width:number,height:number,imgElement:HTMLImageElement}) => void} callback
 */
function getImageInfo(src, file, callback) {
  let currentSrc = null;
  let objectUrl = null;

  if (typeof src === 'string') {
    currentSrc = src;
  } else if (file instanceof File) {
    objectUrl = URL.createObjectURL(file);
    currentSrc = objectUrl;
  }

  if (!currentSrc) {
    return callback(new Error('需要一个图片地址或 File 对象'));
  }

  const img = new Image();
  const release = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };

  img.onload = function () {
    // 注意：不能在这里 revoke，img 还要拿去 drawImage；等一轮宏任务再释放
    setTimeout(release, 0);
    callback(null, {
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      imgElement: img,
    });
  };
  img.onerror = function () {
    release();
    callback(new Error('图片加载失败'));
  };
  img.src = currentSrc;
}

/** 十进制 -> 二进制字符串 */
function radix10to2(num) {
  if (typeof num !== 'number' || !Number.isFinite(num)) return '0';
  return num.toString(2);
}

/** 二进制字符串 -> 十进制 */
function radix2to10(text) {
  if (typeof text !== 'string' || !text.length) return 0;
  const value = parseInt(text, 2);
  return Number.isNaN(value) ? 0 : value;
}

/** 单个字符 -> 二进制串（UTF-16 码元） */
function encodeText(text) {
  if (typeof text !== 'string' || !text.length) return '0';
  return radix10to2(text.charCodeAt(0));
}

/** 二进制串 -> 单个字符 */
function decodeText(str) {
  if (typeof str !== 'string' || !str.length) return '';
  return String.fromCharCode(radix2to10(str));
}

/** 左侧补 0 到指定长度 */
function zeroFill(str, length) {
  return String(str).padStart(length, '0');
}

/**
 * ImageData 里可用于藏 1 bit 的位置数（跳过 alpha 通道）
 * @param {number} pixelCount 像素总数
 */
function lsbCapacity(pixelCount) {
  return pixelCount * 3;
}

/** 把第 n 个「可用位」映射成 ImageData 下标（跳过每组的 alpha） */
function bitIndexToDataIndex(n) {
  return Math.floor(n / 3) * 4 + (n % 3);
}
