// 添加简单水印
function addWaterMark(ctx, x, y) {
  ctx.fillStyle = 'rgba(255, 255 ,255, 1)';
  ctx.font = "20px Arial";
  ctx.fillText("Hello World", x, y);


  ctx.fillStyle = 'rgba(0, 0 ,0, 1)';
  ctx.font = "20px Arial";
  ctx.fillText("Hello World", x, y + 40);


  ctx.fillStyle = 'rgba(255, 0 ,0, 1)';
  ctx.font = "20px Arial";
  ctx.fillText("Hello World", x, y + 80);


  ctx.fillStyle = 'rgba(0, 0 ,255, 1)';
  ctx.font = "20px Arial";
  ctx.fillText("Hello World", x, y + 120);


  ctx.fillStyle = 'rgba(0, 255 ,0, 1)';
  ctx.font = "20px Arial";
  ctx.fillText("Hello World", x, y + 160);
}

window.onload = function() {
  const canvas = document.getElementById('canvas');
  const canvasWaterMark = document.getElementById('canvas-water-mark');
  const ctx = canvas.getContext("2d");
  const ctxWaterMark = canvasWaterMark.getContext("2d");
  const input = document.querySelector("input[type=file]");
  input.onchange = function () {
    getImageWH(null, this.files[0], (err, data) => {
      if (err) return console.error('获取图片框高失败', err)
      const { width, height, imgElement } = data;
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(imgElement, 0, 0);
      addWaterMark(ctx, 200, 0)

      
      canvasWaterMark.width = width;
      canvasWaterMark.height = height;

      // 添加简单水印
      addWaterMark(ctxWaterMark, 0, 0);
    })
  }
}