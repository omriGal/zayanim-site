import {getStore} from '@netlify/blobs';
import {makeHandler} from '../../lib/api.mjs';
import {storeName} from '../../lib/deployment.mjs';
export default makeHandler({storeFor:test=>getStore({name:storeName+(test?'-test':''),consistency:'strong'})});
export const config={path:'/api/list',rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}};
