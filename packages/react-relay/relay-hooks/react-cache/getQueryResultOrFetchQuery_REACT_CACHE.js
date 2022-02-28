/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @emails oncall+relay
 * @format
 */

// flowlint ambiguous-object-type:error

'use strict';

import type {
  FetchPolicy,
  IEnvironment,
  OperationDescriptor,
  ReaderFragment,
  RenderPolicy,
} from 'relay-runtime';

const {getCacheForType, getCacheSignal} = require('./RelayReactCache');
const invariant = require('invariant');
const {
  __internal: {fetchQuery: fetchQueryInternal},
} = require('relay-runtime');
const warning = require('warning');

type QueryResult = {|
  fragmentNode: ReaderFragment,
  fragmentRef: mixed,
|};

// Note that the status of a cache entry will be 'resolved' when partial
// rendering is allowed, even if a fetch is ongoing. The pending status
// is specifically to indicate that we should suspend.
type QueryCacheEntry =
  | {|status: 'resolved', result: QueryResult|}
  | {|status: 'pending', promise: Promise<void>|}
  | {|status: 'rejected', error: Error|};

type QueryCache = Map<string, QueryCacheEntry>;

const DEFAULT_FETCH_POLICY = 'store-or-network';

function createQueryCache(): QueryCache {
  return new Map();
}

function getQueryCacheKey(
  operation: OperationDescriptor,
  fetchPolicy: FetchPolicy,
  renderPolicy: RenderPolicy,
): string {
  const cacheIdentifier = `${fetchPolicy}-${renderPolicy}-${operation.request.identifier}`;
  return cacheIdentifier;
}

function constructQueryResult(operation: OperationDescriptor): QueryResult {
  const rootFragmentRef = {
    __id: operation.fragment.dataID,
    __fragments: {
      [operation.fragment.node.name]: operation.request.variables,
    },
    __fragmentOwner: operation.request,
  };
  return {
    fragmentNode: operation.request.node.fragment,
    fragmentRef: rootFragmentRef,
  };
}

function getQueryResultOrFetchQuery_REACT_CACHE(
  environment: IEnvironment,
  queryOperationDescriptor: OperationDescriptor,
  fetchPolicy: FetchPolicy = DEFAULT_FETCH_POLICY,
  maybeRenderPolicy?: RenderPolicy,
): QueryResult {
  const renderPolicy =
    maybeRenderPolicy ?? environment.UNSTABLE_getDefaultRenderPolicy();

  const cache = getCacheForType(createQueryCache);

  const cacheKey = getQueryCacheKey(
    queryOperationDescriptor,
    fetchPolicy,
    renderPolicy,
  );

  let entry = cache.get(cacheKey);
  if (entry === undefined) {
    // Initiate a query to fetch the data if needed:
    entry = onCacheMiss(
      environment,
      queryOperationDescriptor,
      fetchPolicy,
      renderPolicy,
      newCacheEntry => {
        cache.set(cacheKey, newCacheEntry);
      },
    );
    cache.set(cacheKey, entry);

    // Since this is the first time rendering, retain the query. React will
    // trigger the abort signal when this cache entry is no longer needed.
    const retention = environment.retain(queryOperationDescriptor);
    const abortSignal = getCacheSignal();
    abortSignal.addEventListener(
      'abort',
      () => {
        retention.dispose();
        cache.delete(cacheKey);
      },
      {once: true},
    );
  }

  switch (entry.status) {
    case 'pending':
      throw entry.promise;
    case 'rejected':
      throw entry.error;
    case 'resolved':
      return entry.result;
  }
  invariant(false, 'switch statement should be exhaustive');
}

function onCacheMiss(
  environment: IEnvironment,
  operation: OperationDescriptor,
  fetchPolicy: FetchPolicy,
  renderPolicy: RenderPolicy,
  updateCache: QueryCacheEntry => void,
): QueryCacheEntry {
  // NB: Besides checking if the data is available, calling `check` will write missing
  // data to the store using any missing data handlers specified in the environment.
  const queryAvailability = environment.check(operation);
  const queryStatus = queryAvailability.status;
  const hasFullQuery = queryStatus === 'available';
  const canPartialRender =
    hasFullQuery || (renderPolicy === 'partial' && queryStatus !== 'stale');

  let shouldFetch;
  let shouldRenderNow;
  switch (fetchPolicy) {
    case 'store-only': {
      shouldFetch = false;
      shouldRenderNow = true;
      break;
    }
    case 'store-or-network': {
      shouldFetch = !hasFullQuery;
      shouldRenderNow = canPartialRender;
      break;
    }
    case 'store-and-network': {
      shouldFetch = true;
      shouldRenderNow = canPartialRender;
      break;
    }
    case 'network-only':
    default: {
      shouldFetch = true;
      shouldRenderNow = false;
      break;
    }
  }

  const promise = shouldFetch
    ? executeOperationAndKeepUpToDate(environment, operation, updateCache)
    : undefined;
  if (shouldRenderNow) {
    return {status: 'resolved', result: constructQueryResult(operation)};
  } else {
    invariant(
      promise,
      'Should either fetch or render (or both), otherwise we would suspend forever.',
    );
    return {status: 'pending', promise: promise};
  }
}

function executeOperationAndKeepUpToDate(
  environment: IEnvironment,
  operation: OperationDescriptor,
  updateCache: QueryCacheEntry => void,
): Promise<void> {
  let resolvePromise;
  const promise = new Promise(r => {
    resolvePromise = r;
  });
  // $FlowExpectedError[prop-missing] Expando to annotate Promises.
  promise.displayName = 'Relay(' + operation.request.node.operation.name + ')';

  let isFirstPayload = true;

  // FIXME We may still need to cancel network requests for live queries.
  const fetchObservable = fetchQueryInternal(environment, operation);
  fetchObservable.subscribe({
    start: subscription => {},
    error: error => {
      if (isFirstPayload) {
        updateCache({status: 'rejected', error});
      } else {
        // TODO:T92030819 Remove this warning and actually throw the network error
        // To complete this task we need to have a way of precisely tracking suspendable points
        warning(
          false,
          'getQueryResultOrFetchQuery: An incremental payload for query `%` returned an error: `%`:`%`.',
          operation.request.node.operation.name,
          error.message,
          error.stack,
        );
      }
      resolvePromise();
      isFirstPayload = false;
    },
    next: response => {
      // Stop suspending on the first payload because of streaming, defer, etc.
      updateCache({
        status: 'resolved',
        result: constructQueryResult(operation),
      });
      resolvePromise();
      isFirstPayload = false;
    },
    complete: () => {
      updateCache({
        status: 'resolved',
        result: constructQueryResult(operation),
      });
      resolvePromise();
      isFirstPayload = false;
    },
  });

  return promise;
}

module.exports = getQueryResultOrFetchQuery_REACT_CACHE;