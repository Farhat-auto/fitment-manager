/**
 * Admin GraphQL operations for Fitment Manager.
 *
 * Ocean Catalogue / PostgreSQL is the technical vehicle authority
 * (ocean_vehicle_id + product_fitment). Shopify vehicle metaobject queries
 * below are LEGACY READ-ONLY for isolated rollback/audit routes.
 *
 * The normal products list uses compact ocean.fitment_count only.
 */

export const GET_PRODUCT_FITMENT = `#graphql
  query GetProductFitment($id: ID!, $refsFirst: Int! = 250) {
    product(id: $id) {
      id
      title
      handle
      category: metafield(namespace: "custom", key: "catalog_main_category") {
        value
        reference { ... on Metaobject { id displayName } }
      }
      systemGroup: metafield(namespace: "custom", key: "catalog_system_group") {
        value
        reference { ... on Metaobject { id displayName } }
      }
      subcategory: metafield(namespace: "custom", key: "catalog_subcategory") {
        value
        reference { ... on Metaobject { id displayName } }
      }
      fitmentVehicles: metafield(namespace: "fitment", key: "vehicles") {
        id
        namespace
        key
        type
        value
        references(first: $refsFirst) {
          nodes {
            ... on Metaobject {
              id
              handle
              type
              vehicle_key: field(key: "vehicle_key") { value }
              display_name: field(key: "display_name") { value }
            }
          }
        }
      }
    }
  }
`;

export const SEARCH_VEHICLES = `#graphql
  query SearchVehicles($first: Int! = 50, $after: String, $query: String) {
    metaobjects(type: "vehicle", first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        type
        handle
        displayName
        fields {
          key
          value
          reference {
            ... on Metaobject {
              id
              type
              displayName
              name: field(key: "name") { value }
              display_name: field(key: "display_name") { value }
            }
          }
        }
      }
    }
  }
`;

export const LIST_METAOBJECTS_BY_TYPE = `#graphql
  query ListMetaobjectsByType($type: String!, $first: Int! = 25, $after: String) {
    metaobjects(type: $type, first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        type
        handle
        displayName
        fields {
          key
          value
          reference {
            ... on Metaobject {
              id
              type
              displayName
              name: field(key: "name") { value }
              display_name: field(key: "display_name") { value }
            }
          }
        }
      }
    }
  }
`;

/** Labels-only listing for dropdowns. Avoid nested field() aliases that inflate GraphQL cost. */
export const LIST_METAOBJECT_LABELS_BY_TYPE = `#graphql
  query ListMetaobjectLabelsByType($type: String!, $first: Int! = 25, $after: String) {
    metaobjects(type: $type, first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        type
        handle
        displayName
      }
    }
  }
`;

/** Catalog cascade listing: parent references only, no nested name/display_name field() aliases. */
export const LIST_CATALOG_METAOBJECTS = `#graphql
  query ListCatalogMetaobjects($type: String!, $first: Int! = 25, $after: String) {
    metaobjects(type: $type, first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        type
        handle
        displayName
        fields {
          key
          value
          reference {
            ... on Metaobject {
              id
              type
              displayName
            }
          }
        }
      }
    }
  }
`;

/**
 * Theme contract: catalog_system_group.parent_category → catalog_main_category.
 * Aliased field(key:) only — do not pull every metaobject field (that is what throttled the page).
 */
export const LIST_CATALOG_SYSTEM_GROUPS = `#graphql
  query ListCatalogSystemGroups($first: Int! = 50, $after: String) {
    metaobjects(type: "catalog_system_group", first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        displayName
        parent_category: field(key: "parent_category") {
          value
          reference { ... on Metaobject { id type handle } }
        }
        catalog_main_category: field(key: "catalog_main_category") {
          value
          reference { ... on Metaobject { id type handle } }
        }
        main_category: field(key: "main_category") {
          value
          reference { ... on Metaobject { id type handle } }
        }
      }
    }
  }
`;

/**
 * Theme contract: catalog_subcategory.parent_group → catalog_system_group.
 */
export const LIST_CATALOG_SUBCATEGORIES = `#graphql
  query ListCatalogSubcategories($first: Int! = 50, $after: String) {
    metaobjects(type: "catalog_subcategory", first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        displayName
        parent_group: field(key: "parent_group") {
          value
          reference { ... on Metaobject { id type handle } }
        }
        group: field(key: "group") {
          value
          reference { ... on Metaobject { id type handle } }
        }
        system_group: field(key: "system_group") {
          value
          reference { ... on Metaobject { id type handle } }
        }
        catalog_system_group: field(key: "catalog_system_group") {
          value
          reference { ... on Metaobject { id type handle } }
        }
      }
    }
  }
`;

