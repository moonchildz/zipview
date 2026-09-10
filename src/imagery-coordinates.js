import { geographicPoint } from './outlook-math.js';

export function tilePoint(lon, lat, zoom) {
  const n = 2 ** zoom, phi = lat * Math.PI / 180;
  return [(lon + 180) / 360 * n, (1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2 * n];
}

export function tileLocation(x, y, zoom) {
  const n = 2 ** zoom;
  return [x / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI];
}

export function imageryGrid(center, zoom = 18, count = 6) {
  const [x, y] = tilePoint(...center, zoom);
  const left = Math.floor(x) - Math.floor(count / 2), top = Math.floor(y) - Math.floor(count / 2);
  const [west, north] = tileLocation(left, top, zoom);
  const [east, south] = tileLocation(left + count, top + count, zoom);
  return {zoom, left, top, count, west, north, east, south};
}

export function groundUV(x, z, center, grid) {
  const {lon, lat} = geographicPoint(x, z, center);
  const [tx, ty] = tilePoint(lon, lat, grid.zoom);
  return [(tx - grid.left) / grid.count, 1 - (ty - grid.top) / grid.count];
}
