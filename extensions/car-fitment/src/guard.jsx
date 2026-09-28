import { Component } from "preact";
import { FitmentApp } from "./FitmentApp.jsx";

function closeAction() {
  try {
    if (typeof shopify !== "undefined" && shopify.close) shopify.close();
  } catch (err) {
    // The host modal may already be closing.
  }
}

export class FitmentGuard extends Component {
  constructor(props) {
    super(props);
    this.state = { error: "" };
  }

  componentDidCatch(error) {
    this.setState({
      error: (error && error.message) || "CAR FITMENT could not open.",
    });
  }

  render() {
    if (this.state.error) {
      if (this.props.mode === "action") {
        return (
          <s-admin-action heading="CAR FITMENT" loading={false}>
            <s-banner tone="critical">{this.state.error}</s-banner>
            <s-button slot="primary-action" onClick={closeAction}>
              Close
            </s-button>
            <s-button slot="secondary-actions" onClick={closeAction}>
              Cancel
            </s-button>
          </s-admin-action>
        );
      }
      return (
        <s-admin-block heading="CAR FITMENT">
          <s-banner tone="critical">{this.state.error}</s-banner>
        </s-admin-block>
      );
    }
    return <FitmentApp mode={this.props.mode} />;
  }
}
