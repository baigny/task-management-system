export const openapi = {
  openapi: '3.0.3',
  info: { title: 'Task Management API', version: '1.0.0' },
  servers: [{ url: '/' }],
  paths: {
    '/health': { get: { summary: 'Process health', responses: { 200: { description: 'Healthy' } } } },
  },
};
