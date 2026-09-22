import { render } from "preact";
import { FitmentApp } from "./FitmentApp";

export default async () => {
  render(<FitmentApp mode="block" />, document.body);
};
