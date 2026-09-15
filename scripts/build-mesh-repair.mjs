// Build a shared native helper. Dependency paths are build inputs, never runtime paths.
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--compiler','--cgal','--boost','--eigen'].includes(args[i])||!args[i+1])throw Error('Use --compiler <C++ compiler> --cgal <include> --boost <include> --eigen <include>');options[args[i].slice(2)]=resolve(args[i+1]);}
const output=join(root,'build','mesh-repair'),source=join(root,'core/geom/native/mesh-repair.cpp');await mkdir(output,{recursive:true});
const executable=join(output,'saam-mesh-repair'+(process.platform==='win32'?'.exe':''));
const compiler=options.compiler??process.env.CXX??'c++';
const flags=['-std=c++17','-O1','-DNDEBUG','-DCGAL_DISABLE_GMP','-DCGAL_EIGEN3_ENABLED',...['cgal','boost','eigen'].filter(k=>options[k]).map(k=>'-I'+options[k]),source,'-o',executable];
if(process.platform==='win32')flags.push('-static');
await rm(join(output,'build.json'),{force:true});
await new Promise((yes,no)=>{const p=spawn(compiler,flags,{stdio:'inherit',windowsHide:true});p.on('error',no);p.on('exit',code=>code===0?yes():no(Error('Native mesh repair build failed: '+code)));});
const version=await new Promise((yes,no)=>{let text='';const p=spawn(executable,['--version'],{stdio:['ignore','pipe','inherit'],windowsHide:true});p.stdout.on('data',data=>text+=data);p.on('error',no);p.on('exit',code=>code===0?yes(text.trim()):no(Error('Cannot verify native helper version')));});
if(version!=='saam-cgal-mesh-repair/1 CGAL 6.2.1')throw Error('Build requires CGAL 6.2.1; got '+version);
await writeFile(join(output,'build.json'),JSON.stringify({cgal:'6.2.1',sourceSha256:createHash('sha256').update(await readFile(source)).digest('hex')},null,2)+'\n');
console.log('Built '+executable);
