import {writeFileSync} from 'node:fs';
const context=process.env.CONTEXT;
const id=process.env.DEPLOY_ID;
if(!context||!id)throw Error('Netlify build context required');
const storeName=context==='production'?'zayanim-production':'zayanim-preview-'+id;
writeFileSync(new URL('../lib/deployment.mjs',import.meta.url),'export const storeName='+JSON.stringify(storeName)+';\n');
