/** v0.8 Batch 6: keyboard-accessible (plain native `<button>`s), repository-owned zoom/pan toolbar - no external pan/zoom library. */
export function ZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
  label,
}: {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onReset: () => void;
  label: string;
}) {
  return (
    <div className="zoom-controls" role="group" aria-label={`${label} zoom and pan controls`}>
      <button type="button" onClick={onZoomOut} aria-label={`Zoom out ${label}`}>
        −
      </button>
      <span className="zoom-controls__scale">{scale.toFixed(2)}x</span>
      <button type="button" onClick={onZoomIn} aria-label={`Zoom in ${label}`}>
        +
      </button>
      <button type="button" onClick={onFit} aria-label={`Fit ${label}`}>
        Fit
      </button>
      <button type="button" onClick={onReset} aria-label={`Reset ${label}`}>
        Reset
      </button>
    </div>
  );
}
