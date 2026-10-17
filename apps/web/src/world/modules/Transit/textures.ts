// Canvas-drawn signs (no network fonts or images): Underground roundels, bus blinds, bus stop flags.
import * as THREE from "three";

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d")!;
  draw(c);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function fitText(c: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = "bold") {
  let s = size;
  c.font = `${weight} ${s}px Helvetica, Arial, sans-serif`;
  while (c.measureText(text).width > maxW && s > 8) {
    s -= 2;
    c.font = `${weight} ${s}px Helvetica, Arial, sans-serif`;
  }
}

/** Ring + bar + name, TfL style. Transparent outside the roundel (use alphaTest). */
export function roundelTexture(name: string, ring: string, bar = "#10239e") {
  return canvasTex(512, 512, (c) => {
    const cx = 256, cy = 256;
    c.clearRect(0, 0, 512, 512);
    c.beginPath();
    c.arc(cx, cy, 200, 0, Math.PI * 2);
    c.fillStyle = ring;
    c.fill();
    c.beginPath();
    c.arc(cx, cy, 128, 0, Math.PI * 2);
    c.fillStyle = "#ffffff";
    c.fill();
    c.fillStyle = bar;
    c.fillRect(10, cy - 50, 492, 100);
    c.fillStyle = "#ffffff";
    fitText(c, name.toUpperCase(), 450, 64);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(name.toUpperCase(), cx, cy + 4);
  });
}

/** Black destination blind: big route number, destination beside it, in white. */
export function busBlindTexture(route: string, destination: string) {
  return canvasTex(512, 128, (c) => {
    c.fillStyle = "#0b0b0b";
    c.fillRect(0, 0, 512, 128);
    c.fillStyle = "#ffffff";
    c.textBaseline = "middle";
    c.textAlign = "left";
    c.font = "bold 92px Helvetica, Arial, sans-serif";
    c.fillText(route, 18, 68);
    const nw = c.measureText(route).width;
    fitText(c, destination, 512 - nw - 60, 56);
    c.fillStyle = "#ffd23a";
    c.fillText(destination, nw + 44, 68);
  });
}

/** Red bus-stop roundel flag. */
export function busStopTexture() {
  return roundelTexture("BUS STOP", "#e1251b", "#e1251b");
}

/** Timetable panel: a little grid of times. */
export function timetableTexture() {
  return canvasTex(128, 192, (c) => {
    c.fillStyle = "#f4f4ef";
    c.fillRect(0, 0, 128, 192);
    c.fillStyle = "#e1251b";
    c.fillRect(0, 0, 128, 28);
    c.fillStyle = "#222";
    for (let r = 0; r < 9; r++) for (let k = 0; k < 3; k++) c.fillRect(10 + k * 38, 40 + r * 16, 28, 6);
  });
}
