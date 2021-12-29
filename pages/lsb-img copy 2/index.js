function drawAndGetCanvasTextData(ctx, text, width, height) {
  ctx.font = '30px Microsoft Yahei';
  ctx.fillText(text, 60, 130);
  return ctx.getImageData(0, 0, width, height);
}

function drawAndGetCanvasImageData(ctx, imgElement, width, height) {
  console.log('ctx, imgElement, width, height', ctx, imgElement, width, height);
  ctx.drawImage(imgElement, 0, 0);
  return ctx.getImageData(0, 0, width, height)
}

function processData(ctx, originalDataWrap){
  const data = originalDataWrap.data;
  for(let i = 0; i < data.length; i++){
    if(i % 4 == 1){
      if(data[i] % 2 === 0){
        data[i] = 0;
      } else {
        data[i] = 255;
      }
    } else if(i % 4 === 3){
      // alpha通道不做处理
      continue;
    } else {
      // 关闭其他分量，不关闭也不影响答案，甚至更美观 o(^▽^)o
      data[i] = 0;
    }
  }
  // 将结果绘制到画布
  ctx.putImageData(originalDataWrap, 0, 0);
}

const mergeData = function(ctx, markDataWrap, imageDataWrap, color){
  let bit, offset;
  const markData = markDataWrap.data;
  const imageData = imageDataWrap.data;

  switch(color){
    case 'R':
      bit = 0;
      offset = 3;
      break;
    case 'G':
      bit = 1;
      offset = 2;
      break;
    case 'B':
      bit = 2;
      offset = 1;
      break;
  }

  for(let i = 0; i < imageData.length; i++){
    if(i % 4 == bit){
      // 只处理目标通道
      if(markData[i + offset] === 0 && (imageData[i] % 2 === 1)){
          // 没有水印信息的像素，将其对应通道的值设置为偶数
          if(imageData[i] === 255){
            imageData[i]--;
          } else {
            imageData[i]++;
          }
      } else if (markData[i + offset] !== 0 && (imageData[i] % 2 === 0)){
        // 有水印信息的像素，将其对应通道的值设置为奇数
        if(imageData[i] === 255){
          imageData[i]--;
        } else {
          imageData[i]++;
        }
      }
    }
  }
  ctx.putImageData(imageDataWrap, 0, 0);
}

window.onload = function() {
  const waterMark = document.getElementById("waterMark");

  const encodeInput = document.getElementById("encodeInput");
  const encodeTextCanvas = document.getElementById('encodeTextCanvas');
  const encodeCanvas = document.getElementById('encodeCanvas');
  const encodeTextCanvasCtx = encodeTextCanvas.getContext('2d');
  const encodeCanvasCtx = encodeCanvas.getContext('2d');


  const decodeInput = document.getElementById("decodeInput");
  const decodeImageCanvas = document.getElementById('decodeImageCanvas');
  const decodeCanvas = document.getElementById('decodeCanvas');
  const decodeImageCanvasCtx = decodeImageCanvas.getContext('2d');
  const decodeCanvasCtx = decodeCanvas.getContext('2d');


  encodeInput.onchange = function () {
    getImageInfo(null, this.files[0], (err, data) => {
      if (err) return console.error(err)
      const { width, height, imgElement } = data;
      encodeCanvas.width = encodeTextCanvas.width = width;
      encodeCanvas.height = encodeTextCanvas.height = height;
      mergeData(encodeCanvasCtx, drawAndGetCanvasTextData(encodeTextCanvasCtx, waterMark.value, width, height), drawAndGetCanvasImageData(encodeCanvasCtx, imgElement, width, height), 'G')
    })
  }

  decodeInput.onchange = function () {
    getImageInfo(null, this.files[0], (err, data) => {
      if (err) return console.error(err)
      const { width, height, imgElement } = data;
      decodeImageCanvas.width = decodeCanvas.width = width;
      decodeImageCanvas.height = decodeCanvas.height = height;
      decodeImageCanvasCtx.drawImage(imgElement, 0, 0);
      processData(decodeCanvasCtx, decodeImageCanvasCtx.getImageData(0, 0, width, height))
    })
  }
}