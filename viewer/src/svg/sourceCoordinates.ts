/**
 * v0.9 Batch 3: the one browser-side screen-pointer to SVG-source-coordinate
 * transform. It uses the SVG element's own `getScreenCTM()` inverse, so it is
 * correct for any rendered size, letterboxing, zoom/pan `viewBox`, and
 * devicePixelRatio (client coordinates are CSS pixels, and the CTM maps them
 * straight into viewBox user units). Both panning (`useZoomPan`) and
 * annotation drawing/moving call this function - there is no second
 * implementation.
 */
export function screenPointToSvgSource(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | undefined {
  const ctm = svg.getScreenCTM();
  if (!ctm) return undefined;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const transformed = point.matrixTransform(ctm.inverse());
  return { x: transformed.x, y: transformed.y };
}
