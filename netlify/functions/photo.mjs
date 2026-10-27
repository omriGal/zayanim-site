import { makePhotoHandler } from '../../lib/photos.mjs';

export default makePhotoHandler();
export const config = { path: '/api/photo', rateLimit: { windowLimit: 200, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
