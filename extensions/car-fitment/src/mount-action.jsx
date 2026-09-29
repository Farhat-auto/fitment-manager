import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { VehicleSearch } from "./vehicle-search.jsx";

function closeAction() {
  try {
    if (typeof shopify !== "undefined" && shopify.close) shopify.close();
  } catch (err) {
    // The host modal may already be closing.
  }
}

function SearchAction() {
  return (
    <s-admin-action heading="Vehicle" loading={false}>
      <s-button slot="primary-action" onClick={closeAction}>
        Close
      </s-button>
      <s-button slot="secondary-actions" onClick={closeAction}>
        Cancel
      </s-button>
      <VehicleSearch />
    </s-admin-action>
  );
}

export default async function mountCarFitmentAction() {
  // Render one admin action into the document. Do not remove the host node:
  // deleting it leaves the products page on the spinner.
  render(<SearchAction />, document.body);
}
