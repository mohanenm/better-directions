/**
 * The share image: a snapshot of the map with both routes, plus the name, summary and key
 * stats, drawn on a canvas on the device. Nothing is uploaded; the image is shared through the
 * system share sheet or downloaded.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
/** What the share image shows: works for routes and for GPS art. */
export interface ShareCard {
  name: string;
  summary: string;
  chips: [string, string][];
  from: [number, number];
  to: [number, number];
  legend: [string, string];
}

export const SHARE_W = 1080;
export const SHARE_H = 1350;
const MAP_H = 820;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Copy the map's WebGL canvas during a render (the buffer is valid only then), plus markers. */
function snapshotMap(map: MapLibreMap, ctx: CanvasRenderingContext2D, r: ShareCard): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000);
    map.once("render", () => {
      clearTimeout(timer);
      const src = map.getCanvas();
      const target = SHARE_W / MAP_H;
      let sw = src.width;
      let sh = src.height;
      if (sw / sh > target) sw = sh * target;
      else sh = sw / target;
      const sx = (src.width - sw) / 2;
      const sy = (src.height - sh) / 2;
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, SHARE_W, MAP_H);
      // The A/B markers are HTML on the page, so draw them onto the image too.
      const dpr = src.width / src.clientWidth || 1;
      const scale = SHARE_W / sw;
      for (const [point, label, colour] of [[r.from, "A", "#15803d"], [r.to, "B", "#16131c"]] as const) {
        const px = map.project(point);
        const x = (px.x * dpr - sx) * scale;
        const y = (px.y * dpr - sy) * scale;
        ctx.beginPath();
        ctx.arc(x, y, 26, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.lineWidth = 6;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = `800 28px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x, y + 1);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      }
      resolve(true);
    });
    map.triggerRepaint();
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderShareImage(map: MapLibreMap, r: ShareCard): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  // Render the map sharper just for the snapshot, then put it back.
  const previousRatio = map.getPixelRatio();
  map.setPixelRatio(Math.min(3, Math.max(previousRatio, SHARE_W / map.getCanvas().clientWidth)));
  const captured = await snapshotMap(map, ctx, r);
  map.setPixelRatio(previousRatio);
  if (!captured) {
    ctx.fillStyle = "#f6f3fa";
    ctx.fillRect(0, 0, SHARE_W, MAP_H);
  }
  // Brand strip over the map.
  ctx.fillStyle = "rgb(255 255 255 / 0.92)";
  ctx.fillRect(0, 0, SHARE_W, 84);
  ctx.fillStyle = "#16131c";
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText("Better", 40, 56);
  ctx.fillStyle = "#7e22ce";
  ctx.fillText("Directions", 40 + ctx.measureText("Better ").width, 56);

  let y = MAP_H + 80;
  ctx.fillStyle = "#16131c";
  ctx.font = `800 60px ${FONT}`;
  for (const line of wrap(ctx, r.name, SHARE_W - 80).slice(0, 2)) {
    ctx.fillText(line, 40, y);
    y += 70;
  }
  ctx.font = `500 34px ${FONT}`;
  ctx.fillStyle = "#4b4656";
  for (const line of wrap(ctx, r.summary, SHARE_W - 80).slice(0, 3)) {
    ctx.fillText(line, 40, y);
    y += 46;
  }
  // Three headline numbers as chips.
  const chips = r.chips;
  const chipW = (SHARE_W - 80 - 2 * 20) / 3;
  const chipY = Math.max(y + 10, SHARE_H - 330);
  chips.slice(0, 3).forEach(([label, value], i) => {
    const x = 40 + i * (chipW + 20);
    ctx.fillStyle = "#f6f3fa";
    ctx.beginPath();
    ctx.roundRect(x, chipY, chipW, 130, 18);
    ctx.fill();
    ctx.fillStyle = "#4b4656";
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText(wrap(ctx, label, chipW - 40)[0]!, x + 20, chipY + 44);
    ctx.fillStyle = "#7e22ce";
    ctx.font = `800 46px ${FONT}`;
    ctx.fillText(wrap(ctx, value, chipW - 40)[0]!, x + 20, chipY + 104);
  });
  // Legend
  y = SHARE_H - 120;
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#a21caf";
  ctx.beginPath();
  ctx.moveTo(40, y);
  ctx.lineTo(110, y);
  ctx.stroke();
  ctx.setLineDash([12, 12]);
  ctx.strokeStyle = "#5b6472";
  ctx.beginPath();
  ctx.moveTo(380, y);
  ctx.lineTo(450, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `600 28px ${FONT}`;
  ctx.fillStyle = "#16131c";
  ctx.fillText(r.legend[0], 125, y + 10);
  ctx.fillText(r.legend[1], 465, y + 10);

  ctx.font = `400 22px ${FONT}`;
  ctx.fillStyle = "#4b4656";
  ctx.fillText("For fun. Use common sense, follow signs and local rules.", 40, SHARE_H - 62);
  ctx.fillText("Map data © OpenStreetMap contributors (ODbL) · Basemap: Protomaps", 40, SHARE_H - 30);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't create the image."))), "image/png"),
  );
}
