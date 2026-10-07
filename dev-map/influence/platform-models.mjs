// Declarative models of the platform APIs SAAM uses (plans/dev-maps.md#banned-code: every
// platform API SAAM uses needs a model of its influence, or SAAM does not use it). Data only, with
// a small lookup API, so any analysis engine can apply the same models.
//
// A model says, for one call of the API:
// - out:     what the call returns, as a list of sources (empty: a primitive or nothing).
// - calls:   callbacks it invokes: [{fn: source holding the callable, params: [[sources], ...],
//            this: [sources], when}]. Their results are the source `cb`. `when` is 'sync' (during
//            the call, the default) or 'later' (after it returns: a task, microtask, event, or a
//            later call such as a zod parse); a later callback's result reaches `cb` only through
//            what the API returns (a promise's elements).
// - into:    values it stores into SAAM-visible containers: [{to, from: [sources]}], `to` being
//            'this[]' or 'argN[]' (elements) or 'argN.*' (any field); {to, copy: [sources]} copies
//            the sources' own fields onto `to` (Object.assign).
// - mutates: what it changes without storing a value ('this', 'argN', 'this.signal').
// - observe: what it reads from SAAM-visible values without returning it (a read, for state).
// - effect:  the outside world it changes: fs, network, process, workers, timers, log, gpu,
//            dom, storage, shared-memory, ui. An effect is observable outside the caller.
// - reads:   the outside world it reads: fs, network, clock, random, env, dom, storage.
// - engine:  semantics the engine implements itself (call, apply, bind, promise).
// - correlate: the copying engine's field-name-precise semantics (constraints.mjs correlation
//            tracking: keys, entries, fromEntries); other engines apply the declarative model.
// A constructor's model is {construct: {...}, call: {...}}; in `construct`, `el`, `fields` and
// `any` describe the new instance and `this` is the instance.
//
// Sources: 'this' (receiver), 'argN', 'args' (all), 'argsN+' (from N on), 'cb' (callback
// results), '?' (an unknown platform value), '@family' (a value of a platform family). Suffixes:
// '[]' elements, '.*' any field, '.name' a field. An `into` target is a source ending in '[]', '.*' or '.name'. An object {fresh: type, el, fields, any, copy}
// is a new object the call makes: type is a runtime class path ('Array', 'node:fs.Stats') whose
// prototype it gets, or a family; el/any/fields/copy fill its elements, every field, named
// fields, or a shallow copy of the sources' fields; `deep` makes it a deep copy of one source. In a callback's params, 'number' says the
// position receives only numbers (an index, a typed array element): it carries no object, and a
// computed key built from that parameter stays an element key (keys.mjs). A position without it
// may receive anything.
//
// Families are platform values the analysis has no runtime value for (browser objects, WASM and
// package objects, parsed data). A family member is looked up by method name in its `members`;
// `byName` families fall back to the standard prototypes. Lookup order is in `lookupPlatform`.
import * as nodeFs from 'node:fs';
import * as nodeFsPromises from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as nodeUrl from 'node:url';
import * as nodeCrypto from 'node:crypto';
import * as nodeOs from 'node:os';
import * as nodeChild from 'node:child_process';
import * as nodeWorker from 'node:worker_threads';
import * as nodeHttp from 'node:http';
import * as nodeZlib from 'node:zlib';
import * as nodeUtil from 'node:util';
import * as nodeStream from 'node:stream';
import * as nodeStreamPromises from 'node:stream/promises';
import * as nodeStringDecoder from 'node:string_decoder';
import * as nodeAsyncHooks from 'node:async_hooks';
import * as nodePerfHooks from 'node:perf_hooks';
import * as nodeReadline from 'node:readline';
import * as nodeAssertStrict from 'node:assert/strict';
import * as nodeEvents from 'node:events';
import * as nodeTimers from 'node:timers';
import * as nodeNet from 'node:net';

const NODE={'node:fs':nodeFs,'node:fs/promises':nodeFsPromises,'node:path':nodePath,'node:url':nodeUrl,'node:crypto':nodeCrypto,
  'node:os':nodeOs,'node:child_process':nodeChild,'node:worker_threads':nodeWorker,'node:http':nodeHttp,'node:zlib':nodeZlib,
  'node:util':nodeUtil,'node:stream':nodeStream,'node:stream/promises':nodeStreamPromises,'node:string_decoder':nodeStringDecoder,
  'node:async_hooks':nodeAsyncHooks,'node:perf_hooks':nodePerfHooks,'node:readline':nodeReadline,'node:assert/strict':nodeAssertStrict,
  'node:events':nodeEvents,'node:timers':nodeTimers,'node:net':nodeNet};
const SPECIAL_ROOTS={TypedArray:Object.getPrototypeOf(Uint8Array)};

// --- helpers for writing models ----------------------------------------------------------------
const P=Object.freeze({});                                   // returns a primitive, touches nothing
const fresh=(type,el=[],more={})=>({fresh:type,el,...more});
const arr=(...el)=>fresh('Array',el);
const iter=(...el)=>fresh('Iterator',el);
const promise=(...el)=>fresh('Promise',el);
const json=(...copy)=>({fresh:'json',copy,el:copy.map(c=>c+'[]')});
// A deep copy of the source (structuredClone): fresh objects all the way down, holding no object of
// the source. Engines without deep copies apply `copy` and `el` (shallow: the nested values shared).
const deep=source=>({...json(source),deep:source});
const done={out:[promise()]};                                // a promise of completion only
const EACH=[['this[]'],['number'],['this']];
const EACH_NUMBER=[['number'],['number'],['this']];
// A zod parse runs the callbacks kept in the schema and the schemas nested in it, with the input.
const PARSE=['this[]','this[][]','this[][][]','this[][][][]'].map(fn=>({fn,params:[['arg0','arg0.*','arg0[]'],['?']]}));                         // (element, index, receiver)
const each=(more={},params=EACH)=>({calls:[{fn:'arg0',params,this:['arg1']}],...more});
// Expands {'a b c': model} into {a: model, b: model, c: model}, with an optional path prefix.
function group(prefix,table) {
  const out={};
  for(const [names,model] of Object.entries(table))for(const n of names.split(/\s+/).filter(Boolean))out[prefix+n]=model;
  return out;
}

