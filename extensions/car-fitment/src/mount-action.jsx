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
  const nodes = document.querySelectorAll("s-admin-action");
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    node.loading = false;
    node.removeAttribute("loading");
  }
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

export default function mountCarFitmentAction() {
  // The products page keeps the first admin action and shows its spinner
  // until this file replaces it with the real window.
  try {
    const stale = document.querySelectorAll("s-admin-action");
    for (let index = 0; index < stale.length; index += 1) stale[index].remove();
    render(<FitmentGuard mode="action" />, document.body);
    unlockHost();
  } catch (error) {
    paintShell((error && error.message) || "CAR FITMENT could not open.");
  }
}
