/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails oncall+relay
 * @flow strict-local
 * @format
 */

'use strict';

import type {GraphModeChunk} from '../RelayExperimentalGraphResponseTransform';
import type {PayloadData, Variables} from 'relay-runtime';
import type {GraphQLTaggedNode} from 'relay-runtime/query/GraphQLTag';

const {
  normalizeResponse,
} = require('../RelayExperimentalGraphResponseTransform');
const {graphql} = require('relay-runtime');
const {getRequest} = require('relay-runtime/query/GraphQLTag');
const {
  createNormalizationSelector,
} = require('relay-runtime/store/RelayModernSelector');
const {ROOT_ID} = require('relay-runtime/store/RelayStoreUtils');

function applyTransform(
  query: GraphQLTaggedNode,
  response: PayloadData,
  variables: Variables,
): Array<GraphModeChunk> {
  const selector = createNormalizationSelector(
    getRequest(query).operation,
    ROOT_ID,
    variables,
  );
  return Array.from(normalizeResponse(response, selector));
}

test('Basic', () => {
  const query = graphql`
    query RelayExperimentalGraphResponseTransformTestQuery {
      me {
        name
      }
    }
  `;
  const response = {
    me: {
      __typename: 'User',
      name: 'Alice',
      id: '100',
    },
  };

  const actual = applyTransform(query, response, {});
  expect(actual).toMatchInlineSnapshot(`
    Array [
      Object {
        "$kind": "Record",
        "$streamID": 0,
        "__id": "100",
        "__typename": "User",
        "id": "100",
        "name": "Alice",
      },
      Object {
        "$kind": "Record",
        "$streamID": 1,
        "__id": "client:root",
        "__typename": "__Root",
        "me": Object {
          "__id": 0,
        },
      },
      Object {
        "$kind": "Complete",
      },
    ]
  `);
});

test('Merge dupliace fields', () => {
  const query = graphql`
    query RelayExperimentalGraphResponseTransformTestDupesQuery {
      me {
        name
      }
      fetch__User(id: "100") {
        name
        doesViewerLike
      }
    }
  `;
  const response = {
    me: {
      __typename: 'User',
      name: 'Alice',
      id: '100',
    },
    fetch__User: {
      __typename: 'User',
      name: 'Alice',
      id: '100',
      doesViewerLike: true,
    },
  };

  const actual = applyTransform(query, response, {});

  // Note that we only send one `Record` for Alice, and that the second time it's
  // encountered results in an `Extend` which does not duplicate any previously
  // sent fields.
  expect(actual).toMatchInlineSnapshot(`
    Array [
      Object {
        "$kind": "Record",
        "$streamID": 0,
        "__id": "100",
        "__typename": "User",
        "id": "100",
        "name": "Alice",
      },
      Object {
        "$kind": "Extend",
        "$streamID": 0,
        "doesViewerLike": true,
      },
      Object {
        "$kind": "Record",
        "$streamID": 1,
        "__id": "client:root",
        "__typename": "__Root",
        "fetch__User(id:\\"100\\")": Object {
          "__id": 0,
        },
        "me": Object {
          "__id": 0,
        },
      },
      Object {
        "$kind": "Complete",
      },
    ]
  `);
});

test('Omit empty chunks', () => {
  const query = graphql`
    query RelayExperimentalGraphResponseTransformTestEmptyChunkQuery {
      me {
        name
      }
      fetch__User(id: "100") {
        name
      }
    }
  `;
  const response = {
    me: {
      __typename: 'User',
      name: 'Alice',
      id: '100',
    },
    fetch__User: {
      __typename: 'User',
      name: 'Alice',
      id: '100',
    },
  };

  const actual = applyTransform(query, response, {});

  // Note that when we traverse into `fetch__User` we don't emit an additional
  // chunk, since all fields have already been seen in `me`.
  expect(actual).toMatchInlineSnapshot(`
    Array [
      Object {
        "$kind": "Record",
        "$streamID": 0,
        "__id": "100",
        "__typename": "User",
        "id": "100",
        "name": "Alice",
      },
      Object {
        "$kind": "Record",
        "$streamID": 1,
        "__id": "client:root",
        "__typename": "__Root",
        "fetch__User(id:\\"100\\")": Object {
          "__id": 0,
        },
        "me": Object {
          "__id": 0,
        },
      },
      Object {
        "$kind": "Complete",
      },
    ]
  `);
});