// --- JavaScript built-ins ----------------------------------------------------------------------
const ARRAY_METHODS={
  'at pop shift':{out:['this[]']},
  'concat':{out:[arr('this[]','args','args[]')]},
  'copyWithin':{out:['this'],mutates:['this']},
  'entries':{out:[iter(arr('this[]'))]},
  'keys':{out:[iter()]},
  'values':{out:[iter('this[]')]},
  'every some findIndex findLastIndex forEach':each(),
  'fill':{out:['this'],into:[{to:'this[]',from:['arg0']}]},
  'filter':each({out:[arr('this[]')]}),
  'find findLast':each({out:['this[]']}),
  'flat':{out:[arr('this[]','this[][]','this[][][]')]},
  'flatMap':each({out:[arr('cb','cb[]')]}),
  'map':each({out:[arr('cb')]}),
  'includes indexOf lastIndexOf join toString toLocaleString':P,
  'push unshift':{into:[{to:'this[]',from:['args']}]},
  'reduce reduceRight':{out:['cb','arg1'],calls:[{fn:'arg0',params:[['cb','arg1','this[]'],['this[]'],['number'],['this']]}]},
  'reverse':{out:['this'],mutates:['this']},
  'sort':{out:['this'],mutates:['this'],calls:[{fn:'arg0',params:[['this[]'],['this[]']]}]},
  'slice toReversed':{out:[arr('this[]')]},
  'toSorted':{out:[arr('this[]')],calls:[{fn:'arg0',params:[['this[]'],['this[]']]}]},
  'splice':{out:[arr('this[]')],mutates:['this'],into:[{to:'this[]',from:['args2+']}]},
  'with toSpliced':{out:[arr('this[]','args')]}
};
// Typed arrays hold numbers: results are fresh typed arrays and elements carry nothing.
const TYPED_METHODS={
  'at includes indexOf lastIndexOf join toString toLocaleString':P,
  'every some findIndex findLastIndex forEach find findLast':each({},EACH_NUMBER),
  'filter map':each({out:[fresh('TypedArray')]},EACH_NUMBER),
  'slice toReversed with':{out:[fresh('TypedArray')]},
  'toSorted':{out:[fresh('TypedArray')],calls:[{fn:'arg0',params:[['number'],['number']]}]},
  'sort':{out:['this'],mutates:['this'],calls:[{fn:'arg0',params:[['number'],['number']]}]},
  'reverse fill copyWithin set':{out:['this'],mutates:['this']},
  'reduce reduceRight':{out:['cb','arg1'],calls:[{fn:'arg0',params:[['cb','arg1'],['number'],['number'],['this']]}]},
  'subarray':{out:['this'],note:'A view on the same buffer: writes through it are writes to the receiver.'},
  'entries':{out:[iter(arr())]},'keys values':{out:[iter()]}
};
const ITERATOR_METHODS={
  'map':each({out:[iter('cb')]}),'filter':each({out:[iter('this[]')]}),'flatMap':each({out:[iter('cb[]')]}),
  'take drop':{out:[iter('this[]')]},'toArray':{out:[arr('this[]')]},'next':{out:[fresh('Object',[],{fields:{value:['this[]']}})],mutates:['this']},
  'forEach some every':each(),'find':each({out:['this[]']}),
  'reduce':{out:['cb','arg1'],calls:[{fn:'arg0',params:[['cb','arg1','this[]'],['this[]']]}]}
};
// A map's elements are its entries, as iterating it gives them: [key, value] pairs whose `#key`
// and `#value` fields hold the key and the value apart, so reading values never yields keys.
const entry=(keys,values)=>fresh('Array',[...keys,...values],{fields:{'#key':keys,'#value':values}});
const MAP_METHODS={
  'get':{out:['this[].#value']},
  'set':{out:['this'],into:[{to:'this[].#key',from:['arg0']},{to:'this[].#value',from:['arg1']},{to:'this[][]',from:['arg0','arg1']}]},
  'has':{observe:['this[].#key']},
  'delete clear':{mutates:['this']},
  'keys':{out:[iter('this[].#key')]},'values':{out:[iter('this[].#value')]},
  'entries':{out:[iter('this[]')]},
  'forEach':{calls:[{fn:'arg0',params:[['this[].#value'],['this[].#key'],['this']]}]}
};
const SET_METHODS={
  'add':{out:['this'],into:[{to:'this[]',from:['arg0']}]},
  'has':{observe:['this[]']},
  'delete clear':{mutates:['this']},
  'keys values':{out:[iter('this[]')]},
  'entries':{out:[iter(arr('this[]'))]},
  'forEach':{calls:[{fn:'arg0',params:[['this[]'],['this[]'],['this']]}]}
};
const ERROR={construct:{fields:{cause:['arg1.cause'],errors:['arg0']}},call:{out:[fresh('Error',[],{fields:{cause:['arg1.cause']}})]}};
const EMITTER={
  'on once addListener prependListener prependOnceListener':{out:['this'],mutates:['this'],calls:[{fn:'arg1',params:[['?'],['?']],when:'later'}],
    note:'Registers a listener the emitter invokes later with event data (for a Worker or MessagePort, the structured clone the other end posted).'},
  'off removeListener removeAllListeners setMaxListeners':{out:['this'],mutates:['this']},
  'emit':{mutates:['this'],note:'Invokes listeners registered on the same emitter.'},
  'listenerCount eventNames getMaxListeners':P,'listeners rawListeners':{out:[arr()]}
};

