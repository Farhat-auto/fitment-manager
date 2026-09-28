import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { FitmentGuard } from "./guard.jsx";

function closeAction() {
  try {
    if (typeof shopify !== "undefined" && shopify.close) shopify.close();
  } catch (err) {
    // The host modal may already be closing.
  }
}

function unlockHost() {
  const node = document.querySelector("s-admin-action");
  if (!node) return;
  node.loading = false;
  node.removeAttribute("loading");
}

function paintShell(message) {
  const host = document.createElement("s-admin-action");
  host.heading = "CAR FITMENT";
  host.loading = false;
  const text = document.createElement("s-text");
  text.textContent = message;
  const primary = document.createElement("s-button");
  primary.slot = "primary-action";
  primary.textContent = "Close";
  primary.addEventListener("click", closeAction);
  const secondary = document.createElement("s-button");
  secondary.slot = "secondary-actions";
  secondary.textContent = "Cancel";
  secondary.addEventListener("click", closeAction);
  host.append(text, primary, secondary);
  document.body.replaceChildren(host);
  unlockHost();
}

export default async function mountCarFitmentAction() {
  paintShell("Loading car fitment…");
  try {
    render(<FitmentGuard mode="action" />, document.body);
    unlockHost();
    requestAnimationFrame(unlockHost);
  } catch (error) {
    paintShell((error && error.message) || "CAR FITMENT could not open.");
  }
}
