let fontSize = 1.1;
function getImageElementByUrl(url) {
  const imgElement = new Image();
  imgElement.src = url;
  return new Promise((reslove,reject)=>{
      imgElement.onload = function() {
          return reslove(imgElement);
      };
      imgElement.onerror = function() {
          return reject('image loading error:'+url);
      };
  })
}
function getCanvasBlobUrl(canvas) {
  return new Promise((reslove)=>{
      canvas.toBlob(function(blob) {
          return reslove(URL.createObjectURL(blob));
      })
  });
}
async function transformImageUrlWithText(srcImageUrl,watermarkText,fontSize) {
  return await getCanvasBlobUrl(await transformImageWithText(
      await getImageElementByUrl(srcImageUrl),
      watermarkText,fontSize
  ));
}
async function getTextFormImageUrl(enCodeImageUrl){
  return await getCanvasBlobUrl(await getTextFormImage(
      await getImageElementByUrl(enCodeImageUrl)
  ));
}
window.onload = function () {
    const waterMark = document.getElementById("waterMark");
    const encodeInput = document.getElementById("encodeInput");
    const encodeInputImg = document.getElementById("encodeInputImg");
    const encodeImg = document.getElementById("encodeImg");
    const encodeProcess = document.getElementById("encodeProcess");
    encodeInput.onchange = function () {
        encodeProcess.innerHTML = '图片叠加水印中...'
        transformImageUrlWithText(window.URL.createObjectURL(this.files[0]), waterMark.value, fontSize).then(res => {
            encodeInputImg.innerHTML = encodeImg.innerHTML = '';
            const encodeInputImgElement = document.createElement('img');
            encodeInputImgElement.src = window.URL.createObjectURL(this.files[0]);
            encodeInputImg.appendChild(encodeInputImgElement)

            const encodeImgElement = document.createElement('img');
            encodeImgElement.src = res;
            encodeImg.appendChild(encodeImgElement)
            encodeProcess.innerHTML = '图片叠加水印完成';
        });
    }
    

    const decodeInput = document.getElementById("decodeInput");
    const decodeInputImg = document.getElementById("decodeInputImg");
    const decodeImg = document.getElementById("decodeImg");
    const decodeProcess = document.getElementById("decodeProcess");
    decodeInput.onchange = function () {
        decodeProcess.innerHTML = '图片解析中...';
        getTextFormImageUrl(window.URL.createObjectURL(this.files[0])).then(res => {
            decodeInputImg.innerHTML = decodeImg.innerHTML = '';
            const decodeInputImgElement = document.createElement('img');
            decodeInputImgElement.src = window.URL.createObjectURL(this.files[0]);
            decodeInputImg.appendChild(decodeInputImgElement)

            const decodeImgElement = document.createElement('img');
            decodeImgElement.src = res;
            decodeImg.appendChild(decodeImgElement)
            decodeProcess.innerHTML = '图片解析完成';
        })
    }
    
}
