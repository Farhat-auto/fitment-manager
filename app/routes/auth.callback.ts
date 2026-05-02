import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  return authenticate.admin(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return authenticate.admin(request);
}

