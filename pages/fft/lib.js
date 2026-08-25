
function shiftDFT(cv, mag) {
    let rect = new cv.Rect(0, 0, mag.cols & (-2), mag.rows & (-2));
    mag.roi(rect);

    let cx = mag.cols / 2;
    let cy = mag.rows / 2;

    let q0 = mag.roi(new cv.Rect(0, 0, cx, cy));
    let q1 = mag.roi(new cv.Rect(cx, 0, cx, cy));
    let q2 = mag.roi(new cv.Rect(0, cy, cx, cy));
    let q3 = mag.roi(new cv.Rect(cx, cy, cx, cy));

    let tmp =  new cv.Mat();
    q0.copyTo(tmp);
    q3.copyTo(q0);
    tmp.copyTo(q3);

    q1.copyTo(tmp);
    q2.copyTo(q1);
    tmp.copyTo(q2);

    tmp.delete()
    q0.delete()
    q1.delete()
    q2.delete()
    q3.delete()
}

function getBlueChannel(cv, image)
{
    let nextImg = image;
    let channel = new cv.MatVector();
    cv.split(nextImg, channel);
    return channel.get(0);
}

function getDftMat(cv, padded)
{
    let planes = new cv.MatVector();
    planes.push_back(padded);
    let matZ = new cv.Mat.zeros(padded.size(), cv.CV_32F)
    planes.push_back(matZ);
    let comImg = new cv.Mat();
    cv.merge(planes,comImg);
    cv.dft(comImg, comImg);
    matZ.delete();
    return comImg;
}

/**
 * 文字蒙版
 * cv.putText 用的 Hershey 是矢量 ASCII 字库，没有中日韩字形，中文进去只会变问号。
 * 所以文字改成用 canvas 画，拿它的 alpha 通道当蒙版，再按蒙版往频谱里写 0，
 * 字形交给浏览器：中文、日文、韩文、emoji 都能画出来。
 */
const WATERMARK_FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", "WenQuanYi Micro Hei", sans-serif';

/** putText 的 fontScale 换算成 canvas 的 px，和原来的默认观感对齐 */
function fontScaleToPx(fontScale) {
    return Math.max(10, Math.round(fontScale * 30));
}

async function buildWatermarkMask(width, height, text, fontScale) {
    const content = String(text == null ? '' : text).trim();
    if (!content) return null;

    const px = fontScaleToPx(fontScale);
    const fontStack = await resolveFontStack(content, px);

    const layer = document.createElement('canvas');
    layer.width = width;
    layer.height = height;
    const ctx = layer.getContext('2d', { willReadFrequently: true });
    ctx.font = px + 'px ' + fontStack;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // putText 的锚点是基线左端，这里保持一致；长文案往左收，别甩出画面
    const textWidth = ctx.measureText(content).width;
    const maxX = Math.max(0, width - textWidth - 8);
    ctx.fillText(content, Math.min(width / 2, maxX), height / 2);
    ctx.fillText(content, Math.min(45, maxX), 45);

    // 频谱得共轭对称，逆变换回来才是实数图：再叠一层旋转 180° 的自己
    const merged = document.createElement('canvas');
    merged.width = width;
    merged.height = height;
    const mctx = merged.getContext('2d', { willReadFrequently: true });
    mctx.drawImage(layer, 0, 0);
    mctx.translate(width, height);
    mctx.rotate(Math.PI);
    mctx.drawImage(layer, 0, 0);
    return mctx.getImageData(0, 0, width, height);
}

/** 蒙版命中的像素，实部虚部一起写 0——等价于原来的 putText(Scalar.all(0)) */
function stampMaskOnMat(comImg, mask) {
    if (!mask) return;
    const total = comImg.rows * comImg.cols;
    if (mask.data.length !== total * 4) {
        throw new Error('水印蒙版尺寸和图像不一致');
    }
    const alpha = mask.data;
    const out = comImg.data32F;
    for (let i = 0; i < total; i++) {
        if (alpha[i * 4 + 3] > 128) {
            out[i * 2] = 0;
            out[i * 2 + 1] = 0;
        }
    }
}

/**
 * 系统里真没有中文字形时（画出来是豆腐块），才按需拉一份**只含这几个字**的子集字体，
 * 通常几 KB。有字形的机器（macOS / Windows / iOS / Android）一个字节都不会下。
 */
const SUBSET_FONT_FAMILY = 'WatermarkSubsetFallback';
const SUBSET_FONT_API = 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC&text=';
const subsetFontCache = new Map();

async function resolveFontStack(text, px) {
    const missing = missingGlyphs(text, px);
    if (!missing) return WATERMARK_FONT_STACK;
    try {
        await loadSubsetFont(missing);
        return '"' + SUBSET_FONT_FAMILY + '", ' + WATERMARK_FONT_STACK;
    } catch (err) {
        return WATERMARK_FONT_STACK;
    }
}

/**
 * 拿一个必然缺字形的码位（U+FFFF）当基准，比**位图**而不是比宽度——
 * 豆腐块和汉字宽度一样，只有画出来的像素能区分。画不出东西的也算缺字形。
 */