export const SET_FITMENT_VEHICLES = `#graphql
  mutation SetFitmentVehicles($ownerId: ID!, $value: String!) {
    metafieldsSet(
      metafields: [
        {
          ownerId: $ownerId
          namespace: "fitment"
          key: "vehicles"
          type: "list.metaobject_reference"
          value: $value
        }
      ]
    ) {
      metafields {
        id
        namespace
        key
        type
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const GET_PRODUCTS_WITH_FITMENT_COUNT = `#graphql
  query GetProductsWithFitmentCount($first: Int! = 50, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        featuredImage {
          url
          altText
        }
        compatibleVehicles: metafield(namespace: "custom", key: "compatible_vehicles") {
          type
          references(first: 1) {
            totalCount
          }
        }
      }
    }
  }
`;

export const GET_PRODUCT_ID_BY_HANDLE = `#graphql
  query GetProductIdByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      handle
    }
  }
`;

/** Normal products list. Fitment badge is ocean.fitment_count, not Shopify vehicle GIDs. */
export const GET_PRODUCTS_FOR_FITMENT_ADMIN = `#graphql
  query GetProductsForFitmentAdmin($first: Int! = 50, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        vendor
        handle
        featuredImage {
          url
          altText
        }
        variants(first: 1) {
          nodes {
            sku
          }
        }
        article_number: metafield(namespace: "custom", key: "article_number") { value }
        brand: metafield(namespace: "custom", key: "brand") { value }
        oceanFitmentCount: metafield(namespace: "ocean", key: "fitment_count") { value }
        category: metafield(namespace: "custom", key: "catalog_main_category") {
          value
          reference { ... on Metaobject { id displayName } }
        }
        systemGroup: metafield(namespace: "custom", key: "catalog_system_group") {
          value
          reference { ... on Metaobject { id displayName } }
        }
        subcategory: metafield(namespace: "custom", key: "catalog_subcategory") {
          value
          reference { ... on Metaobject { id displayName } }
        }
        oe_references: metafield(namespace: "custom", key: "oe_references") {
          type
          value
          jsonValue
        }
        cross_references: metafield(namespace: "custom", key: "cross_references") {
          type
          value
          jsonValue
        }
        brand_reference: metafield(namespace: "custom", key: "brand_reference") {
          reference {
            ... on Metaobject {
              id
              displayName
            }
          }
        }
        search_index: metafield(namespace: "custom", key: "search_index") {
          value
        }
      }
    }
  }
`;

export const GET_PRODUCT_FOR_FITMENT_EDITOR = `#graphql
  query GetProductForFitmentEditor($handle: String!) {
    productByHandle(handle: $handle) {
      id
      title
      handle
      variants(first: 1) { nodes { sku } }
      article_number: metafield(namespace: "custom", key: "article_number") { value }
      brand: metafield(namespace: "custom", key: "brand") { value }
    }
  }
`;

/**
 * Single product page query. Identity fields follow Shopify product ID → variant ID → SKU → Brand+MPN.
 * Title is display-only. Fitment vehicles are the selected product's references only — not the catalogue.
 */
export const GET_PRODUCT_FOR_FITMENT_PAGE = `#graphql
  query GetProductForFitmentPage($handle: String!, $refsFirst: Int! = 50) {
    productByHandle(handle: $handle) {
      id
      title
      handle
      variants(first: 1) {
        nodes {
          id
          sku
        }
      }
      brand: metafield(namespace: "custom", key: "brand") { value }
      mpn: metafield(namespace: "custom", key: "mpn") { value }
      article_number: metafield(namespace: "custom", key: "article_number") { value }
      category: metafield(namespace: "custom", key: "catalog_main_category") {
        value
        reference { ... on Metaobject { id displayName } }
      }
      systemGroup: metafield(namespace: "custom", key: "catalog_system_group") {
        value
        reference { ... on Metaobject { id displayName } }
      }
      subcategory: metafield(namespace: "custom", key: "catalog_subcategory") {
        value
        reference { ... on Metaobject { id displayName } }
      }
      fitmentVehicles: metafield(namespace: "fitment", key: "vehicles") {
        id
        namespace
        key
        type
        value
        references(first: $refsFirst) {
          pageInfo { hasNextPage }
          nodes {
            ... on Metaobject {
              id
              handle
              type
              vehicle_key: field(key: "vehicle_key") { value }
              display_name: field(key: "display_name") { value }
            }
          }
        }
      }
    }
  }
`;

