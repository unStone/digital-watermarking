window.onload = function() {
  const input = document.querySelector("input[type=file]");
  let ctx = document.getElementById('canvas').getContext('2d');
  let ctxText = document.getElementById('canvasText').getContext('2d');
  let textData, originalData;

  ctxText.font = '30px Microsoft Yahei';
  ctxText.fillText('水印123321', 60, 130);
  textData = ctxText.getImageData(0, 0, ctxText.canvas.width, ctxText.canvas.height).data;

  let mergeData = function(newData, color){
    let oData = originalData.data;
    let bit, offset;  
  
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
  
    for(let i = 0; i < oData.length; i++){
      if(i % 4 == bit){
        // 只处理目标通道
        if(newData[i + offset] === 0 && (oData[i] % 2 === 1)){
            // 没有水印信息的像素，将其对应通道的值设置为偶数
            if(oData[i] === 255){
              oData[i]--;
            } else {
              oData[i]++;
            }
        } else if (newData[i + offset] !== 0 && (oData[i] % 2 === 0)){
          // 有水印信息的像素，将其对应通道的值设置为奇数
          if(oData[i] === 255){
            oData[i]--;
          } else {
            oData[i]++;
          }
        }
      }
    }
    ctx.putImageData(originalData, 0, 0);
  }

  input.onchange = function () {
    getImageInfo(null, this.files[0], (err, data) => {
      if (err) return console.error('获取图片框高失败', err)
      const { imgElement } = data;
      ctx.drawImage(imgElement, 0, 0);
      // 获取指定区域的canvas像素信息
      originalData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      mergeData(textData,'G')
    })
  }
}