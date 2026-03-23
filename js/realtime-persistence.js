export function createRealtimePersistence({
  onSave,
  watchedRoots = [],
  debounceMs = 240,
  heartbeatMs = 5000,
}) {
  let saveTimerId = 0;
  let heartbeatId = 0;
  let lastSavedAt = 0;
  let observer = null;

  const saveNow = () => {
    if (typeof onSave !== 'function') {
      return;
    }
    onSave();
    lastSavedAt = Date.now();
  };

  const scheduleSave = ({ immediate = false } = {}) => {
    if (saveTimerId) {
      window.clearTimeout(saveTimerId);
      saveTimerId = 0;
    }

    if (immediate) {
      saveNow();
      return;
    }

    saveTimerId = window.setTimeout(() => {
      saveTimerId = 0;
      saveNow();
    }, debounceMs);
  };

  const onInput = () => scheduleSave();
  const onChange = () => scheduleSave();
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      scheduleSave({ immediate: true });
    }
  };
  const onPageHide = () => scheduleSave({ immediate: true });
  const onBeforeUnload = () => scheduleSave({ immediate: true });

  const start = () => {
    const roots = watchedRoots.filter(Boolean);
    if (roots.length > 0 && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        scheduleSave();
      });

      roots.forEach((root) => {
        observer.observe(root, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });
    }

    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);

    heartbeatId = window.setInterval(() => {
      const now = Date.now();
      if (now - lastSavedAt >= heartbeatMs) {
        scheduleSave({ immediate: true });
      }
    }, heartbeatMs);
  };

  const stop = () => {
    if (saveTimerId) {
      window.clearTimeout(saveTimerId);
      saveTimerId = 0;
    }

    if (heartbeatId) {
      window.clearInterval(heartbeatId);
      heartbeatId = 0;
    }

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    document.removeEventListener('input', onInput);
    document.removeEventListener('change', onChange);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };

  return {
    start,
    stop,
    scheduleSave,
    saveNow,
  };
}
