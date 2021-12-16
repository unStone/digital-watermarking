window.onload = function() {
  const input = document.querySelector("input[type=file]");
  var currentGPSLongitude = document.getElementById("GPSLongitude");
  var currentGPSLatitude = document.getElementById("GPSLatitude");

  currentGPSLongitude.onclick = currentGPSLatitude.onclick = function() {
    navigator.clipboard.writeText(this.innerHTML);
  };

  input.onchange = async function () {
    const tags = await ExifReader.load(this.files[0])
    console.log('tags', tags);
    currentGPSLongitude.innerHTML = tags.GPSLongitude?.value;
    currentGPSLatitude.innerHTML = tags.GPSLatitude?.value;
  }
}