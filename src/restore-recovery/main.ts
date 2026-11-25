export {};

const params = new URLSearchParams(window.location.search);
const title = document.querySelector<HTMLParagraphElement>("#saved-title")!;
const address = document.querySelector<HTMLTextAreaElement>("#saved-url")!;
const button = document.querySelector<HTMLButtonElement>("#copy-address")!;
const status = document.querySelector<HTMLParagraphElement>("#copy-status")!;

title.textContent = params.get("title") ?? "";
address.value = params.get("url") ?? "";
button.disabled = !address.value;

button.addEventListener("click", async () => {
  address.select();
  try {
    await navigator.clipboard.writeText(address.value);
    status.textContent = "Address copied.";
  } catch {
    status.textContent = "Address selected. Press Ctrl+C to copy it.";
  }
});
