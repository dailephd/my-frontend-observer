import { useInstallPrompt } from '../hooks/useInstallPrompt.js';

/**
 * Shows an install affordance only when the browser has actually signaled
 * installability via `beforeinstallprompt`. When it has not (unsupported
 * browser, criteria unmet, already installed), renders a plain informational
 * note instead of a disabled-looking or misleading button - the UI never
 * claims installability the platform has not granted.
 */
export function InstallButton() {
  const install = useInstallPrompt();

  if (!install.available) {
    return <span className="install-affordance install-affordance--unavailable">Install prompt not offered by this browser yet</span>;
  }

  return (
    <button
      type="button"
      className="install-affordance install-affordance--available"
      onClick={() => {
        void install.promptInstall();
      }}
    >
      Install viewer
    </button>
  );
}