test('Object nested within itself', () => {
  const query = graphql`
    query RelayExperimentalGraphResponseTransformTestNestedQuery {
      fetch__User(id: "100") {
        name
        nearest_neighbor {
          subscribeStatus
        }
      }
    }
  `;
  const response = {
    fetch__User: {
      __typename: 'User',
      name: 'Alice',
      id: '100',
      nearest_neighbor: {
        __typename: 'User',
        id: '100',
        subscribeStatus: 'Subbed',
      },
    },
  };

  const actual = applyTransform(query, response, {});

  // Note that we emit the nested `nearest_neighbor` first as a Record, and then
  // later extend it with the parent `fetch__User`.
  expect(actual).toMatchInlineSnapshot(`
    Array [
      Object {
        "$kind": "Record",
        "$streamID": 0,
        "__id": "100",
        "__typename": "User",
        "id": "100",
        "subscribeStatus": "Subbed",
      },
      Object {
        "$kind": "Extend",
        "$streamID": 0,
        "name": "Alice",
        "nearest_neighbor": Object {
          "__id": 0,
        },
      },
      Object {
        "$kind": "Record",
        "$streamID": 1,
        "__id": "client:root",
        "__typename": "__Root",
        "fetch__User(id:\\"100\\")": Object {
          "__id": 0,
        },
      },
      Object {
        "$kind": "Complete",
      },
    ]
  `);
});

test('Null Linked Field', () => {
  const query = graphql`
    query RelayExperimentalGraphResponseTransformTestNullLinkedQuery {
      fetch__User(id: "100") {
        name
      }
    }
  `;
  const response = {
    fetch__User: null,
  };

  const actual = applyTransform(query, response, {});

  expect(actual).toMatchInlineSnapshot(`
    Array [
      Object {
        "$kind": "Record",
        "$streamID": 0,
        "__id": "client:root",
        "__typename": "__Root",
        "fetch__User(id:\\"100\\")": null,
      },
      Object {
        "$kind": "Complete",
      },
    ]
  `);
});

test('Plural Linked Fields', () => {
  const query = graphql`
    query RelayExperimentalGraphResponseTransformTestPluralLinkedQuery {
      me {
        allPhones {
          isVerified
        }
      }
    }
  `;
  const response = {
    me: {
      id: '100',
      __typename: 'User',
      allPhones: [
        {
          __typename: 'Phone',
          isVerified: true,
        },
        {
          __typename: 'Phone',
          isVerified: false,
        },
      ],
    },
  };

  const actual = applyTransform(query, response, {});

  expect(actual).toMatchInlineSnapshot(`
    Array [
      Object {
        "$kind": "Record",
        "$streamID": 0,
        "__id": "client:100:allPhones:0",
        "__typename": "Phone",
        "isVerified": true,
      },
      Object {
        "$kind": "Record",
        "$streamID": 1,
        "__id": "client:100:allPhones:1",
        "__typename": "Phone",
        "isVerified": false,
      },
      Object {
        "$kind": "Record",
        "$streamID": 2,
        "__id": "100",
        "__typename": "User",
        "allPhones": Object {
          "__ids": Array [
            0,
            1,
          ],
        },
        "id": "100",
      },
      Object {
        "$kind": "Record",
        "$streamID": 3,
        "__id": "client:root",
        "__typename": "__Root",
        "me": Object {
          "__id": 2,
        },
      },
      Object {
        "$kind": "Complete",
      },
    ]
  `);
});

