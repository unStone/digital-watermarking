// ---------------------------------------------------------------------------
// 容量条：明文写多少、加密后载荷有多长、这张图装不装得下
// ---------------------------------------------------------------------------

var imagePixelCount = 0;

// AES-GCM + base64 + JSON 包装以后的长度，不用真加密一遍也能估准
var estimatePayloadLength = function(text, encrypted) {
  if (!encrypted) return JSON.stringify({ text: text }).length;
  var utf8 = new TextEncoder().encode(text).length;
  var cipherB64 = Math.ceil((utf8 + 16) / 3) * 4;   // +16 是 GCM 的认证标签
  return 68 + cipherB64;                            // JSON 外壳 + salt/iv 的 base64
};

var renderCapacity = function() {
  var note = document.getElementById('capacity-note');
  var fill = document.getElementById('capacity-fill');
  var box = document.getElementById('capacity');
  if (!note) return;

  var text = document.getElementById('message').value;
  var encrypted = document.getElementById('password').value.length > 0;
  var payload = estimatePayloadLength(text, encrypted);
  var parts = ['明文 ' + text.length + ' / ' + maxMessageSize + ' 字'];
  if (encrypted) parts.push('加密后载荷约 ' + payload + ' 字符');

  if (!imagePixelCount) {
      box.classList.remove('meter--over');
      fill.style.width = '0%';
      note.textContent = parts.concat('选图后才知道装不装得下').join(' · ');
      return;
  }

  // 每个载荷字符占 16 bit，可用位是 RGB 三个分量（跳过 alpha）
  var limit = Math.min(maxPayloadSize, Math.floor((imagePixelCount * 3) / 16) - 1);
  var over = text.length > maxMessageSize || payload > limit;
  box.classList.toggle('meter--over', over);
  fill.style.width = Math.min(100, (payload / limit) * 100).toFixed(1) + '%';
  parts.push(over ? '超出这张图能装的 ' + limit + ' 字符' : '这张图能装 ' + limit + ' 字符');
  note.textContent = parts.join(' · ');
};

// initialize
window.onload = function() {
  // add action to the file input
  var input = document.getElementById('file');
  input.addEventListener('change', importImage);

  // add action to the encode button
  var encodeButton = document.getElementById('encode');
  encodeButton.addEventListener('click', encode);

  // add action to the decode button
  var decodeButton = document.getElementById('decode');
  decodeButton.addEventListener('click', decode);

  // 容量条跟着明文和口令实时变
  document.getElementById('message').addEventListener('input', renderCapacity);
  document.getElementById('password').addEventListener('input', renderCapacity);
  renderCapacity();
};

// 明文长度上限，和 textarea 的 maxlength 对齐
var maxMessageSize = 1000;
// 图里允许出现的载荷长度上限。密文是 base64 + JSON，比明文长不少，
// 这个值卡在明文上限上会让「加密 + 长文本」直接写不进去
var maxPayloadSize = 4000;

// ---------------------------------------------------------------------------
// 加解密：浏览器原生 WebCrypto（PBKDF2 + AES-GCM）
// GCM 自带认证，口令不对会直接抛错，而不是解出一堆乱码。
// 旧版用的 sjcl 只在遇到老格式密文时才按需加载，新用户一个字节都不用下。
// ---------------------------------------------------------------------------

var PBKDF2_ITERATIONS = 250000;
var PAYLOAD_VERSION = 2;

var toBase64 = function(bytes) {
  var chunk = 0x8000;
  var parts = [];
  for (var i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
  }
  return btoa(parts.join(''));
};

var fromBase64 = function(text) {
  var binary = atob(text);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

var requireCrypto = function() {
  if (!window.crypto || !window.crypto.subtle) {
      throw new Error('当前环境不支持 WebCrypto，请用 https 打开本页');
  }
};

var deriveKey = function(password, salt) {
  requireCrypto();
  return crypto.subtle
      .importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function(base) {
          return crypto.subtle.deriveKey(
              { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
              base,
              { name: 'AES-GCM', length: 256 },
              false,
              ['encrypt', 'decrypt']
          );
      });
};

var encryptMessage = function(password, text) {
  var salt = crypto.getRandomValues(new Uint8Array(16));
  var iv = crypto.getRandomValues(new Uint8Array(12));
  return deriveKey(password, salt)
      .then(function(key) {
          return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text));
      })
      .then(function(buffer) {
          return JSON.stringify({
              v: PAYLOAD_VERSION,
              s: toBase64(salt),
              i: toBase64(iv),
              c: toBase64(new Uint8Array(buffer)),
          });
      });
};

