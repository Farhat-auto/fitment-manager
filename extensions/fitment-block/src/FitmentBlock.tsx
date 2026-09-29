/**
 * Product-page vehicle card.
 * Vehicles and linked products come from Fitment Manager /api/ocean,
 * the same product-fitment records the app edits.
 */
import { reactExtension } from "@shopify/ui-extensions-react/admin";
import { VehicleBar } from "./VehicleBar";

export default reactExtension("admin.product-details.block.render", () => <VehicleBar />);