function missingGlyphs(text, px) {
    const size = Math.ceil(px * 1.6);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const probe = canvas.getContext('2d', { willReadFrequently: true });
    probe.font = px + 'px ' + WATERMARK_FONT_STACK;
    probe.textBaseline = 'alphabetic';
    probe.fillStyle = '#000';

    const signature = function (ch) {
        probe.clearRect(0, 0, size, size);
        probe.fillText(ch, 2, px);
        const data = probe.getImageData(0, 0, size, size).data;
        let sig = 0;
        let ink = 0;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] > 32) { ink++; sig = (sig * 31 + i) >>> 0; }
        }
        return ink ? ink + ':' + sig : '';
    };

    const tofu = signature('\uFFFF');
    const chars = Array.from(new Set(Array.from(text))).filter(function (ch) {
        if (ch.codePointAt(0) < 0x2e80) return false;   // ASCII / 拉丁不用管
        const sig = signature(ch);
        return sig === '' || sig === tofu;
    });
    return chars.join('');
}

function loadSubsetFont(chars) {
    if (subsetFontCache.has(chars)) return subsetFontCache.get(chars);
    const task = (async function () {
        const css = await fetch(SUBSET_FONT_API + encodeURIComponent(chars)).then(function (r) { return r.text(); });
        const url = (css.match(/url\((https:\/\/[^)]+)\)/) || [])[1];
        if (!url) throw new Error('子集字体地址解析失败');
        const face = new FontFace(SUBSET_FONT_FAMILY, 'url(' + url + ')');
        await face.load();
        document.fonts.add(face);
    })();
    subsetFontCache.set(chars, task);
    return task;
}

function transFormMatWithText(cv, srcImg, mask) {
    let padded = getBlueChannel(cv, srcImg);
    padded.convertTo(padded, cv.CV_32F);
    let comImg = getDftMat(cv, padded);
    // add text
    stampMaskOnMat(comImg, mask);
    //back image
    let invDFT = new cv.Mat();
    cv.idft(comImg, invDFT, cv.DFT_SCALE | cv.DFT_REAL_OUTPUT, 0);
    let restoredImage = new cv.Mat();
    invDFT.convertTo(restoredImage, cv.CV_8U);
    let backPlanes = new cv.MatVector();
    cv.split(srcImg, backPlanes);
    // backPlanes.erase(backPlanes.get(0));
    // backPlanes.insert(backPlanes.get(0), restoredImage);
    backPlanes.set(0,restoredImage)
    let backImage = new cv.Mat();
    cv.merge(backPlanes,backImage);

    padded.delete();
    comImg.delete();
    invDFT.delete();
    restoredImage.delete()
    return backImage;
}

function getTextFormMat(cv, backImage) {
    let padded= getBlueChannel(cv, backImage);
    padded.convertTo(padded, cv.CV_32F);
    let comImg = getDftMat(cv, padded);
    let backPlanes = new cv.MatVector();
    // split the comples image in two backPlanes  
    cv.split(comImg, backPlanes);
    let mag = new cv.Mat();
    // compute the magnitude
    cv.magnitude(backPlanes.get(0), backPlanes.get(1), mag);
    // move to a logarithmic scale  
    let matOne = cv.Mat.ones(mag.size(), cv.CV_32F)
    cv.add(matOne, mag, mag);  
    cv.log(mag, mag);  
    shiftDFT(cv, mag);
    mag.convertTo(mag, cv.CV_8UC1);
    cv.normalize(mag, mag, 0, 255, cv.NORM_MINMAX, cv.CV_8UC1);

    padded.delete();
    comImg.delete();
    matOne.delete();
    return mag;    
}

function matToCanvas(cv, mat){
    if(!(mat instanceof cv.Mat)){
        throw new Error("Please input the valid new cv.Mat instance.");
    }
    const canvasElement = document.createElement('canvas');
    cv.imshow(canvasElement, mat);
    return canvasElement
}

function init() {
  cv.idft = function(src, dst, flags, nonzero_rows ) {
    cv.dft( src, dst, flags | cv.DFT_INVERSE, nonzero_rows );
  }
}

async function transformImageWithText(imgageElement,watermarkText,fontSize) {
  init()
  if((typeof watermarkText)!='string') {
    throw new Error('waterMarkText must be string')
  }
  if((typeof fontSize)!='number') {
    throw new Error('fontSize must be number')
  }
  let srcImg = cv.imread(imgageElement);
  if (srcImg.empty()){throw new Error("read image failed");}
  const mask = await buildWatermarkMask(srcImg.cols, srcImg.rows, watermarkText, fontSize);
  let comImg = transFormMatWithText(cv, srcImg, mask);
  const canvasElement = matToCanvas(cv, comImg)
  srcImg.delete();
  comImg.delete();
  return canvasElement
}

async function getTextFormImage(imgageElement) {
    init()
    let comImg = cv.imread(imgageElement);
    let backImage = getTextFormMat(cv, comImg);
    const canvasElement = matToCanvas(cv, backImage)
    comImg.delete();
    backImage.delete();
    return canvasElement
  }