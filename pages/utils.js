// 获取图片的框高，支持地址或文件类型
function getImageInfo (src, file, callback) {
  let currentSrc = null;
  const img = new Image();
  if(typeof src === 'string') {
    currentSrc = src;
  }
  if (file instanceof File) {
    currentSrc = URL.createObjectURL(file);
  }
  img.src = currentSrc;
  img.onload = function() {
    callback(null, {
      width: img.width,
      height: img.height,
      imgElement: img,
    })
  }
  img.onerror = function(err) {
    callback(err);
  }
}

/**
 *  十进制 -> 二进制
 */
function radix10to2(num) {
  if (!num || typeof num !== 'number') return 0;
  return num.toString('2');
}

/**
 *  二进制 -> 十进制
 */
function radix2to10(text) {
  if (!text || typeof text !== 'string') return 0;
  return parseInt(text, 2);
}


function encodeText(text) {
  if (!text || typeof text !== 'string') return 0;
  return radix10to2(text.charCodeAt());
}

function decodeText(str) {
  if (!str || typeof str !== 'string') return '';
  return String.fromCharCode(radix2to10(str));
}

function zeroFill(str, length) {
	return str.padStart(length, 0)
}