export const MODELS={
  // Language and core objects.
  ...group('Object.',{
    'keys':{out:[arr()],correlate:'keys'},
    'getOwnPropertyNames getOwnPropertySymbols':{out:[arr()]},
    'values':{out:[arr('arg0.*')]},
    'entries':{out:[arr(arr('arg0.*'))],correlate:'entries'},
    'fromEntries':{out:[fresh('Object',[],{any:['arg0[][]']})],correlate:'fromEntries'},
    'assign':{out:['arg0'],into:[{to:'arg0',copy:['args1+']}]},
    'freeze seal preventExtensions':{out:['arg0'],note:'Changes only integrity flags, which SAAM never reads back.'},
    'isFrozen isSealed isExtensible is hasOwn':P,
    'getPrototypeOf':{out:['arg0.__proto__']},
    'defineProperty':{engine:'defineProperty',
      note:'The field named by arg1 (every field when the analysis cannot name it) takes the descriptor value; a getter runs when it is read and gives its value, a setter runs when it is written.'},
    'defineProperties':{engine:'defineProperties',note:'As defineProperty, for each descriptor.'},
    'create':{out:[fresh('Object',[],{fields:{__proto__:['arg0']},any:['arg1.*.value']})]},
    'getOwnPropertyDescriptors':{engine:'descriptors',note:'A fresh object with one data descriptor per field of arg0, its value that field (accessors, which SAAM reads only through defineProperties, are their current values).'}
  }),
  ...group('Object.prototype.',{'hasOwnProperty isPrototypeOf propertyIsEnumerable toString toLocaleString':P,'valueOf':{out:['this']}}),
  'Function.prototype.call':{engine:'call'},'Function.prototype.apply':{engine:'apply'},'Function.prototype.bind':{engine:'bind'},
  'Function.prototype.toString':P,
  'Array':{construct:{el:['args']},call:{out:[arr('args')]}},
  'Array.isArray':P,
  'Array.from':{out:[arr('arg0[]','cb')],calls:[{fn:'arg1',params:[['arg0[]'],['number']]}]},
  'Array.of':{out:[arr('args')]},
  ...group('Array.prototype.',ARRAY_METHODS),
  ...group('TypedArray.prototype.',TYPED_METHODS),
  'TypedArray.from':{out:[fresh('TypedArray')],calls:[{fn:'arg1',params:[['arg0[]'],['number']]}]},
  'TypedArray.of':{out:[fresh('TypedArray')]},
  ...Object.fromEntries(['Float64Array','Float32Array','Int32Array','Uint32Array','Int16Array','Uint16Array','Int8Array','Uint8Array','Uint8ClampedArray','BigInt64Array','BigUint64Array']
    .map(n=>[n,{construct:{},note:'A copy of an array argument, or a view on a buffer argument (buffer sharing is not modelled).'}])),
  'ArrayBuffer':{construct:{}},'ArrayBuffer.isView':P,'SharedArrayBuffer':{construct:{}},
  'DataView':{construct:{},note:'A view on a buffer (buffer sharing is not modelled).'},
  ...group('DataView.prototype.',{'getInt8 getUint8 getInt16 getUint16 getInt32 getUint32 getFloat32 getFloat64 getBigInt64 getBigUint64':P,
    'setInt8 setUint8 setInt16 setUint16 setInt32 setUint32 setFloat32 setFloat64 setBigInt64 setBigUint64':{mutates:['this']}}),
  'Iterator.from':{out:[iter('arg0[]')]},
  ...group('Iterator.prototype.',ITERATOR_METHODS),
  'Map':{construct:{el:[entry(['arg0[][]'],['arg0[][]'])]}},'Map.groupBy':{out:[fresh('Map',[entry(['cb'],[arr('arg0[]')])])],calls:[{fn:'arg1',params:[['arg0[]'],[]]}]},
  ...group('Map.prototype.',MAP_METHODS),
  'WeakMap':{construct:{el:[entry(['arg0[][]'],['arg0[][]'])]}},
  ...group('WeakMap.prototype.',{'get':MAP_METHODS.get,'set':MAP_METHODS.set,'has':MAP_METHODS.has,'delete':{mutates:['this']}}),
  'Set':{construct:{el:['arg0[]']}},
  ...group('Set.prototype.',SET_METHODS),
  'WeakSet':{construct:{el:['arg0[]']}},
  ...group('WeakSet.prototype.',{'add':SET_METHODS.add,'has':SET_METHODS.has,'delete':{mutates:['this']}}),
  'Promise':{construct:{engine:'promise',note:'Invokes the executor synchronously with a resolve function; values passed to resolve become the promise elements.'}},
  'Promise.resolve':{out:[promise('arg0','arg0[]')]},
  'Promise.reject':{out:[promise()]},
  'Promise.all':{out:[promise(arr('arg0[]','arg0[][]'))]},
  'Promise.allSettled':{out:[promise(arr(fresh('Object',[],{fields:{value:['arg0[]','arg0[][]'],reason:['?']}})))]},
  'Promise.withResolvers':{out:[fresh('Object',[],{fields:{promise:[promise()],resolve:['?'],reject:['?']}})],note:'Resolving through the returned function is not modelled.'},
  'Promise.prototype.then':{out:[promise('cb','cb[]')],calls:[{fn:'arg0',params:[['this[]']],when:'later'},{fn:'arg1',params:[['?']],when:'later'}]},
  'Promise.prototype.catch':{out:[promise('this[]','cb','cb[]')],calls:[{fn:'arg0',params:[['?']],when:'later'}]},
  'Promise.prototype.finally':{out:[promise('this[]')],calls:[{fn:'arg0',params:[],when:'later'}]},
  'JSON.parse':{out:[fresh('json')],calls:[{fn:'arg1',params:[[],['?']]}]},
  'JSON.stringify':{observe:['arg0.*','arg0[]'],calls:[{fn:'arg1',params:[[],['arg0','arg0.*','arg0[]']]}],
    note:'Invokes toJSON methods of the values it serialises (not modelled; SAAM defines none).'},
  ...group('Math.',{'abs acos acosh asin asinh atan atan2 atanh cbrt ceil clz32 cos cosh exp expm1 floor fround hypot imul log log10 log1p log2 max min pow round sign sin sinh sqrt tan tanh trunc':P,
    'random':{reads:'random'}}),
  'Number':{call:P,construct:{}},
  ...group('Number.',{'isFinite isInteger isNaN isSafeInteger parseFloat parseInt':P}),
  ...group('Number.prototype.',{'toFixed toPrecision toString toExponential toLocaleString valueOf':P}),
  'Boolean':{call:P},'BigInt':{call:P},'Symbol':{call:P},'Symbol.for':P,
  ...group('Boolean.prototype.',{'toString valueOf':P}),...group('BigInt.prototype.',{'toString valueOf toLocaleString':P}),
  ...group('Symbol.prototype.',{'toString valueOf':P}),
  'String':{call:P,construct:{}},
  ...group('String.',{'fromCharCode fromCodePoint raw':P}),
  ...group('String.prototype.',{
    'at charAt charCodeAt codePointAt concat endsWith includes indexOf lastIndexOf localeCompare normalize padEnd padStart repeat slice startsWith substring substr toLowerCase toUpperCase toLocaleLowerCase toLocaleUpperCase toString trim trimEnd trimStart valueOf isWellFormed toWellFormed search':P,
    'split':{out:[arr()]},'match':{out:[arr()]},'matchAll':{out:[iter(arr())]},
    'replace replaceAll':{calls:[{fn:'arg1',params:[[],[],[],[],[]]}]}
  }),
  'RegExp':{construct:{},call:{out:[fresh('RegExp')]}},
  'RegExp.prototype.test':{mutates:['this'],note:'Advances lastIndex of global expressions.'},
  'RegExp.prototype.exec':{out:[arr()],mutates:['this']},
  'Date':{construct:{reads:'clock'},call:{reads:'clock'}},
  'Date.now':{reads:'clock'},'Date.parse':P,'Date.UTC':P,
  ...group('Date.prototype.',{'getTime valueOf toISOString toJSON toString toLocaleString toLocaleDateString toLocaleTimeString getFullYear getMonth getDate getDay getHours getMinutes getSeconds getMilliseconds getUTCFullYear getUTCMonth getUTCDate getUTCHours getUTCMinutes getUTCSeconds getTimezoneOffset toUTCString toDateString':P}),
  'Error':ERROR,'TypeError':ERROR,'RangeError':ERROR,'SyntaxError':ERROR,'AggregateError':ERROR,'DOMException':ERROR,
  'Error.captureStackTrace':{mutates:['arg0']},
  'structuredClone':{out:[deep('arg0')],note:'A deep copy: fresh objects holding copies of the nested values (constraints.mjs deepCopy).'},
  ...group('',{'isNaN isFinite parseInt parseFloat encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape':P}),
  ...group('Atomics.',{'load isLockFree':{reads:'shared-memory'},'wait waitAsync':{reads:'shared-memory'},
    'store add sub and or xor exchange compareExchange notify':{mutates:['arg0'],effect:'shared-memory'}}),

  // Timers, console and other host globals common to Node and browsers.
  'setImmediate':{out:[fresh('Timeout')],calls:[{fn:'arg0',params:[['args1+']],when:'later'}],effect:'timers'},
  'queueMicrotask':{calls:[{fn:'arg0',params:[],when:'later'}],effect:'timers'},
  ...group('Timeout.prototype.',{'unref ref refresh':{out:['this'],effect:'timers'},'hasRef':P}),
  ...group('console.',{'log error warn info debug trace table dir time timeEnd group groupEnd assert count':{effect:'log'}}),
  'fetch':{out:[promise(fresh('Response'))],effect:'network',reads:'network',note:'Sends a request; its body is the request influence.',observe:['arg1.*']},
  ...group('Response.prototype.',{'json':{out:[promise(fresh('json'))],mutates:['this']},'text':{out:[promise()],mutates:['this']},
    'arrayBuffer bytes':{out:[promise(fresh('ArrayBuffer'))],mutates:['this']},'blob':{out:[promise(fresh('Blob'))],mutates:['this']},
    'clone':{out:[fresh('Response')]}}),
  'Response':{construct:{el:['arg0']}},'Request':{construct:{el:['arg0','arg1.*']}},'Headers':{construct:{el:['arg0.*']}},
  ...group('Headers.prototype.',{'get has':P,'set append delete':{mutates:['this']},'entries keys values':{out:[iter(arr())]},'forEach':{calls:[{fn:'arg0',params:[[],[]]}]}}),
  ...group('ReadableStream.prototype.',{'getReader':{out:[fresh('ReadableStreamDefaultReader')],mutates:['this']},'cancel':{out:[promise()],mutates:['this']},
    'pipeTo':{out:[promise()],mutates:['this','arg0']},'tee':{out:[arr(fresh('ReadableStream'))]}}),
  ...group('ReadableStreamDefaultReader.prototype.',{'read':{out:[promise(fresh('Object',[],{fields:{value:[fresh('TypedArray')]}}))],mutates:['this'],reads:'network'},
    'releaseLock cancel':{out:[promise()],mutates:['this']}}),
  'URL':{construct:{}},'URL.canParse':P,'URL.createObjectURL':{effect:'dom',observe:['arg0']},'URL.revokeObjectURL':{effect:'dom'},
  ...group('URL.prototype.',{'toString toJSON':P}),
  'URLSearchParams':{construct:{}},
  ...group('URLSearchParams.prototype.',{'get getAll has toString':P,'set append delete sort':{mutates:['this']},'entries keys values':{out:[iter(arr())]},
    'forEach':{calls:[{fn:'arg0',params:[[],[]]}]}}),
  'TextEncoder':{construct:{}},'TextEncoder.prototype.encode':{out:[fresh('TypedArray')]},'TextEncoder.prototype.encodeInto':{mutates:['arg1']},
  'TextDecoder':{construct:{}},'TextDecoder.prototype.decode':P,
  'Blob':{construct:{el:['arg0[]']}},
  ...group('Blob.prototype.',{'text':{out:[promise()]},'arrayBuffer bytes':{out:[promise(fresh('ArrayBuffer'))]},'slice':{out:[fresh('Blob',['this[]'])]}}),
  'AbortController':{construct:{fields:{signal:[fresh('AbortSignal')]}}},
  'AbortController.prototype.abort':{mutates:['this.signal'],note:'Aborts the signal: readers of the signal and its abort listeners observe it.'},
  'AbortSignal.timeout':{out:[fresh('AbortSignal')],effect:'timers'},'AbortSignal.any':{out:[fresh('AbortSignal',['arg0[]'])]},
  'AbortSignal.abort':{out:[fresh('AbortSignal')]},
  'AbortSignal.prototype.throwIfAborted':{observe:['this.aborted']},
  ...group('EventTarget.prototype.',{'addEventListener':{mutates:['this'],calls:[{fn:'arg1',params:[[fresh('Event')]],when:'later'}]},
    'removeEventListener':{mutates:['this']},'dispatchEvent':{mutates:['this'],observe:['arg0.*'],note:'Invokes listeners registered on the same target.'}}),
  'Event':{construct:{}},'CustomEvent':{construct:{fields:{detail:['arg1.detail']}}},
  ...group('Event.prototype.',{'preventDefault stopPropagation stopImmediatePropagation':{mutates:['this']},'composedPath':{out:[arr()]}}),
  'crypto.randomUUID':{reads:'random'},'crypto.getRandomValues':{out:['arg0'],mutates:['arg0'],reads:'random'},
  'SubtleCrypto.prototype.digest':{out:[promise(fresh('ArrayBuffer'))]},
  'performance.now':{reads:'clock'},
  'Performance.prototype.now':{reads:'clock'},
  'MessagePort.prototype.postMessage':{effect:'workers',observe:['arg0.*','arg0[]'],note:'Sends a structured clone to the other end of the channel.'},
  ...group('MessagePort.prototype.',{'on once addListener':EMITTER['on once addListener prependListener prependOnceListener'],'off removeListener':{out:['this'],mutates:['this']},
    'start ref unref close':{mutates:['this'],effect:'workers'}}),

  // Browser-only globals (no runtime value in the analysis; their objects are the dom family).
  'requestAnimationFrame':{calls:[{fn:'arg0',params:[[]],when:'later'}],effect:'timers'},
  'cancelAnimationFrame':{effect:'timers'},
  'confirm':{effect:'ui',reads:'ui'},'alert':{effect:'ui'},'prompt':{effect:'ui',reads:'ui'},
  'getComputedStyle':{out:['@dom'],reads:'dom'},
  'ResizeObserver':{construct:{calls:[{fn:'arg0',params:[[arr('@dom')],['this']],when:'later'}]}},
  'EventSource':{construct:{effect:'network',reads:'network'}},
  'Image':{construct:{}},
  'Worker':{construct:{effect:'workers',note:'A browser worker running the module arg0.'}},

  // Node built-ins.
  ...group('node:path.',{'resolve join dirname basename extname relative isAbsolute normalize format toNamespacedPath matchesGlob':P,'parse':{out:[fresh('Object')]}}),
  ...group('node:path.posix.',{'resolve join dirname basename extname relative isAbsolute normalize format toNamespacedPath':P,'parse':{out:[fresh('Object')]}}),
  ...group('node:url.',{'fileURLToPath':P,'pathToFileURL':{out:[fresh('URL')]}}),
  ...group('node:fs/promises.',{
    'readFile':{out:[promise(fresh('Buffer'))],reads:'fs'},
    'writeFile appendFile':{out:[promise()],effect:'fs',observe:['arg1']},
    'mkdir rm rmdir unlink rename copyFile cp symlink link chmod chown utimes truncate':{out:[promise()],effect:'fs'},
    'mkdtemp':{out:[promise()],effect:'fs'},
    'stat lstat':{out:[promise(fresh('node:fs.Stats'))],reads:'fs'},
    'readdir':{out:[promise(arr(fresh('node:fs.Dirent')))],reads:'fs'},
    'realpath access readlink':{out:[promise()],reads:'fs'},
    'open':{out:[promise(fresh('filehandle'))],effect:'fs',reads:'fs'}
  }),
  ...group('node:fs.',{
    'readFileSync':{out:[fresh('Buffer')],reads:'fs'},
    'existsSync accessSync realpathSync':{reads:'fs'},
    'statSync lstatSync':{out:[fresh('node:fs.Stats')],reads:'fs'},
    'readdirSync':{out:[arr(fresh('node:fs.Dirent'))],reads:'fs'},
    'writeFileSync appendFileSync mkdirSync rmSync unlinkSync renameSync copyFileSync':{effect:'fs'},
    'createReadStream':{out:[fresh('node:fs.ReadStream')],reads:'fs'},
    'createWriteStream':{out:[fresh('node:fs.WriteStream')],effect:'fs'},
    'watch':{out:[fresh('node:events.EventEmitter')],calls:[{fn:'arg1',params:[[],[]],when:'later'},{fn:'arg2',params:[[],[]],when:'later'}],reads:'fs'}
  }),
  ...group('node:fs.Stats.prototype.',{'isDirectory isFile isSymbolicLink isFIFO isSocket isBlockDevice isCharacterDevice':P}),
  ...group('node:fs.Dirent.prototype.',{'isDirectory isFile isSymbolicLink isFIFO isSocket isBlockDevice isCharacterDevice':P}),
  ...group('node:fs.FSWatcher.prototype.',{'close':{mutates:['this'],effect:'fs'},'ref unref':{out:['this'],effect:'process'}}),
  ...group('node:events.EventEmitter.prototype.',EMITTER),
  ...group('node:stream.Readable.prototype.',{'pipe':{out:['arg0'],mutates:['this','arg0']},'read':{out:[fresh('Buffer')],mutates:['this']},
    'setEncoding pause resume destroy':{out:['this'],mutates:['this']},'unpipe':{out:['this'],mutates:['this']}}),
  ...group('node:stream.Writable.prototype.',{'write':{mutates:['this'],observe:['arg0'],effect:'fs',note:'Writes to its destination (a file, socket, pipe or the terminal).'},
    'end':{mutates:['this'],observe:['arg0'],effect:'fs'},'destroy cork uncork setDefaultEncoding':{out:['this'],mutates:['this']}}),
  ...group('node:crypto.',{'createHash':{out:[fresh('node:crypto.Hash')]},'randomUUID randomInt':{reads:'random'},'randomBytes':{out:[fresh('Buffer')],reads:'random'},
    'timingSafeEqual':P}),
  ...group('node:crypto.Hash.prototype.',{'update':{out:['this'],mutates:['this']},'digest':P,'copy':{out:[fresh('node:crypto.Hash')]}}),
  ...group('node:os.',{'tmpdir homedir platform arch type release hostname cpus totalmem freemem availableParallelism userInfo EOL':{reads:'env'}}),
  ...group('node:child_process.',{
    'spawn':{out:[fresh('node:child_process.ChildProcess',[],{fields:{stdout:[fresh('node:stream.Readable')],stderr:[fresh('node:stream.Readable')],stdin:[fresh('node:stream.Writable')]}})],effect:'process',reads:'process'},
    'spawnSync':{out:[fresh('Object',[],{fields:{stdout:[fresh('Buffer')],stderr:[fresh('Buffer')],error:['?']}})],effect:'process',reads:'process'},
    'execFileSync execSync':{out:[fresh('Buffer')],effect:'process',reads:'process'},
    'execFile exec':{out:[fresh('node:child_process.ChildProcess')],calls:[{fn:'args',params:[['?'],['?'],['?']],when:'later'}],effect:'process',reads:'process'}
  }),
  ...group('node:child_process.ChildProcess.prototype.',{'kill disconnect':{mutates:['this'],effect:'process'},'ref unref':{mutates:['this'],effect:'process'},
    'send':{mutates:['this'],observe:['arg0.*'],effect:'process'}}),
  'node:worker_threads.Worker':{construct:{effect:'workers',note:'Starts the module arg0 in a thread; messages cross through postMessage and message listeners.'}},
  ...group('node:worker_threads.Worker.prototype.',{'postMessage':{effect:'workers',observe:['arg0.*','arg0[]']},'terminate':{out:[promise()],mutates:['this'],effect:'workers'},
    'ref unref':{mutates:['this'],effect:'process'}}),
  ...group('node:http.',{'createServer':{out:[fresh('node:http.Server')],calls:[{fn:'args',params:[[fresh('node:http.IncomingMessage',[],{fields:{headers:[fresh('json')]}})],[fresh('node:http.ServerResponse')]],when:'later'}]}}),
  ...group('node:http.Server.prototype.',{'listen':{out:['this'],mutates:['this'],effect:'network',calls:[{fn:'args',params:[],when:'later'}]},
    'close closeAllConnections closeIdleConnections':{out:['this'],mutates:['this'],effect:'network',calls:[{fn:'arg0',params:[['?']],when:'later'}]},
    'address':{out:[fresh('Object')],reads:'network'}}),
  ...group('node:http.ServerResponse.prototype.',{'writeHead setHeader removeHeader flushHeaders':{out:['this'],mutates:['this'],effect:'network'},
    'getHeader hasHeader':P,
    'write end':{out:['this'],mutates:['this'],observe:['arg0'],effect:'network'}}),
  ...group('node:stream.Readable.prototype.',{'on once addListener':EMITTER['on once addListener prependListener prependOnceListener'],'removeListener off':{out:['this'],mutates:['this']}}),
  ...group('node:net.Socket.prototype.',{'end destroy':{out:['this'],mutates:['this'],effect:'network'},'setTimeout setNoDelay setKeepAlive':{out:['this'],mutates:['this']}}),
  ...group('node:zlib.',{'deflateRawSync inflateRawSync deflateSync inflateSync gzipSync gunzipSync brotliCompressSync brotliDecompressSync':{out:[fresh('Buffer')]},
    'crc32':P}),
  ...group('node:util.',{'promisify':{out:['?'],note:'Returns a function that calls arg0; calls through it are not modelled.'},
    'parseArgs':{out:[fresh('json')]},'inspect format':P,'isDeepStrictEqual':P}),
  'node:stream/promises.pipeline':{out:[promise()],mutates:['args']},
  'node:string_decoder.StringDecoder':{construct:{}},
  ...group('node:string_decoder.StringDecoder.prototype.',{'write end':{mutates:['this']}}),
  'node:async_hooks.AsyncLocalStorage':{construct:{}},
  ...group('node:async_hooks.AsyncLocalStorage.prototype.',{'run':{out:['cb'],into:[{to:'this[]',from:['arg0']}],calls:[{fn:'arg1',params:[['args2+']]}]},
    'getStore':{out:['this[]']},'enterWith':{into:[{to:'this[]',from:['arg0']}]},'disable exit':{mutates:['this']}}),
  'node:perf_hooks.performance.now':{reads:'clock'},
  'node:readline.createInterface':{out:[fresh('node:readline.Interface')],observe:['arg0.*']},
  ...group('node:readline.Interface.prototype.',{'close':{mutates:['this']},'question':{calls:[{fn:'arg1',params:[[]],when:'later'}],effect:'ui',reads:'ui'}}),
  ...group('node:assert/strict.',{'equal notEqual ok deepEqual notDeepEqual strictEqual deepStrictEqual match throws rejects fail':P}),
  ...group('node:assert/strict.default.',{'equal notEqual ok deepEqual notDeepEqual strictEqual deepStrictEqual match throws rejects fail':P}),
  ...group('Buffer.',{'from alloc allocUnsafe concat':{out:[fresh('Buffer')]},'isBuffer byteLength compare isEncoding':P}),
  ...group('Buffer.prototype.',{
    'readUInt8 readUInt16LE readUInt16BE readUInt32LE readUInt32BE readInt8 readInt16LE readInt16BE readInt32LE readInt32BE readFloatLE readFloatBE readDoubleLE readDoubleBE readBigUInt64LE readBigInt64LE toString toJSON equals compare indexOf includes':P,
    'writeUInt8 writeUInt16LE writeUInt16BE writeUInt32LE writeUInt32BE writeInt8 writeInt16LE writeInt16BE writeInt32LE writeInt32BE writeFloatLE writeFloatBE writeDoubleLE writeDoubleBE writeBigUInt64LE writeBigInt64LE write fill':{mutates:['this']},
    'slice subarray':{out:['this']},'copy':{mutates:['arg0']}
  }),
  ...group('process.',{
    'cwd uptime memoryUsage cpuUsage hrtime':{reads:'process'},
    'kill':{effect:'process'},'exit abort chdir':{effect:'process'},'emitWarning':{effect:'log'},
    'nextTick':{calls:[{fn:'arg0',params:[['args1+']],when:'later'}],effect:'timers'}
  }),
  'process.hrtime.bigint':{reads:'clock'}
};
Object.assign(MODELS,
  group('Promise.',{'race any':{out:[promise('arg0[]','arg0[][]')]}}),
  group('',{'setTimeout setInterval':{out:[fresh('Timeout')],calls:[{fn:'arg0',params:[['args2+']],when:'later'}],effect:'timers'},
    'clearTimeout clearInterval clearImmediate':{effect:'timers'}}));

