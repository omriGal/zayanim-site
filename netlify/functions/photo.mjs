import { getStore } from '@netlify/blobs';
import { makePhotoHandler } from '../../lib/photos.mjs';
import { storeName } from '../../lib/deployment.mjs';

const blobs = () => getStore({ name: storeName + '-photos', consistency: 'strong' });
const store = {
  get: async name => { const b = await blobs().get(name, { type: 'arrayBuffer' }); return b ? Buffer.from(b) : null; },
  set: (name, body) => blobs().set(name, body),
};

export default makePhotoHandler({ store });
export const config = { path: '/api/photo', rateLimit: { windowLimit: 200, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
