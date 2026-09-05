// Registers the service worker (see sw.js) and auto-reloads the page once a newer version
// has taken control - combined with skipWaiting()/clients.claim() in sw.js, this means an
// update ships the moment it's deployed, with no manual "refresh to update" step needed.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js");
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
