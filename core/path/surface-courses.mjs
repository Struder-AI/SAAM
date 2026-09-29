// Both circular and mapped-surface producers use the same shell sequence.
export const CLADDING_PATTERNS=['axial-hoop','crossed-helices'];
export function claddingCourse(settings,layer){
  const crossed=settings.pattern==='crossed-helices',axial=!crossed&&layer%2===0;
  const direction=crossed&&layer%2===1?-1:1;
  return {axial,direction,phase:axial?'cladding-axial':crossed?
    (direction===1?'cladding-helix-forward':'cladding-helix-reverse'):'cladding-hoop'};
}
