import type { LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useLocation, useNavigate } from "@remix-run/react";
import { Frame, Navigation, TopBar } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return null;
}

export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    {
      label: "Products Fitment",
      url: "/app/products",
    },
    {
      label: "Bulk import (CSV)",
      url: "/app/import",
    },
  ];

  const navigationMarkup = (
    <Navigation location={location.pathname}>
      <Navigation.Section
        items={navItems.map((it) => ({
          label: it.label,
          url: it.url,
          selected: location.pathname === it.url || location.pathname.startsWith(it.url + "/"),
          onClick: () => navigate(it.url),
        }))}
      />
    </Navigation>
  );

  const topBarMarkup = <TopBar showNavigationToggle={false} />;

  return (
    <Frame topBar={topBarMarkup} navigation={navigationMarkup}>
      <Outlet />
    </Frame>
  );
}

