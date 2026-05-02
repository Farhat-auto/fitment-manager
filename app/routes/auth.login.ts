import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { shopify } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return shopify.login(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return shopify.login(request);
}

