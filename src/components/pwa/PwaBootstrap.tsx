import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";

const DISMISSED_KEY = "budget-lens-pwa-install-dismissed";

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone));
}

function isMobilePhone() {
  return window.matchMedia("(max-width: 767px) and (pointer: coarse)").matches;
}

export default function PwaBootstrap() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    const update = registerSW({ immediate: true });
    const handleInstall = (event: Event) => {
      if (!isMobilePhone()) return;
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setShowInstall(!isStandalone() && localStorage.getItem(DISMISSED_KEY) !== "1");
    };
    window.addEventListener("beforeinstallprompt", handleInstall);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstall);
      void update;
    };
  }, []);

  if (!showInstall || !installEvent) return null;

  const install = async () => {
    await installEvent.prompt();
    setShowInstall(false);
    setInstallEvent(null);
  };

  return (
    <aside dir="rtl" className="fixed inset-x-3 bottom-3 z-[100] rounded-2xl border bg-background p-4 text-right shadow-2xl sm:inset-x-auto sm:end-4 sm:w-[360px] md:hidden" role="dialog" aria-label="התקנת Budget Lens">
      <p className="font-semibold">להתקין את Budget Lens?</p>
      <p className="mt-1 text-sm text-muted-foreground">גישה מהירה ונוחה גם ממסך הבית.</p>
      <div className="mt-3 flex flex-row gap-2">
        <button type="button" onClick={install} className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">התקנה</button>
        <button type="button" onClick={() => { localStorage.setItem(DISMISSED_KEY, "1"); setShowInstall(false); }} className="flex-1 rounded-lg border px-3 py-2 text-sm">לא עכשיו</button>
      </div>
    </aside>
  );
}

declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  }
}
