/**
 * Product-page vehicle card.
 * Vehicles and linked products come from Fitment Manager /api/ocean,
 * the same product-fitment records the app edits.
 */
import React from "react";
import { reactExtension, Text } from "@shopify/ui-extensions-react/admin";
import { VehicleBar } from "./VehicleBar";

class VehicleBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: "" };

  componentDidCatch(error: Error) {
    this.setState({ error: error?.message || "Vehicle could not be added to this product." });
  }

  render() {
    if (this.state.error) return <Text>{this.state.error}</Text>;
    return this.props.children;
  }
}

export default reactExtension("admin.product-details.block.render", () => (
  <VehicleBoundary>
    <VehicleBar />
  </VehicleBoundary>
));
