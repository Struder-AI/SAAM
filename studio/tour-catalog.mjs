export const TOUR_VERSION=1; // Saved tour marker format; independent of the lesson deck.
export const TOUR_DECK_VERSION=3;
export const TOUR_LESSONS={geometry:0,roof:1,open:2,import:3,playback:4,settings:5,setup:6,export:7};
export const TOUR_DEMOS=[
  {id:'starter',title:'Fin block',subtitle:'A simple part with one bold feature'},
  {id:'surface-drape',title:'Wavy roof',subtitle:'Let layers follow the shape'},
  {id:'nudge-cup',title:'Nudge Cup',subtitle:'Combine patterns in one useful part'},
  {id:'wavy-denso',title:'Wavy DENSO',subtitle:'Print in more than one direction'}
];
export const TOUR_STEPS=[
  {demo:'starter',tab:'geometry',gate:'geometry',title:'Your words change the shape',body:'This little block has a raised fin. Your first task is to change it: ask your agent to make the fin taller, wider or shorter—or request any other change you would like.',try:'Send your request in chat. Next unlocks when your agent updates the geometry.'},
  {demo:'surface-drape',tab:'geometry',title:'Try a more interesting surface',body:'This wavy roof combines rolling curves with a downhill tilt. The same conversation can shape a simple block or a flowing surface.',try:'Ask your agent to change this roof, or continue. Your edits to both parts are saved.'},
  {tab:'geometry',gate:'open',highlight:'open-print',title:'Choose a saved print',body:'Open print lets you switch between your parts. Both geometries are saved, including any changes you requested.',try:'Click Open print and choose either part. Then import an STL or keep your selected shape before viewing the toolpath.'},
  {tab:'geometry',highlight:'import-stl',title:'Keep this part or try an STL',body:'Your part is saved, including your changes. Choose Continue with this part to keep using it, or Import STL to continue the tour with a different model.',try:'Importing keeps your current part saved. You can reopen it later with Open print.'},
  {tab:'toolpath',gate:'playback',highlight:'play',title:'Watch the material go down',body:'The preview starts at your agent’s chosen infill layer, or layer 2 if none was supplied. Press Play and watch for five seconds to see how material is deposited.',try:'Scrub anywhere or change the playback speed. Next unlocks after five seconds of visible playback.'},
  {tab:'toolpath',gate:'settings',title:'Go back to your agent',body:'Your agent has been asked to offer infill choices in chat. Choose one there, or ask for another printing change.',try:'Next unlocks after your changed toolpath has finished loading here.'},
  {tab:'toolpath',highlight:'print-setup',title:'Match this file to your printer',body:'Check the highlighted printer and material against the machine and filament you plan to use. These choices control the file format, temperatures and how material is deposited.',try:'This tour started with Ultimaker S5 and PLA. If either is different, tell your agent now and review the updated toolpath. Otherwise, continue. On future prints your agent establishes these choices before toolpath view.'},
  {tab:'toolpath',highlight:'confirm',title:'Take the file to your printer',body:'Confirm settings & export approves the displayed settings and toolpath, prepares and downloads the machine file, and completes this tour. Usually you copy it to a USB drive and plug that directly into the printer.',try:'Download the file to complete the tour. It is ready for the selected printer—do not slice it again in another printing app. You can still Exit tour at any time.'}
];
export function tourAgentInstruction(data){
  if(data.completed)return 'Immediately send ordinary chat text congratulating the participant on finishing the tour and downloading the file. In that same text, offer help with any difficulties printing the file and ask what she wants to make next. Never use a question box, form or request-user-input tool for this message. Send the chat text before status checks, logging, browser inspection or another listener call. If the client permits questions only in a final response, send this as the final chat response.';
  if(!data.active)return null;
  if(data.step===TOUR_LESSONS.settings)return 'In chat, ask the participant to change infill. Offer rectilinear (parallel lines), grid (crossed lines), triangles, gyroid (curving cells), and concentric (nested outlines). Any requested geometry or printing change also satisfies this lesson once its current toolpath is displayed. Apply the requested change to the selected print; do not pick an option for the participant. Changed geometry needs human confirmation before generation; Studio returns to this same lesson afterward.';
  if(data.step===0)return 'Studio introduces the part and asks for a geometry change. Wait for the participant to make that request; do not add a chat introduction, question or instruction. Then apply the requested edit to the active tour print with adjust. Do not approve it or remove its tour marker.';
  if(data.step===TOUR_LESSONS.playback&&!data.startAt)return 'Set an explicit startAt sparse-infill layer after the first layer for this selected model using set_tour_start_at. Do this without an unsolicited chat prompt; Studio provides the Play instruction. Proactive chat guidance begins at the designated infill lesson.';
  return null;
}
