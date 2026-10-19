// DENSO VS-068A4 arm plus external rotary table: this extension's kinematics
// plug (machine-kinematics). The SAAMpath gives the toolhead position and
// orientation in the part frame; every DENSO axis comes from here, for both the
// PacScript writer and Studio's machine view. Arm plus table is redundant: like
// the arm's figure, DENSO chooses the table angle itself. It holds the table
// at the setup's angle (setup.denso.tableDeg) for the whole program.

// The held table angle. An older setup states it as initialPose.rotaryDeg.
export const heldTableDeg=c=>c.tableDeg??c.initialPose?.rotaryDeg;

export function createKinematics({frame,dimensions}){
  const {add,subtract:sub,scale,innerProduct:dot,cross,length:norm,mv,mm,transpose,identity,rotation,rigid,point,validateRigid,rotateZ,rotatePointZ}=frame;
  const {PROGRAM_STEP_MM,ROUNDING_MM,ROUNDING_RELATIVE}=dimensions;

  // The table: room (table-axis) frame from the part frame, about the
  // installed rotary centre.
  function placeTool(c,{point:at,toolAxis,toolUp}){
    const tableDeg=heldTableDeg(c);
    return {tableDeg,point:rotatePointZ(at,tableDeg,c.rotaryCenterMm),toolAxis:rotateZ(toolAxis,tableDeg),toolUp:rotateZ(toolUp,tableDeg)};
  }
  function partFrame(c){
    const R=rotation([0,0,1],heldTableDeg(c)*Math.PI/180);
    return rigid(sub(c.rotaryCenterMm,mv(R,c.rotaryCenterMm)),R);
  }

  // Nominal VS-068A4 standard-flange centerlines from DENSO's VS-068 drawing:
  // https://www.denso-wave.com/fsys/en/robot/product/five-six/vs068-087/en_VS-068-W.pdf
  // Cross-checked against the supplied WINCAPS VS068 model joint pivots.
  // These are MODEL angles, not calibrated RC8A encoders/FIG. At zero: shoulder
  // offset +X, upper arm +Z, forearm +X with +20 mm Z offset, flange +X.
  const MODEL_DEFAULTS=Object.freeze({shoulderHeightMm:395,shoulderOffsetMm:30,upperMm:340,forearmMm:340,
    elbowOffsetMm:20,flangeMm:80,toolLengthMm:70});
  function geometry(config={}){
    const g={...MODEL_DEFAULTS,...config};
    for(const key of Object.keys(MODEL_DEFAULTS))if(!Number.isFinite(g[key])||g[key]<=0)throw Error('Invalid DENSO '+key);
    // Nominal flange axes in the wrist model: flange +Z = model +X,
    // flange +X = model -Z. This defines the model's J6 zero, not an encoder zero.
    const wristFromFlange=[[0,0,1],[0,1,0],[-1,0,0]],nozzleToPresentation=[[-1,0,0],[0,1,0],[0,0,-1]];
    if(g.flangeFromTool){
      validateRigid(g.flangeFromTool);
      const [x,y,z]=g.flangeFromTool.translationMm;
      const toolVectors=[[0,0,z],[x,y,0]].filter(v=>norm(v)>ROUNDING_MM).map(v=>mv(wristFromFlange,v));
      return {...g,toolVectors,toolRotation:mm(mm(wristFromFlange,g.flangeFromTool.rotation),nozzleToPresentation),toolReachMm:toolVectors.reduce((s,v)=>s+norm(v),0)};
    }
    return {...g,toolVectors:[[g.toolLengthMm,0,0]],toolRotation:[[0,0,-1],[0,1,0],[1,0,0]],toolReachMm:g.toolLengthMm};
  }
  function forward(g,joints){
    if(joints.length!==6||!joints.every(Number.isFinite))throw Error('DENSO needs six finite model joint angles');
    let R=identity(),p=[0,0,0];const points=[p],axes=[],origins=[];
    const turn=(axis,i)=>{axes.push(mv(R,axis));origins.push(p);R=mm(R,rotation(axis,joints[i]*Math.PI/180));};
    const move=v=>{p=add(p,mv(R,v));points.push(p);};
    turn([0,0,1],0);move([g.shoulderOffsetMm,0,g.shoulderHeightMm]);turn([0,1,0],1);move([0,0,g.upperMm]);
    turn([0,1,0],2);move([g.forearmMm,0,g.elbowOffsetMm]);turn([1,0,0],3);turn([0,1,0],4);turn([1,0,0],5);
    move([g.flangeMm,0,0]);for(const vector of g.toolVectors)move(vector);
    const presentation=mm(R,g.toolRotation);
    return {tcp:p,rotation:presentation,points,axes,origins,joints:[...joints]};
  }
  // Recover the wrist from a target TCP using the complete installed tool transform.
  function wristFromPose(g,pose){
    const wristRotation=mm(pose.rotation,transpose(g.toolRotation));
    const offset=g.toolVectors.reduce((p,v)=>add(p,v),[g.flangeMm,0,0]);
    return sub(pose.tcp,mv(wristRotation,offset));
  }
  const linear=(a,b)=>{
    const m=a.map((row,i)=>[...row,b[i]]),n=b.length;
    for(let i=0;i<n;i++){let p=i;for(let j=i+1;j<n;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;[m[p],m[i]]=[m[i],m[p]];
      // Rounding guard on a pivot of the normal matrix, in mm squared.
      if(Math.abs(m[i][i])<ROUNDING_MM**2)throw Error('Singular DENSO solve');const d=m[i][i];for(let k=i;k<=n;k++)m[i][k]/=d;
      for(let j=0;j<n;j++)if(j!==i){const f=m[j][i];for(let k=i;k<=n;k++)m[j][k]-=f*m[i][k];}}
    return m.map(row=>row[n]);
  };
  function rotationError(target,current){
    const r=mm(target,transpose(current)),v=[r[2][1]-r[1][2],r[0][2]-r[2][0],r[1][0]-r[0][1]],s=norm(v)/2,c=Math.max(-1,Math.min(1,(r[0][0]+r[1][1]+r[2][2]-1)/2));
    if(s<ROUNDING_RELATIVE){ // rounding guard: the sine is too small to divide by
      if(c>=0)return scale(v,.5);
      // At a half-turn the antisymmetric part vanishes. Recover the axis
      // from R + I, choosing its largest component for numerical stability.
      const k=[0,1,2].reduce((best,i)=>r[i][i]>r[best][best]?i:best,0);
      const axis=[0,0,0];axis[k]=Math.sqrt(Math.max(0,(r[k][k]+1)/2));
      for(let i=0;i<3;i++)if(i!==k)axis[i]=(r[i][k]+r[k][i])/(4*axis[k]);
      return scale(axis,Math.PI/norm(axis));
    }
    return scale(v,Math.atan2(s,c)/(2*s));
  }
  function inverse(g,pose,{seed}={}){
    validateRigid(rigid(pose.tcp,pose.rotation));
    if(!seed||seed.length!==6||!seed.every(Number.isFinite))throw Error('DENSO nominal IK requires an explicit model-angle seed');
    let q=[...seed];const lever=g.upperMm;
    // Machine kinematics: a branch measure this close to zero (elbow in mm, wrist sine
    // dimensionless) sits on the singularity and belongs to neither branch. Value kept
    // pending an owner decision on the arm's repeatability as the band.
    const BRANCH_NEUTRAL=PROGRAM_STEP_MM,sign=v=>Math.abs(v)<BRANCH_NEUTRAL?0:Math.sign(v);
    const branch=q=>[sign(g.forearmMm*Math.cos(q[2]*Math.PI/180)+g.elbowOffsetMm*Math.sin(q[2]*Math.PI/180)),sign(Math.sin(q[4]*Math.PI/180))];
    const chosen=branch(seed);
    // The damped step keeps reducing the pose residual while the seed branch can
    // reach the target. Iteration ends on that residual, not on a step count: a
    // solve that stops approaching the pose is the real failure.
    let best=Infinity,stalls=0;
    try{for(let iteration=0;;iteration++){
      const s=forward(g,q),p=sub(pose.tcp,s.tcp),r=rotationError(pose.rotation,s.rotation);
      if(norm(p)<PROGRAM_STEP_MM&&norm(r)*lever<PROGRAM_STEP_MM){ // convergence: closer than one program step, rotation measured at the lever
        if(branch(q).some((v,i)=>v&&chosen[i]&&v!==chosen[i]))return {valid:false,errors:['DENSO solve leaves the declared elbow/wrist seed branch']};
        return {...s,valid:true,errors:[],iterations:iteration};
      }
      const residual=norm(p)+norm(r)*lever;
      if(residual<best*(1-ROUNDING_RELATIVE)) // progress beyond rounding
        {best=residual;stalls=0;}
      else if(++stalls>=8)
        return {valid:false,errors:[`DENSO nominal IK stopped approaching the requested pose from the declared model seed after ${iteration} iterations`]};
      const columns=s.axes.map((axis,i)=>[...cross(axis,sub(s.tcp,s.origins[i])),...scale(axis,lever)]),error=[...p,...scale(r,lever)];
      const normal=columns.map((c,i)=>columns.map((d,j)=>dot(c,d)+(i===j?.1:0))),rhs=columns.map(c=>dot(c,error)),delta=linear(normal,rhs);
      const factor=Math.min(1,.15/Math.max(...delta.map(Math.abs)));q=q.map((v,i)=>v+delta[i]*factor*180/Math.PI);
      if(!q.every(Number.isFinite))return {valid:false,errors:['DENSO nominal IK left the model with a nonfinite joint angle']};
    }}catch(error){return {valid:false,errors:[error.message]};}
  }

  // Studio's machine view: the table from the setup, the arm from nominal IK
  // seeded by the installation's modelSeedDeg.
  function view({setup,config}){
    const c=setup.denso,limitations=['Nominal VS-068A4 drawing centerlines and seeded IK; model angles are not RC8A encoders or FIG.'];
    const part=()=>partFrame(c);
    if(!config.worldFromBase||!(Number.isFinite(config.toolLengthMm)||config.flangeFromTool)||!Array.isArray(config.modelSeedDeg))
      return {limitations:[...limitations,'Arm omitted: supply kinematicModel.worldFromBase and installed toolLengthMm (or DENSO flangeFromTool), plus modelSeedDeg.'],partFrame:part,arm:null};
    const g=geometry(config),fore=Math.hypot(g.forearmMm,g.elbowOffsetMm);
    // The shoulder travels on a circle about J1; these are conservative annulus
    // margins across azimuths. Seeded IK resolves the actual pose.
    function reachMargins(local){
      const wrist=wristFromPose(g,{tcp:local.translationMm,rotation:local.rotation});
      const radial=Math.hypot(wrist[0],wrist[1]),height=wrist[2]-g.shoulderHeightMm;
      return [g.upperMm+fore-Math.hypot(radial-g.shoulderOffsetMm,height),Math.hypot(radial+g.shoulderOffsetMm,height)-Math.abs(g.upperMm-fore)];
    }
    const baseCenter=point(config.worldFromBase,[0,0,g.shoulderHeightMm]),radius=g.shoulderOffsetMm+g.upperMm+fore+g.flangeMm+g.toolReachMm;
    const center=c.rotaryCenterMm,radial=radius+Math.hypot(baseCenter[0]-center[0],baseCenter[1]-center[1]);
    return {limitations,partFrame:part,arm:{worldFromBase:config.worldFromBase,baseSizeMm:[160,160,20],rotationControls:[0,1,2],
      linkLengthsMm:[Math.hypot(g.shoulderOffsetMm,g.shoulderHeightMm),g.upperMm,fore,g.flangeMm,...g.toolVectors.map(norm)],
      coordinateBounds:{min:[center[0]-radial,center[1]-radial,baseCenter[2]-radius],max:[center[0]+radial,center[1]+radial,baseCenter[2]+radius]},
      angularLeverMm:g.flangeMm+g.toolReachMm,reachMargins,
      inverse:local=>({...inverse(g,{tcp:local.translationMm,rotation:local.rotation},{seed:config.modelSeedDeg}),margins:reachMargins(local)})}};
  }
  return Object.freeze({geometry,forward,inverse,wristFromPose,placeTool,view});
}
