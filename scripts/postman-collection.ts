import { operations } from '../src/openapi.js';

/** Generate examples and response checks from the public API operations. */
export function postmanCollection() {
  return {
    info: { name: 'Task Management API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: [{ key: 'baseUrl', value: 'http://localhost:3000' }],
    item: operations.map(operation => {
      const query = (operation.query ?? []).flatMap(value => value.example === undefined ? [] : [`${encodeURIComponent(value.name)}=${encodeURIComponent(value.example)}`]).join('&');
      return {
        name: operation.summary,
        request: {
          method: operation.method.toUpperCase(),
          url: '{{baseUrl}}' + operation.path.replace(/\{(\w+)\}/g, '{{$1}}') + (query ? `?${query}` : ''),
          auth: operation.auth === false ? { type: 'noauth' } : { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
          description: operation.description ?? operation.summary,
          ...(operation.body ? operation.requestContentType === 'multipart/form-data'
            ? { body: { mode: 'formdata', formdata: [{ key: 'file', type: 'file', src: '' }] } }
            : { header: [{ key: 'Content-Type', value: 'application/json' }], body: { mode: 'raw', raw: JSON.stringify(operation.example ?? {}, null, 2), options: { raw: { language: 'json' } } } }
            : {}),
        },
        event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
          `pm.test('Expected status', function () { pm.response.to.have.status(${operation.status ?? 200}); });`,
          ...(operation.save?.length ? [
            'if (pm.response.code >= 200 && pm.response.code < 300) {',
            '  const data = pm.response.json();',
            ...operation.save.map(save => `  pm.collectionVariables.set(${JSON.stringify(save.variable)}, ${save.path.split('.').reduce((value, key) => `${value}[${JSON.stringify(key)}]`, 'data')});`),
            '}',
          ] : []),
        ] } }],
      };
    }),
  };
}
