import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { VehicleSearch } from "./vehicle-search.jsx";

function ProductVehicleSearch() {
  return (
    <s-admin-block heading="Vehicle">
      <VehicleSearch />
    </s-admin-block>
  );
}

export default async () => {
  render(<ProductVehicleSearch />, document.body);
};
