/**
 * Admin GraphQL operations for Fitment Manager.
 *
 * Metafield: custom.compatible_vehicles (type: list.metaobject_reference)
 * Metaobject type: vehicle
 */

export const GET_PRODUCT_FITMENT = `#graphql
  query GetProductFitment($id: ID!, $refsFirst: Int! = 250) {
    product(id: $id) {
      id
      title
      handle
      compatibleVehicles: metafield(namespace: "custom", key: "compatible_vehicles") {
        id
        namespace
        key
        type
        value
        references(first: $refsFirst) {
          totalCount
          nodes {
            ... on Metaobject {
              id
              handle
              type

              vehicle_key: field(key: "vehicle_key") { value }
              display_name: field(key: "display_name") { value }
              engine_code: field(key: "engine_code") { value }
              power_kw: field(key: "power_kw") { value }
              power_hp: field(key: "power_hp") { value }
              body_type: field(key: "body_type") { value }
              year_from: field(key: "year_from") { value }
              year_to: field(key: "year_to") { value }
              fuel_type: field(key: "fuel_type") { value }

              make: field(key: "make") {
                reference {
                  ... on Metaobject {
                    id
                    handle
                    name: field(key: "display_name") { value }
                  }
                }
              }
              model: field(key: "model") {
                reference {
                  ... on Metaobject {
                    id
                    handle
                    name: field(key: "display_name") { value }
                  }
                }
              }
              series: field(key: "series") {
                reference {
                  ... on Metaobject {
                    id
                    handle
                    name: field(key: "display_name") { value }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const SEARCH_VEHICLES = `#graphql
  query SearchVehicles($first: Int! = 50, $after: String, $query: String) {
    metaobjectsByType(type: "vehicle", first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        handle
        vehicle_key: field(key: "vehicle_key") { value }
        display_name: field(key: "display_name") { value }
      }
    }
  }
`;

export const SET_COMPATIBLE_VEHICLES = `#graphql
  mutation SetCompatibleVehicles($ownerId: ID!, $value: String!) {
    metafieldsSet(
      metafields: [
        {
          ownerId: $ownerId
          namespace: "custom"
          key: "compatible_vehicles"
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

