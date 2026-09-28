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

export default async function mountCarFitmentAction() {
  // Shopify paints an empty loading action before this file runs, and it
  // keeps that first element. Fill that element. A second action stays hidden
  // behind the spinner.
  const shell = document.querySelector("s-admin-action");
  if (shell) {
    shell.heading = "Ocean Catalogue / CAR FITMENT";
    shell.loading = false;
    shell.removeAttribute("loading");
  }
  try {
    render(
      <FitmentGuard mode="action" insideHost={Boolean(shell)} />,
      shell || document.body,
    );
    unlockHost();
    requestAnimationFrame(unlockHost);
    setTimeout(unlockHost, 0);
  } catch (error) {
    paintShell((error && error.message) || "CAR FITMENT could not open.");
  }
}
