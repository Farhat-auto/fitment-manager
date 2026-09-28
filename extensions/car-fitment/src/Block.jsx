import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { FitmentGuard } from "./guard.jsx";

export default async () => {
  render(<FitmentGuard mode="block" />, document.body);
};
