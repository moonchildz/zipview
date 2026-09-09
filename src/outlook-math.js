export function eyeElevation(base, floor, floorHeight = 2.9, offset = 0, eyeHeight = 1.5) {
  return base + offset + (floor - 1) * floorHeight + eyeHeight;
}

export function localPoint(lon, lat, center) {
  return [(lon - center[0]) * 111195 * Math.cos(center[1] * Math.PI / 180), -(lat - center[1]) * 111195];
}

export function facadeView(points, edge = 9, clearance = 0.8) {
  const a = points[edge], b = points[edge + 1];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  // Selected southeast-facing edge of the existing 206 footprint, not a surveyed window.
  const normal = [-dz / length, dx / length];
  const point = [(a[0] + b[0]) / 2 + normal[0] * clearance, (a[1] + b[1]) / 2 + normal[1] * clearance];
  return { point, bearing: (Math.atan2(normal[0], -normal[1]) * 180 / Math.PI + 360) % 360 };
}

export function geographicPoint(x, z, center) {
  return { lon: center[0] + x / (111195 * Math.cos(center[1] * Math.PI / 180)), lat: center[1] - z / 111195 };
}

export function insideFootprint([x, z], points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, az] = points[i], [bx, bz] = points[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}
