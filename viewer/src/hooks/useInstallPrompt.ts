import { useEffect, useState } from 'react';

/** Non-standard but widely implemented event the browser fires when it decides installation is currently possible. No official DOM lib type ships for it yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallPromptState =
  | { available: false }
  | { available: true; promptInstall: () => Promise<'accepted' | 'dismissed'> };

/**
 * Captures the browser's `beforeinstallprompt` event so the shell can offer
 * an explicit install affordance - and, critically, never claims
 * installability when the browser has not actually made it available.
 * Absence of the event (unsupported browser, already installed, criteria
 * unmet) always resolves to `{ available: false }`; there is no synthetic
 * fallback prompt.
 */
export function useInstallPrompt(): InstallPromptState {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event): void => {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = (): void => {
      setDeferredEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  if (deferredEvent === null) return { available: false };

  return {
    available: true,
    promptInstall: async () => {
      await deferredEvent.prompt();
      const choice = await deferredEvent.userChoice;
      setDeferredEvent(null);
      return choice.outcome;
    },
  };
}
