import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

function setPixel(image, x, y, color) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const index = (image.width * y + x) << 2;
  image.data[index] = color[0];
  image.data[index + 1] = color[1];
  image.data[index + 2] = color[2];
  image.data[index + 3] = color[3];
}

function roundedRect(image, left, top, width, height, radius, color) {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      const dx = Math.max(left + radius - x, 0, x - (left + width - radius - 1));
      const dy = Math.max(top + radius - y, 0, y - (top + height - radius - 1));
      if (dx * dx + dy * dy <= radius * radius) setPixel(image, x, y, color);
    }
  }
}

function colorIcon() {
  const image = new PNG({ width: 192, height: 192 });
  roundedRect(image, 2, 2, 188, 188, 38, [11, 15, 20, 255]);
  roundedRect(image, 30, 32, 132, 128, 24, [17, 24, 32, 255]);
  roundedRect(image, 44, 45, 104, 22, 10, [0, 140, 149, 255]);
  roundedRect(image, 44, 70, 27, 58, 10, [0, 140, 149, 255]);
  roundedRect(image, 68, 88, 80, 22, 10, [0, 140, 149, 255]);
  roundedRect(image, 121, 106, 27, 41, 10, [0, 140, 149, 255]);
  roundedRect(image, 44, 131, 94, 22, 10, [0, 140, 149, 255]);
  return image;
}

function outlineIcon() {
  const image = new PNG({ width: 32, height: 32 });
  const white = [255, 255, 255, 255];
  roundedRect(image, 5, 4, 22, 4, 2, white);
  roundedRect(image, 5, 8, 5, 10, 2, white);
  roundedRect(image, 9, 13, 18, 4, 2, white);
  roundedRect(image, 22, 16, 5, 8, 2, white);
  roundedRect(image, 5, 23, 19, 4, 2, white);
  return image;
}

await mkdir('appPackage', { recursive: true });
await writeFile('appPackage/color.png', PNG.sync.write(colorIcon()));
await writeFile('appPackage/outline.png', PNG.sync.write(outlineIcon()));
