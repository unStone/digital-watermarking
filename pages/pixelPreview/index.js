window.onload = function() {
  const input = document.querySelector("input[type=file]");
  let ctx = document.getElementById('canvas').getContext('2d');
  let originalData;

  let processData = function(originalData){
    let data = originalData.data;
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
    ctx.putImageData(originalData, 0, 0);
  }

  input.onchange = function () {
    getImageInfo(null, this.files[0], (err, data) => {
      const { imgElement } = data;
      ctx.drawImage(imgElement, 0, 0);
      // 获取指定区域的canvas像素信息
      originalData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
      processData(originalData)
    })
  }
}