// Apply the saved appearance before styles load to avoid a light/dark flash.
try {
  const saved = localStorage.getItem("qiyeThemeMode");
  document.documentElement.dataset.theme = ["light", "dark"].includes(saved) ? saved : "system";
} catch {
  document.documentElement.dataset.theme = "system";
}
