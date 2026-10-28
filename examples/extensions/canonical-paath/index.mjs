// Portable extension: the host supplies Construction; there are no core imports. It sees its
// request and SAAM's services, and adds its operation or changes its earlier one.
export function canonicalPaathOperations(request,{Toolpath,Recipe}){
  const length=request.lengthMm??2,toolIndex=request.toolIndex??0,id=request.id??'canonical';
  if(!Number.isFinite(length)||length<=0)throw Error('lengthMm must be positive.');
  const assignment=Toolpath.paathAssignment({id,toolIndex,
    natives:[{id:'first',stackId:'example',index:0,sequence:0}],
    entities:[{
      id:'line',layerId:'first',
      geometry:{kind:'nurbs',degree:3,knots:[0,0,0,0,1,1,1,1],
        controlPoints:[[0,0,.2],[length/4,0,.2],[3*length/4,0,.2],[length,0,.2]]},
      profiles:{toolAxis:[0,0,-1],materialNormal:[0,0,1],speedMmS:20,rateMm3PerMm:.08,aspectRatio:2},
      directionRequired:true,role:'example-line'
    },{
      id:'dose',layerId:'first',after:['line'],geometry:{kind:'point',point:[length,0,.2]},
      profiles:{toolAxis:[0,0,-1]},stationary:{volumeMm3:.02,flowMm3S:.01,holdSeconds:.1}
    }]});
  const {id:_id,...set}=assignment;
  return {...(Recipe.assignment(id)?{change:[{id,set}]}:{add:[assignment]}),
    report:{id,entities:2,geometry:'exact authored cubic and stationary point'}};
}
