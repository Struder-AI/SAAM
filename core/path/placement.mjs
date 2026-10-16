// Placement is an XY offset applied where the SAAMpath meets a bed: at display
// and at program writing. Deposition is built in the part's frame, so moving
// the part never changes the SAAMpath.
export function placedPath(path,placement){
  const dx=placement?.xMm??0,dy=placement?.yMm??0;
  if(!dx&&!dy)return path;
  if(path.deposition&&path.schedule)return {...path,placement:{xMm:dx,yMm:dy}};
  const shift=p=>[p[0]+dx,p[1]+dy,p[2]],bounds=path.summary?.boundsMm;
  return {...path,initialPosition:shift(path.initialPosition),
    actions:path.actions.map(action=>action.kind==='move'?{...action,to:shift(action.to)}:action),
    ...(bounds?{summary:{...path.summary,boundsMm:{min:shift(bounds.min),max:shift(bounds.max)}}}:{})};
}
