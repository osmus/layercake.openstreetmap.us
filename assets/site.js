const METADATA_URL = "https://data.openstreetmap.us/layercake/metadata.json";
const DATE_FORMAT = { year: "numeric", month: "long", day: "numeric" };

const updated = document.querySelector("[data-updated]");
if (updated) {
  fetch(METADATA_URL)
    .then((res) => res.json())
    .then(({ timestamp }) => {
      const date = new Date(timestamp);
      updated.textContent = `Data last updated ${date.toLocaleDateString(undefined, DATE_FORMAT)}`;
      updated.hidden = false;
    });
}

document.addEventListener("click", (ev) => {
  const button = ev.target.closest("[data-copy]");
  if (!button) return;

  navigator.clipboard.writeText(button.dataset.copy);
  button.textContent = "Copied";
  setTimeout(() => {
    button.textContent = "Copy";
  }, 1200);
});
