import type { HTMLAttributes, DetailedHTMLProps } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "ui-nav-menu": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export {};