var decryptMessage = function(password, payload) {
  return deriveKey(password, fromBase64(payload.s))
      .then(function(key) {
          return crypto.subtle.decrypt(
              { name: 'AES-GCM', iv: fromBase64(payload.i) },
              key,
              fromBase64(payload.c)
          );
      })
      .then(function(buffer) { return new TextDecoder().decode(buffer); });
};

// 写入位置仍由口令的 SHA-256 决定。取 8 个大端有符号 int32，
// 和旧版 sjcl.hash.sha256.hash 的输出逐字对齐，所以以前生成的图还能读。
var sha256Words = function(password) {
  requireCrypto();
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)).then(function(buffer) {
      var view = new DataView(buffer);
      var words = [];
      for (var i = 0; i < 8; i++) words.push(view.getInt32(i * 4, false));
      return words;
  });
};

// 老格式（sjcl）密文才需要这个库，按需拉一次
var sjclPromise = null;
var loadSjcl = function() {
  if (sjclPromise) return sjclPromise;
  sjclPromise = new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = 'sjcl.js';
      script.onload = function() { resolve(window.sjcl); };
      script.onerror = function() { reject(new Error('旧版解密库加载失败')); };
      document.head.appendChild(script);
  });
  return sjclPromise;
};

// put image in the canvas and display it
var importImage = function(e) {
  var reader = new FileReader();

  reader.onload = function(event) {
      // set the preview
      document.getElementById('preview').style.display = 'block';
      document.getElementById('preview').src = event.target.result;

      // wipe all the fields clean
      document.getElementById('message').value = '';
      document.getElementById('password').value = '';
      document.getElementById('password2').value = '';
      document.getElementById('messageDecoded').innerHTML = '';

      // read the data into the canvas element
      var img = new Image();
      img.onload = function() {
          var ctx = document.getElementById('canvas').getContext('2d');
          ctx.canvas.width = img.width;
          ctx.canvas.height = img.height;
          ctx.drawImage(img, 0, 0);

          imagePixelCount = img.width * img.height;
          renderCapacity();
          decode();
      };
      img.src = event.target.result;
  };

  reader.readAsDataURL(e.target.files[0]);
};

// encode the image and save it
var encode = async function() {
  var message = document.getElementById('message').value;
  var password = document.getElementById('password').value;
  var output = document.getElementById('output');
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');

  // exit early if the plaintext is above an artificial limit
  if (message.length > maxMessageSize) {
      alert('内容超过 ' + maxMessageSize + ' 字上限。');
      return;
  }

  // encrypt the message with supplied password if necessary
  try {
      message = password.length > 0
          ? await encryptMessage(password, message)
          : JSON.stringify({'text': message});
  } catch (e) {
      alert('加密失败：' + e.message);
      return;
  }

  // exit early if the message is too big for the image
  var pixelCount = ctx.canvas.width * ctx.canvas.height;
  if ((message.length + 1) * 16 > pixelCount * 4 * 0.75) {
      alert('这段内容太长，这张图装不下，换张大点的图。');
      return;
  }

  // encode the encrypted message with the supplied password
  var imgData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  encodeMessage(imgData.data, await sha256Words(password), message);
  ctx.putImageData(imgData, 0, 0);

  // view the new image
  alert('写好了。下面出现的图片右键另存为，务必存 PNG。');

  output.src = canvas.toDataURL();

};

