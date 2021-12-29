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

// 长度偏移量
function offset(num) {
  return Math.floor(num / 3) * 4 + num % 3;
}

function getProcessData(originalData){
  const sliceOffset = offset(8);
  const lenthData = originalData.slice(0, sliceOffset);
  let lenthText = '';
  let dataText = ''
  for(let i = 0; i < lenthData.length ; i++) {
    if(i % 4 !== 3){
      lenthText += lenthData[i] % 2 === 0 ? '0' : '1';
    }
  }

  const dataLength = radix2to10(lenthText);
  for(let i = lenthData.length; i <= lenthData.length + offset(dataLength * 16); i++){
    if(i % 4 !== 3){
      dataText += originalData[i] % 2 === 0 ? '0' : '1';
    }
  }
  let text = ''
  for(let i = 0; i < dataText.length; i+=16) {
    text += decodeText(dataText.slice(i, i + 16));
  }
  return text
}

const mergeData = function(ctx, imageDataWrap, waterMarkText){
  const waterMark = waterMarkText.split('').reduce((pre, current) => pre + zeroFill(encodeText(current), 16), '');
  if (waterMarkText.length > 256) return alert('不能大于256字节');
  const markData = zeroFill(radix10to2(waterMarkText.length), 8) + waterMark;
  console.log('zeroFill(radix10to2(waterMarkText.length), 8)', zeroFill(radix10to2(waterMarkText.length), 8));
  console.log('waterMark', waterMark);
  console.log('markData', markData);
  const imageData = imageDataWrap.data;
  let pos = -1;
  for (let i = 0; i < markData.length; i++) {
    pos++;
    if (pos % 4 === 3) {
      pos++;
    }
    if (markData[i] === '0' && (imageData[pos] % 2 === 1)) {
      // 没有水印信息的像素，将其对应通道的值设置为偶数
      if(imageData[pos] === 255){
        imageData[pos]--;
      } else {
        imageData[pos]++;
      }
    } else if (markData[i] !== '0' && (imageData[pos] % 2 === 0)){
      // 有水印信息的像素，将其对应通道的值设置为奇数
      imageData[pos]++;
    }
  }
  console.log(imageData.slice(0, 100))
  ctx.putImageData(imageDataWrap, 0, 0);
}

window.onload = function() {
  const waterMark = document.getElementById("waterMark");

  const encodeInput = document.getElementById("encodeInput");
  const encodeCanvas = document.getElementById('encodeCanvas');
  const encodeCanvasCtx = encodeCanvas.getContext('2d');


  const decodeInput = document.getElementById("decodeInput");
  const decodeText = document.getElementById('decodeText');
  const decodeImageCanvas = document.getElementById('decodeImageCanvas');
  const decodeImageCanvasCtx = decodeImageCanvas.getContext('2d');


  encodeInput.onchange = function () {
    getImageInfo(null, this.files[0], (err, data) => {
      if (err) return console.error(err)
      const { width, height, imgElement } = data;
      encodeCanvas.width = width;
      encodeCanvas.height = height;
      mergeData(encodeCanvasCtx, drawAndGetCanvasImageData(encodeCanvasCtx, imgElement, width, height), waterMark.value)
    })
  }

  decodeInput.onchange = function () {
    getImageInfo(null, this.files[0], (err, data) => {
      if (err) return console.error(err)
      const { width, height, imgElement } = data;
      decodeImageCanvas.width = width;
      decodeImageCanvas.height = height;
      decodeImageCanvasCtx.drawImage(imgElement, 0, 0);
      const text = getProcessData(decodeImageCanvasCtx.getImageData(0, 0, width, height).data)
      decodeText.innerHTML = text;
    })
  }
}