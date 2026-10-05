// Import first: this test process's SAAM home (extension library, temporary
// workspaces) is a disposable folder, never the person's home.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const home=mkdtempSync(join(tmpdir(),'saam-test-home-'));
process.env.SAAM_DATA=home;
process.on('exit',function removeTemporaryHome(){try{rmSync(home,{recursive:true,force:true});}catch{/* A child may still hold a file; the OS temp folder keeps it. */}});
