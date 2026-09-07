// Shared light/dark theme toggle for all 3 pages - persisted in localStorage, applied via a
// data-theme attribute on <html>. The actual colour overrides live in src/portal.css/style.css
// (each page's head also has a tiny inline script that applies the stored theme before first
// paint, so switching pages never flashes the wrong theme).
const STORAGE_KEY = "pascalator-theme";
const THEME_COLOR = { dark: "#05070f", light: "#d8dbe6" };

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function updateMetaThemeColor(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[theme]);
}

function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  updateMetaThemeColor(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch (e) {
    // localStorage unavailable (private browsing etc.) - theme just won't persist across pages.
  }
}

function updateToggleButton(button) {
  const isLight = currentTheme() === "light";
  button.setAttribute("aria-pressed", String(isLight));
  button.textContent = isLight ? "Switch to dark mode" : "Switch to light mode";
}

function initThemeToggle() {
  updateMetaThemeColor(currentTheme());
  const button = document.getElementById("themeToggle");
  if (!button) return;
  updateToggleButton(button);
  button.addEventListener("click", () => {
    applyTheme(currentTheme() === "light" ? "dark" : "light");
    updateToggleButton(button);
  });
}

document.addEventListener("DOMContentLoaded", initThemeToggle);
