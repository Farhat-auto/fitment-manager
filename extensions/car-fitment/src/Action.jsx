import { render } from "preact";
import { FitmentApp } from "./FitmentApp.jsx";

export default async () => {
  render(<FitmentApp mode="action" />, document.body);
};