// decode the image and display the contents if there is anything
var decode = async function() {
  var password = document.getElementById('password2').value;
  var passwordFail = '口令不对，或者这张图里没有藏东西。';

  var showChoose = function() {
      document.getElementById('choose').style.display = 'block';
      document.getElementById('reveal').style.display = 'none';
  };

  // decode the message with the supplied password
  var ctx = document.getElementById('canvas').getContext('2d');
  var imgData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  var message = decodeMessage(imgData.data, await sha256Words(password));

  // try to parse the JSON
  var obj = null;
  try {
      obj = JSON.parse(message);
  } catch (e) {
      showChoose();
      if (password.length > 0) {
          alert(passwordFail);
      }
  }

  // display the "reveal" view
  if (obj) {
      // decrypt if necessary
      if (obj.v === PAYLOAD_VERSION && obj.c) {
          if (!password.length) return showChoose();   // 加密过的图，先填口令
          try {
              obj.text = await decryptMessage(password, obj);
          } catch (e) {
              showChoose();
              return alert(passwordFail);
          }
      } else if (obj.ct) {
          // 老版本 sjcl 密文，这时候才去拉那个库
          if (!password.length) return showChoose();
          try {
              obj.text = (await loadSjcl()).decrypt(password, message);
          } catch (e) {
              showChoose();
              return alert(passwordFail);
          }
      }

      document.getElementById('choose').style.display = 'none';
      document.getElementById('reveal').style.display = 'block';

      // escape special characters
      var escChars = {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          '\'': '&#39;',
          '/': '&#x2F;',
          '\n': '<br/>'
      };
      var escHtml = function(string) {
          return String(string).replace(/[&<>"'\/\n]/g, function (c) {
              return escChars[c];
          });
      };
      document.getElementById('messageDecoded').innerHTML = escHtml(obj.text);
  }
};

// returns a 1 or 0 for the bit in 'location'
var getBit = function(number, location) {
 return ((number >> location) & 1);
};

// sets the bit in 'location' to 'bit' (either a 1 or 0)
var setBit = function(number, location, bit) {
 return (number & ~(1 << location)) | (bit << location);
};

// returns an array of 1s and 0s for a 2-byte number
var getBitsFromNumber = function(number) {
 var bits = [];
 for (var i = 0; i < 16; i++) {
     bits.push(getBit(number, i));
 }
 return bits;
};

// returns the next 2-byte number
var getNumberFromBits = function(bytes, history, hash) {
  var number = 0, pos = 0;
  while (pos < 16) {
      var loc = getNextLocation(history, hash, bytes.length);
      var bit = getBit(bytes[loc], 0);
      number = setBit(number, pos, bit);
      pos++;
  }
  return number;
};

// returns an array of 1s and 0s for the string 'message'
var getMessageBits = function(message) {
  var messageBits = [];
  for (var i = 0; i < message.length; i++) {
      var code = message.charCodeAt(i);
      messageBits = messageBits.concat(getBitsFromNumber(code));
  }
  return messageBits;
};

// gets the next location to store a bit
var getNextLocation = function(history, hash, total) {
  var pos = history.length;
  var loc = Math.abs(hash[pos % hash.length] * (pos + 1)) % total;
  while (true) {
      if (loc >= total) {
          loc = 0;
      } else if (history.indexOf(loc) >= 0) {
          loc++;
      } else if ((loc + 1) % 4 === 0) {
          loc++;
      } else {
          history.push(loc);
          return loc;
      }
  }
};

// encodes the supplied 'message' into the CanvasPixelArray 'colors'
var encodeMessage = function(colors, hash, message) {
  // make an array of bits from the message
  var messageBits = getBitsFromNumber(message.length);
  messageBits = messageBits.concat(getMessageBits(message));

  // this will store the color values we've already modified
  var history = [];

  // encode the bits into the pixels
  var pos = 0;
  while (pos < messageBits.length) {
      // set the next color value to the next bit
      var loc = getNextLocation(history, hash, colors.length);
      colors[loc] = setBit(colors[loc], 0, messageBits[pos]);

      // set the alpha value in this pixel to 255
      // we have to do this because browsers do premultiplied alpha
      // see for example: http://stackoverflow.com/q/4309364
      while ((loc + 1) % 4 !== 0) {
          loc++;
      }
      colors[loc] = 255;

      pos++;
  }
};

// returns the message encoded in the CanvasPixelArray 'colors'
var decodeMessage = function(colors, hash) {
  // this will store the color values we've already read from
  var history = [];

  // get the message size
  var messageSize = getNumberFromBits(colors, history, hash);

  // exit early if the message is too big for the image
  if ((messageSize + 1) * 16 > colors.length * 0.75) {
      return '';
  }

  // exit early if the message is above an artificial limit
  if (messageSize === 0 || messageSize > maxPayloadSize) {
      return '';
  }

  // put each character into an array
  var message = [];
  for (var i = 0; i < messageSize; i++) {
      var code = getNumberFromBits(colors, history, hash);
      message.push(String.fromCharCode(code));
  }

  // the characters should parse into valid JSON
  return message.join('');
};
