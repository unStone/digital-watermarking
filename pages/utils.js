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