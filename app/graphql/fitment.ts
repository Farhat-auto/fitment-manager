/**
 * Admin GraphQL operations for Fitment Manager.
 *
 * Metafield: fitment.vehicles (type: list.metaobject_reference)
 * Metaobject type: vehicle
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
  query ListMetaobjectsByType($type: String!, $first: Int! = 250, $after: String) {
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
        fitment: metafield(namespace: "fitment", key: "vehicles") {
          value
          jsonValue
        }
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