// --- families -----------------------------------------------------------------------------------
// Roots (globals or package specifiers) whose values belong to a family. A root not listed is its
// own family. `navigator` exists in Node but the browser's differs, so it is a family here.
export const FAMILY_ROOTS={
  document:'dom',window:'dom',location:'dom',history:'dom',localStorage:'dom',sessionStorage:'dom',navigator:'dom',
  getComputedStyle:'dom',ResizeObserver:'dom',EventSource:'dom',Image:'dom',HTMLElement:'dom',Worker:'dom',self:'dom',devicePixelRatio:'dom',
  zod:'zod','manifold-3d':'manifold','clipper2-wasm':'clipper',rhino3dm:'rhino',fontkit:'fontkit',fflate:'fflate'
};
export const BROWSER_ROOTS=new Set(['navigator']);

const DOM_MUTATORS='append appendChild prepend replaceChildren insertBefore insertAdjacentElement insertAdjacentHTML replaceWith before after remove removeChild setAttribute setAttributeNS removeAttribute toggleAttribute add toggle replace setProperty removeProperty focus blur click select scrollTo scrollIntoView scrollBy setPointerCapture releasePointerCapture showModal show close play pause requestFullscreen setSelectionRange setCustomValidity reset submit observe unobserve disconnect';
export const FAMILIES={
  dom:{note:'Browser document, windows, elements, events and other browser-only objects. A method changes the object it is called on; changes to an element the caller created stay with it until attached.',parts:true,
    members:{
      ...group('',{
        'createElement createElementNS createTextNode createDocumentFragment cloneNode':{out:[fresh('dom')]},
        'getElementById querySelector closest elementFromPoint getContextAttributes':{out:['@dom'],reads:'dom'},
        'querySelectorAll getElementsByClassName getElementsByTagName':{out:[arr('@dom')],reads:'dom'},
        'getBoundingClientRect getClientRects':{out:[fresh('json')],reads:'dom'},
        'getAttribute hasAttribute contains matches getPropertyValue checkValidity hasPointerCapture':{reads:'dom'},
        'addEventListener':{mutates:['this'],calls:[{fn:'arg1',params:[['@dom']],when:'later'}]},
        'removeEventListener':{mutates:['this']},
        'dispatchEvent':{mutates:['this'],observe:['arg0.*'],note:'Invokes listeners registered on the same target.'},
        'preventDefault stopPropagation stopImmediatePropagation':{mutates:['this']},
        'getItem key':{reads:'storage'},'setItem removeItem clear':{effect:'storage'},
        'reload assign pushState replaceState back forward go open':{mutates:['this'],effect:'dom'},
        'getContext':{out:[fresh('webgl')],note:'A WebGL or 2D context; its state is the canvas the caller holds.'},
        'toDataURL':{reads:'dom'},'toBlob':{calls:[{fn:'arg0',params:[[fresh('Blob')]],when:'later'}]},
        'writeText':{out:[promise()],effect:'dom'},'readText':{out:[promise()],reads:'dom'},
        'animate':{out:[fresh('dom')],mutates:['this']},'composedPath':{out:[arr('@dom')]},
        'item':{out:['@dom']},'forEach':{calls:[{fn:'arg0',params:[['@dom'],[],['this']]}]},
        'postMessage':{effect:'workers',observe:['arg0.*','arg0[]'],note:'A browser Worker, or the worker global posting to its owner.'},
        'terminate':{mutates:['this'],effect:'workers'},
        'Worker':{construct:{effect:'workers',note:'Starts the module arg0 in a browser worker.'}}
      }),
      ...group('',{[DOM_MUTATORS]:{mutates:['this','args']}})
    }},
  webgl:{note:'A WebGL2 context: every call that sets state, uploads data or draws changes the GPU state of the canvas it belongs to.',
    members:{
      ...group('',{
        'createBuffer createVertexArray createProgram createShader createTexture createFramebuffer createRenderbuffer createQuery':{out:[fresh('webgl')],mutates:['this']},
        'getUniformLocation getAttribLocation getExtension getParameter getShaderParameter getShaderInfoLog getProgramParameter getProgramInfoLog getError getQueryParameter isContextLost getSupportedExtensions':{out:['@webgl'],reads:'gpu'},
        'readPixels':{mutates:['arg6'],reads:'gpu'}
      }),
      ...group('',{'activeTexture attachShader beginQuery bindAttribLocation bindBuffer bindFramebuffer bindRenderbuffer bindTexture bindVertexArray blendColor blendEquation blendFunc blendFuncSeparate bufferData bufferSubData clear clearColor clearDepth colorMask compileShader cullFace deleteBuffer deleteFramebuffer deleteProgram deleteQuery deleteRenderbuffer deleteShader deleteTexture deleteVertexArray depthFunc depthMask depthRange disable disableVertexAttribArray drawArrays drawArraysInstanced drawBuffers drawElements drawElementsInstanced enable enableVertexAttribArray endQuery finish flush framebufferTexture2D frontFace generateMipmap lineWidth linkProgram pixelStorei polygonOffset renderbufferStorage scissor shaderSource stencilFunc stencilOp texImage2D texParameteri texSubImage2D uniform1f uniform1fv uniform1i uniform1iv uniform2f uniform2fv uniform3f uniform3fv uniform4f uniform4fv uniformMatrix3fv uniformMatrix4fv useProgram vertexAttribDivisor vertexAttribIPointer vertexAttribPointer viewport':{mutates:['this'],effect:'gpu'}})
    }},
  json:{note:'Plain data the platform made (parsed JSON, clones, headers, arguments): objects, arrays and strings, looked up by method name. Its nested values are the family value.',byName:true},
  filehandle:{note:'An open file (node:fs/promises FileHandle).',members:group('',{
    'read readFile':{out:[promise(fresh('Object',[],{fields:{bytesRead:[],buffer:['arg0']}}))],mutates:['arg0'],reads:'fs'},
    'write writeFile appendFile truncate sync datasync':{out:[promise()],effect:'fs',observe:['arg0']},
    'close':{out:[promise()],mutates:['this']},'stat':{out:[promise(fresh('node:fs.Stats'))],reads:'fs'}})},
  zod:{note:'zod schemas: builders are pure and return fresh schemas; parsing returns a fresh copy of the input; refinements and transforms run during parsing with the parsed value.',
    members:group('',{
      'object strictObject looseObject string number boolean bigint date literal enum nativeEnum union discriminatedUnion intersection tuple array record map set unknown any never null undefined void nullable optional nullish default describe strict passthrough strip catchall extend merge pick omit partial required keyof min max length nonempty int positive nonnegative negative finite gte lte gt lt multipleOf regex email url uuid startsWith endsWith trim toLowerCase brand readonly':{out:[fresh('zod',['this','args','args[]','args.*'])],note:'A fresh schema holding the receiver schema and the argument schemas.'},
      'refine superRefine transform preprocess catch pipe lazy custom':{out:[fresh('zod',['this','args'])],calls:[{fn:'args',params:[['?'],['?']],when:'later'}],
        note:'The callback is kept in the schema and runs when a schema containing it parses (see parse).'},
      'parse parseAsync':{out:[json('arg0')],calls:PARSE},
      'safeParse safeParseAsync':{out:[fresh('Object',[],{fields:{data:[json('arg0')],error:['@zod'],success:[]}})],calls:PARSE},
      'toJSONSchema':{out:[fresh('json')],calls:[{fn:'arg0[]',params:[]},{fn:'arg0[][]',params:[]},{fn:'arg0[][][]',params:[]}],note:'Runs lazy schema getters of the schema it converts.'},
      'flatten format':{out:[fresh('json')]},
      'unwrap removeDefault':{out:['this[]']},'meta':{out:[fresh('zod',['this','args']),fresh('json',['args'])]}
    })},
  manifold:{note:'manifold-3d (WASM): Manifold, CrossSection and Mesh values are immutable; operations return fresh values; delete() frees WASM memory owned by the receiver. A Mesh wrapper keeps the arrays it is given; Manifold, CrossSection and every operation copy their inputs into WASM, so a result holds none of the JS values passed in (they are read).',ownElements:true,
    members:group('',{
      'default':{out:[promise(fresh('manifold'))],note:'Instantiates the WASM module.'},
      'setup':{mutates:['this']},
      'Mesh':{construct:{el:['args','args.*','args[]']},call:{out:[fresh('manifold',['args','args.*'])]}},
      'Manifold CrossSection':{construct:{observe:['args.*','args[]']},call:{out:[fresh('manifold')],observe:['args.*','args[]']}},
      'delete':{mutates:['this']},
      'setProperties':{out:[fresh('manifold')],calls:[{fn:'arg1',params:[[fresh('TypedArray')],[fresh('TypedArray')],[fresh('TypedArray')]]}]},
      'warp':{out:[fresh('manifold')],calls:[{fn:'arg0',params:[[fresh('TypedArray')]]}]},
      'levelSet':{out:[fresh('manifold')],calls:[{fn:'arg0',params:[[fresh('TypedArray')]]}]},
      'cube sphere cylinder ofMesh union intersection difference extrude revolve compose':{out:[fresh('manifold')],observe:['args.*','args[]','args[][]']},
      'add subtract intersect translate rotate scale transform mirror refine refineToLength refineToTolerance simplify trimByPlane split':{out:[fresh('manifold')],observe:['args.*','args[]']},
      'getMesh':{out:[fresh('manifold')]},'status isEmpty volume surfaceArea numVert numTri genus boundingBox':P
    })},
  clipper:{note:'clipper2-wasm: paths and clipping operations; containers are WASM objects that hold the points pushed into them and are freed with delete().',ownElements:true,
    members:group('',{'default':{out:[promise(fresh('clipper'))],note:'Instantiates the WASM module.'},'delete':{mutates:['this']},
      'push_back':{mutates:['this'],into:[{to:'this[]',from:['args']}]},'get':{out:['this[]']},'size':P,
      'Paths64 Path64 Clipper64':{construct:{}},
      'assign':{mutates:['this']},'view':{out:[fresh('TypedArray')]},
      'SetPreserveCollinear':{mutates:['this']},'AddSubject AddOpenSubject AddClip':{mutates:['this'],into:[{to:'this[]',from:['arg0']}]},
      'ExecutePath':{mutates:['args2+'],into:[{to:'arg2[]',from:['this[]','this[][]']},{to:'arg3[]',from:['this[]','this[][]']}]},
      'InflatePaths64 SimplifyPaths64':{out:[fresh('clipper',['arg0[]'])]}})},
  rhino:{note:'rhino3dm (WASM): geometry and 3dm file objects; constructors and operations return fresh objects; setters change their receiver; delete() frees WASM memory.',ownElements:true,
    members:group('',{'default':{out:[promise(fresh('rhino'))],note:'Instantiates the WASM module.'},'delete':{mutates:['this']},
      'setUserString setPoint setKnot setWeight add set':{mutates:['this'],into:[{to:'this[]',from:['args']}]},'get':{out:['this[]']},
      'File3dm ObjectAttributes LineCurve NurbsSurface Point3d':{construct:{el:['args']}},
      'create duplicate toNurbsSurface translate pointAt knotsU knotsV points settings objects':{out:[fresh('rhino',['this','args'])]},
      'toByteArray':{out:[fresh('TypedArray')]},'destroy':{mutates:['this']}})},
  fontkit:{note:'fontkit: parses a font from bytes; layouts and glyph paths are fresh values.',
    members:group('',{'create':{out:[fresh('fontkit')]},'openSync':{out:[fresh('fontkit')],reads:'fs'},'open':{out:[promise(fresh('fontkit'))],reads:'fs'},
      'getVariation layout glyphForCodePoint':{out:[fresh('fontkit')]}}),byName:true},
  fflate:{note:'fflate: pure compression; results are fresh byte arrays or file maps.',
    members:group('',{'zipSync unzipSync gzipSync gunzipSync deflateSync inflateSync zlibSync unzlibSync':{out:[fresh('fflate',['arg0.*'])]},
      'strToU8':{out:[fresh('TypedArray')]},'strFromU8':P})}
};