test('Plural Scalar Fields', () => {
  const query = graphql`
    query RelayExperimentalGraphResponseTransformTestPluralScalarQuery {
      me {
        emailAddresses
      }
    }
  `;
  const response = {
    me: {
      id: '100',
      __typename: 'User',
      emailAddresses: ['me@example.com', 'me+spam@example.com'],
    },
  };

  const actual = applyTransform(query, response, {});

  expect(actual).toMatchInlineSnapshot(`
    Array [
      Object {
        "$kind": "Record",
        "$streamID": 0,
        "__id": "100",
        "__typename": "User",
        "emailAddresses": Array [
          "me@example.com",
          "me+spam@example.com",
        ],
        "id": "100",
      },
      Object {
        "$kind": "Record",
        "$streamID": 1,
        "__id": "client:root",
        "__typename": "__Root",
        "me": Object {
          "__id": 0,
        },
      },
      Object {
        "$kind": "Complete",
      },
    ]
  `);
});

test('Inline Fragment', () => {
  const query = graphql`
    query RelayExperimentalGraphResponseTransformTestInlineFragmentQuery {
      node(id: "10") {
        ... on User {
          name
        }
      }
    }
  `;
  const response = {
    node: {
      __typename: 'User',
      name: 'Elizabeth',
      id: '10',
    },
  };

  const actual = applyTransform(query, response, {});

  expect(actual).toMatchInlineSnapshot(`
    Array [
      Object {
        "$kind": "Record",
        "$streamID": 0,
        "__id": "10",
        "__typename": "User",
        "id": "10",
        "name": "Elizabeth",
      },
      Object {
        "$kind": "Record",
        "$streamID": 1,
        "__id": "client:root",
        "__typename": "__Root",
        "node(id:\\"10\\")": Object {
          "__id": 0,
        },
      },
      Object {
        "$kind": "Complete",
      },
    ]
  `);
});

test('Inline Fragment on abstract type', () => {
  const query = graphql`
    query RelayExperimentalGraphResponseTransformTestInlineFragmentAbstractTypeQuery {
      node(id: "10") {
        ... on Actor {
          name
        }
        ... on Comment {
          author {
            __typename
          }
        }
      }
    }
  `;
  const response = {
    node: {
      __typename: 'User',
      __isActor: 'User',
      name: 'Elizabeth',
      id: '10',
    },
  };

  const actual = applyTransform(query, response, {});

  expect(actual).toMatchInlineSnapshot(`
    Array [
      Object {
        "$kind": "Record",
        "$streamID": 0,
        "__id": "10",
        "__typename": "User",
        "id": "10",
        "name": "Elizabeth",
      },
      Object {
        "$kind": "Record",
        "$streamID": 1,
        "__id": "client:root",
        "__typename": "__Root",
        "node(id:\\"10\\")": Object {
          "__id": 0,
        },
      },
      Object {
        "$kind": "Complete",
      },
    ]
  `);
});

test('Fragment Spread (gets inlined into `InlineFragment`)', () => {
  graphql`
    fragment RelayExperimentalGraphResponseTransformTest_user_name on User {
      name
    }
  `;
  const query = graphql`
    query RelayExperimentalGraphResponseTransformTestFragmentSpreadQuery {
      node(id: "10") {
        ...RelayExperimentalGraphResponseTransformTest_user_name
      }
    }
  `;
  const response = {
    node: {
      __typename: 'User',
      name: 'Elizabeth',
      id: '10',
    },
  };

  const actual = applyTransform(query, response, {});

  expect(actual).toMatchInlineSnapshot(`
    Array [
      Object {
        "$kind": "Record",
        "$streamID": 0,
        "__id": "10",
        "__typename": "User",
        "id": "10",
        "name": "Elizabeth",
      },
      Object {
        "$kind": "Record",
        "$streamID": 1,
        "__id": "client:root",
        "__typename": "__Root",
        "node(id:\\"10\\")": Object {
          "__id": 0,
        },
      },
      Object {
        "$kind": "Complete",
      },
    ]
  `);
});