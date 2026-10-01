// Local application startup has no dependency on a chat relay or activation.
// Optional installation services provide Studio's invite/update controls.
import {createLocalRuntime} from '../adapters/mcp/src/runtime.mjs';

export async function startDesktop({printsRoot,autoOpen,services}={}) {
  const runtime=createLocalRuntime({printsRoot,autoOpen,relay:services});
  try {
    services?.observeRuntime?.(runtime);
    const studio=await runtime.openStudio();
    return {runtime,studio,stop:async()=>{services?.close?.();await runtime.close();}};
  } catch(error) {
    services?.close?.();
    await runtime.close();
    throw error;
  }
}