// Property reads whose runtime value the analysis cannot use: absent in the analysis process
// (null parentPort in the main thread) or computed by a getter on a prototype.
export const PROPERTIES={
  'node:worker_threads.parentPort':'MessagePort',
  'node:worker_threads.workerData':'json',
  'Response.prototype.body':'ReadableStream',
  'Response.prototype.headers':'Headers',
  'URL.prototype.searchParams':'URLSearchParams',
  'AbortController.prototype.signal':'AbortSignal',
  ...Object.fromEntries(['Uint8Array','Float64Array','Float32Array','Int32Array','Uint32Array','TypedArray'].map(t=>[t+'.prototype.buffer','ArrayBuffer']))
};

// --- lookup -----------------------------------------------------------------------------------
function resolvePath(path) {
  for(const [spec,mod] of Object.entries(NODE))if(path===spec||path.startsWith(spec+'.')) {
    let v=mod;for(const k of path.slice(spec.length+1).split('.').filter(Boolean)){if(v==null)return undefined;try{v=v[k];}catch{return undefined;}}
    return v;
  }
  const [root,...rest]=path.split('.');
  let v=root in SPECIAL_ROOTS?SPECIAL_ROOTS[root]:root in globalThis&&!BROWSER_ROOTS.has(root)?globalThis[root]:undefined;
  if(root==='Timeout'){const t=setTimeout(()=>{},0);clearTimeout(t);v={prototype:Object.getPrototypeOf(t)};}
  for(const k of rest){if(v==null)return undefined;try{v=v[k];}catch{return undefined;}}
  return v;
}
let byValue=null;
function index() {
  if(byValue)return byValue;
  byValue=new Map();
  for(const name of Object.keys(MODELS)) {
    const v=resolvePath(name);
    if(typeof v==='function'&&!byValue.has(v))byValue.set(v,name);
  }
  return byValue;
}
// A type's prototype: {path, value} for a runtime class, or {family} for a family.
export function typeOf(type) {
  if(FAMILIES[type])return {family:type,parts:!!FAMILIES[type].parts,ownElements:!!FAMILIES[type].ownElements};
  const v=resolvePath(type);
  if(typeof v==='function'&&v.prototype)return {path:type+'.prototype',value:v.prototype};
  if(v&&typeof v==='object')return {path:type,value:v};
  return {family:type};
}
// The family a platform path belongs to: its root's family, or the root itself.
export function familyOf(path) {
  const root=path.endsWith('.*')?path.slice(0,-2):path.split('.')[0].replace(/^unresolved:/,'');
  if(root==='platform')return null;
  return FAMILY_ROOTS[root]??root;
}
export const familyPath=family=>family+'.*';
// `ownElements`: a value of the family that a model made (fresh, or an instance) holds as elements
// exactly what the models put there (el, into): WASM containers copy values in and give them back.
// Its elements are never the family's unknown value.
export const familyOwnsElements=family=>!!FAMILIES[family]?.ownElements;
export const isFamilyPath=path=>path.endsWith('.*');

