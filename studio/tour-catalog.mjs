export const TOUR_VERSION=1; // Saved example marker format.
export const TOUR_DECK_VERSION=6;
export const TOUR_LESSONS={geometry:0,playback:1,settings:2,setup:3,export:4};
export const TOUR_EXAMPLE='starter'; // The fin block, the tour's one example.
export const TOUR_STEPS=[
  {example:true,tab:'geometry',gate:'geometry',title:'Change the shape',body:'This block has a raised fin. Ask your agent to make the fin taller, wider or shorter.',try:'Send your change in chat. Continue when the new shape appears here.'},
  {tab:'toolpath',gate:'playback',highlight:'play',title:'Watch how it prints',body:'The coloured lines show where the printer will put material. Press Play to watch one layer build.',try:'You can pause, scrub through layers and change the speed. Continue whenever you are ready.'},
  {tab:'toolpath',gate:'settings',title:'Change how it prints',body:'Keep the shape, but make its interior look different: use much denser infill or change the fill pattern.',try:'Ask for a change, or let your agent choose. Compare the new path and material estimate before continuing.'},
  {tab:'toolpath',gate:'setup',highlight:'print-setup',title:'Check printer and material',body:'This tour begins with an example Ultimaker S5 and PLA setup. The file must match the printer and filament you will actually use.',try:'Ask your agent to change either setting if needed. Review the updated path before continuing.'},
  {tab:'toolpath',gate:'export',highlight:'confirm',title:'Export or finish viewing',body:'If the printer and material shown match yours, Confirm settings & export downloads the exact checked file on screen.',try:'No matching printer or just exploring? Choose Finish without export. You can keep this part and return to it later.'}
];
export function tourAgentInstruction(data){
  if(data.completed)return data.downloadedHash
    ?'The tour file was downloaded. Briefly offer help with printing or with the next part, once.'
    :'The participant finished the viewing-only tour. Briefly offer help setting up a printer or making the next part, once.';
  if(!data.active)return null;
  if(data.step===TOUR_LESSONS.geometry)return 'Studio asks for a geometry change. Wait for the participant’s request, then edit the active tour print. Do not introduce the tour again or remove its tour marker.';
  if(data.step===TOUR_LESSONS.settings)return 'Choose a visibly different printing path for this lesson. For ordinary Slice, offer a large infill change such as 20% to 70%, or a clearly different supported fill pattern; explain the likely material/time tradeoff. Small wall-count or speed adjustments are too subtle for the first demonstration. If the participant asks you to choose, apply the large infill change without asking again. Keep the geometry and other settings unchanged, show the updated path at an interior layer, and compare its material/time estimate with the previous one. Keep the explanation brief.';
  if(data.step===TOUR_LESSONS.setup)return 'Help the participant establish the actual printer and filament before export. Ultimaker S5 and PLA are example values. If they differ, update the print and let Studio show the current checked path. If the participant has no printer, point to Finish without export on the last lesson.';
  if(data.step===TOUR_LESSONS.playback)return 'Studio starts at a deposited layer with visible contours. Use set_tour_start_at only if the person asks to view a different layer. Do not edit or regenerate the print to choose a viewing position.';
  return null;
}
