// Preload for influence traces: `node --import <this file URL> ...`, or through NODE_OPTIONS so
// workers and child Node processes are traced too (trace.mjs does this). Installs the trace
// runtime as global __T and an in-thread load hook that instruments in-scope SAAM modules.
// $SAAM_TRACE_DIR receives one trace file per thread.
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,relative,sep} from 'node:path';
import {createRuntime} from './runtime.mjs';
import {instrument,inScope} from './instrument.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');

if(!globalThis.__T) {
  const T=globalThis.__T=createRuntime(process.env.SAAM_TRACE_DIR);
  registerHooks({
    load(url,context,nextLoad) {
      const result=nextLoad(url,context);
      if(!url.startsWith('file:')||result.format!=='module'||result.source==null)return result;
      const file=relative(repo,fileURLToPath(url)).split(sep).join('/');
      if(file.startsWith('..')||!inScope(file))return result;
      const text=typeof result.source==='string'?result.source:Buffer.from(result.source).toString('utf8');
      try {
        const {code,counts}=instrument(text,file,{fn:r=>T.fn(r),site:r=>T.site(r)});
        T.instrumentation.modules++;
        for(const [k,v] of Object.entries(counts))T.instrumentation.counts[k]=(T.instrumentation.counts[k]??0)+v;
        return {...result,source:code};
      } catch(error) {
        T.instrumentation.failed.push({file,error:error.message});
        return result;
      }
    }
  });
}