const BY_NAME=['Array.prototype','String.prototype','Map.prototype','Set.prototype','Promise.prototype','Iterator.prototype','Object.prototype','Number.prototype',
  'RegExp.prototype','Date.prototype','Buffer.prototype','node:events.EventEmitter.prototype','Function.prototype'];
function byName(method) {
  if(method==null)return undefined;
  for(const p of BY_NAME){const api=p+'.'+method;if(MODELS[api]!==undefined)return api;}
  return undefined;
}
function specOf(model,construct) {
  if(!model)return model;
  if('construct' in model||'call' in model)return construct?model.construct:model.call;
  return construct?undefined:model;
}

// Looks up the model for a call of a platform value.
//   path:  the value's platform path ('Array.prototype.map', 'dom.*', 'platform.unknown').
//   value: the runtime value when the path names one (known), else undefined.
//   method: the property the callee was read from (undefined for a plain call).
//   name:  a name hint for plain calls and constructions (the callee identifier).
// Returns {api, spec, how} where how is 'value' (identified by runtime value), 'path', 'family',
// 'family-by-name' (a family looked up by method name) or 'by-name' (receiver unresolved;
// matched on the method name); spec is
// undefined when the API has no model. {api, notCallable: true} for a value that is not a
// function (an imprecision of the analysis, not a call SAAM makes).
export function lookupPlatform({path,value,known,method,name,construct=false}) {
  if(known) {
    if(typeof value!=='function')return {api:path,notCallable:true};
    const api=index().get(value)??path;
    const spec=specOf(MODELS[api],construct);
    return {api:(construct?'new ':'')+api,spec,how:'value'};
  }
  if(MODELS[path]!==undefined)return {api:(construct?'new ':'')+path,spec:specOf(MODELS[path],construct),how:'path'};
  // A family value: 'family.*' (reached through other values) or 'family.member' (a named member
  // of a package or browser global). The member called is the path's member, else the method,
  // else the callee's name (a destructured member), else '()'.
  const dot=path.indexOf('.');
  const family=dot>0&&path.split('.')[0]!=='platform'?path.slice(0,dot):null;
  const fam=family&&FAMILIES[family];
  const rest=family?path.slice(dot+1):null;
  const member=rest&&rest!=='*'?rest:method??name??'()';
  const label=(construct?'new ':'')+`${family}.${member}`;
  if(fam) {
    const m=fam.members?.[member];
    if(m!==undefined)return {api:label,spec:specOf(m,construct)??(construct?{}:undefined),how:'family'};
    if(fam.byName){const b=byName(member);if(b)return {api:b,spec:specOf(MODELS[b],construct),how:'family-by-name'};}

    return {api:label,spec:undefined,how:'family'};
  }
  if(family)return {api:label,spec:undefined,how:'family'};
  // An unknown platform value (platform.unknown, an unmodelled result): match on the name.
  const b=byName(method);
  if(b)return {api:b,spec:specOf(MODELS[b],construct),how:'by-name'};
  return {api:`?.${member}`,spec:undefined,how:'by-name'};
}
export function propertyType(path){return PROPERTIES[path];}
// A method called on a primitive (a string, number, boolean, bigint or symbol receiver): the
// model of the wrapper prototype's method.
const WRAPPERS={string:String,number:Number,boolean:Boolean,bigint:BigInt,symbol:Symbol};
export function lookupPrimitiveMethod(kind,method) {
  const C=WRAPPERS[kind];if(!C||method==null)return undefined;
  const value=C.prototype[method];
  return lookupPlatform({path:`${C.name}.prototype.${method}`,value,known:true,method});
}
