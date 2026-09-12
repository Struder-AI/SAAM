// Scalar tensor-product fields. Degree one is a node-sampled trilinear grid;
// higher degrees are control coefficients, not interpolated voxel samples.
import {basisFunctions,basisDerivatives,findSpan} from './nurbs.mjs';
import {requireThat} from './tolerance.mjs';
import {hierarchical,validateHierarchy,createHierarchyEvaluator} from './voxel-hierarchy.mjs';

export function uniformKnots(count,degree){
  return Array.from({length:count+degree+1},(_,i)=>i<=degree?0:i>=count?1:(i-degree)/(count-degree));
}

export function validateVoxelField(field){
  if(field&&hierarchical(field))return validateHierarchy(field);
  requireThat(field&&Object.keys(field).sort().join()==='counts,degrees,isoValue,knots,originMm,schema,sizeMm,values,weights','Unexpected voxel field fields.');
  requireThat(field.schema==='saam-voxel-field/1','Unsupported voxel field schema.');
  for(const key of ['originMm','sizeMm'])requireThat(Array.isArray(field[key])&&field[key].length===3&&field[key].every(Number.isFinite),'Voxel '+key+' needs three finite millimeter values.');
  requireThat(field.sizeMm.every((v,i)=>v>0&&Number.isFinite(v+field.originMm[i])),'Voxel sizeMm must be positive with finite bounds.');
  requireThat(Array.isArray(field.counts)&&field.counts.length===3&&field.counts.every(v=>Number.isSafeInteger(v)&&v>=2),'Voxel counts need three integers of at least two.');
  requireThat(Array.isArray(field.degrees)&&field.degrees.length===3&&field.degrees.every((v,i)=>Number.isInteger(v)&&v>=1&&v<=3&&v<field.counts[i]),'Voxel degrees must be 1–3 and less than their control counts.');
  const count=field.counts.reduce((a,b)=>a*b,1);
  requireThat(Number.isSafeInteger(count)&&Array.isArray(field.values)&&field.values.length===count&&field.values.every(Number.isFinite),'Voxel values must contain one finite scalar per control, X fastest.');
  requireThat(Number.isFinite(field.isoValue),'Voxel isoValue must be finite.');
  requireThat(field.weights===null||(Array.isArray(field.weights)&&field.weights.length===count&&field.weights.every(v=>Number.isFinite(v)&&v>0)),'Voxel weights must be null or one positive finite weight per control.');
  requireThat(Array.isArray(field.knots)&&field.knots.length===3,'Voxel knots need one full knot vector per axis.');
  field.knots.forEach((knots,axis)=>{
    const n=field.counts[axis],p=field.degrees[axis];
    requireThat(Array.isArray(knots)&&knots.length===n+p+1&&knots.every((v,i)=>Number.isFinite(v)&&v>=0&&v<=1&&(!i||v>=knots[i-1])),'Invalid voxel knot vector.');
    requireThat(knots.slice(0,p+1).every(v=>v===0)&&knots.slice(n).every(v=>v===1)&&knots[p+1]>0&&knots[n-1]<1,'Voxel knots must be clamped to [0,1].');
    let repeats=0,last;
    for(const value of knots.slice(p+1,n)){repeats=value===last?repeats+1:1;last=value;requireThat(repeats<=p,'Voxel interior knot multiplicity must preserve continuity.');}
  });
  return field;
}

// Prepared evaluators own a snapshot: changing optimizer controls requires a new
// evaluator. Gradient units are scalar/mm; influences are d(value)/d(control).
export function createVoxelEvaluator(input){
  if(hierarchical(input))return createHierarchyEvaluator(input);
  const field=structuredClone(validateVoxelField(input));
  const {counts,degrees,knots,originMm,sizeMm,values,weights}=field;
  return function evaluate(point,{derivatives=false,influences=false,homogeneous=false}={}){
    requireThat(Array.isArray(point)&&point.length===3&&point.every(Number.isFinite),'Voxel evaluation needs finite XYZ millimeters.');
    if(point.some((v,i)=>v<originMm[i]||v>originMm[i]+sizeMm[i]))return null;
    const basis=point.map((v,i)=>{
      const t=(v-originMm[i])/sizeMm[i],span=findSpan(knots[i],counts[i],degrees[i]+1,t);
      const b=derivatives?basisDerivatives(knots[i],span,t,degrees[i]+1,1):[basisFunctions(knots[i],span,t,degrees[i]+1)];
      return {start:span-degrees[i],b};
    });
    let numerator=0,denominator=0;const dn=[0,0,0],dd=[0,0,0],terms=[];
    for(let z=0;z<=degrees[2];z++)for(let y=0;y<=degrees[1];y++)for(let x=0;x<=degrees[0];x++){
      const local=[x,y,z],index=basis[0].start+x+counts[0]*(basis[1].start+y+counts[1]*(basis[2].start+z));
      const weight=weights?.[index]??1,b=local.map((v,i)=>basis[i].b[0][v]);
      const product=b[0]*b[1]*b[2]*weight;
      numerator+=product*values[index];denominator+=product;
      if(influences)terms.push({index,weight:product});
      if(derivatives)for(let axis=0;axis<3;axis++){
        const d=weight*basis[axis].b[1][local[axis]]/sizeMm[axis]*b[(axis+1)%3]*b[(axis+2)%3];
        dn[axis]+=d*values[index];dd[axis]+=d;
      }
    }
    const value=numerator/denominator;
    requireThat(Number.isFinite(value),'Voxel evaluation overflow; rescale field values or weights.');
    return {value,...(homogeneous?{levelNumerator:numerator-field.isoValue*denominator}:{}),...(derivatives?{gradient:dn.map((v,i)=>(v-value*dd[i])/denominator)}:{}),
      ...(influences?{influences:terms.map(t=>({...t,weight:t.weight/denominator}))}:{})};
  };
}
